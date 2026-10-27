#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MiniCPM-OCR-Jev 打分器：单卡，逐批前向，每条输出一个 prob_1。

prob_1 越高表示 OCR 文本越可能与原图一致。接着用 evaluate.py 出 AUROC。

口径（改任何一处都会让分数偏离已发布读数）：
  - 模型类 Qwen3_5ForSequenceClassification，num_labels=2，bf16；**不显式指定 attn 实现**（走 HF 默认）
  - prompt 与训练时逐字节相同，见下方 build_prompt()；每批过字符串级与 token 级两道闸
  - 图像预算走 checkpoint 自带 preprocessor 的原生配置（不做 token 数压缩）
  - prob = softmax(logits.float())，prob_1 = prob[1]

用法：
    python score.py --dataset <jsonl> --checkpoint <权重目录> --out <predictions.jsonl>

输入 jsonl 每行（JevOCRBench 即此格式，下载后直接可跑）：
    {"item_id": 0, "image_path": "images/00001.png", "render_image_path": "renders/00001.png",
     "ocr_text": "...", "label": "pos"|"neg", "category": "text"|"formula"|"table"}
图像为相对路径时按 jsonl 所在目录解析。
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image

# ============================== prompt 口径 ==============================
# 以下这段**与训练时逐字节相同**，也与发布权重的服务端实现同源。改动其中任何一处
# ——包括空白字符、或把两张图调换顺序——都会改变分数的含义。
#
# 两个看着像冗余、实则不能动的细节：
#
#  * 每个图像占位符后面都跟一个换行。丢掉它是最常见的错法，因为用 chat template 的
#    content 列表拼 prompt 时渲染出的占位符不带换行。
#
#  * prompt 以一个**空的 assistant 轮**结尾（含空 <think> 块）。模型是作为序列分类器
#    训练的，框架会附上这一轮，而池化取的是最后一个 token ⇒ value head 读的正是这一轮
#    末尾那个换行的隐状态。砍掉它就会去池化一个训练时从未被池化过的位置——它照样给出
#    看起来合理的数值，这正是该错误难以察觉的原因。
#
# 下面的指纹在 import 时断言，误改会当场炸而不是悄悄把每个分数挪位。

IMAGE_PLACEHOLDER = "<|vision_start|><|image_pad|><|vision_end|>"

INSTRUCTION = (
    "第一张图是原图，第二张图是上述 OCR 文本渲染得到的图片。\n"
    "请判断该 OCR 文本及其对应渲染图是否与原图内容一致。\n"
    "这是一个二分类任务：一致标为 1，不一致标为 0。"
)

#: 训练框架为序列分类器附上的那个空 assistant 轮；value head 实际读的就是它，见上方说明。
ASSISTANT_SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"

PROMPT_TEMPLATE_MD5 = "9aab68e8ba8ab4da17ba9752bddb199c"

#: 被池化位置的 token id：ASSISTANT_SUFFIX 末尾的 '\n\n'。
EXPECTED_LAST_TOKEN_ID = 271

#: Qwen3.5-VL 会拒绝极端长宽比。块裁图常常很宽而只有几像素高，超过这个比例的先补白边
#: ——补白保住字形尺度，缩放不会。常规块裁图/渲染图下恒为 no-op。
MAX_ASPECT_RATIO = 199.0


def build_prompt(text: str) -> str:
    """拼出单条候选的原始 prompt 字符串。"""
    return (
        f"<|im_start|>user\n"
        f"{IMAGE_PLACEHOLDER}\n"
        f"OCR文本：\n{text}\n"
        f"{IMAGE_PLACEHOLDER}\n"
        f"{INSTRUCTION}"
        f"{ASSISTANT_SUFFIX}"
    )


def check_prompt_tail(prompt: str) -> None:
    """字符串级口径闸：prompt 必须以那个空 assistant 轮收尾。"""
    if not prompt.endswith(ASSISTANT_SUFFIX):
        raise RuntimeError(
            "prompt 结尾不是训练口径的空 assistant 轮，分数不可比。\n"
            f"  期望以 {ASSISTANT_SUFFIX!r} 结尾\n"
            f"  实得结尾 {prompt[-len(ASSISTANT_SUFFIX):]!r}")


def _assert_prompt_unchanged() -> None:
    fingerprint = hashlib.md5(build_prompt("{text}").encode("utf-8")).hexdigest()
    if fingerprint != PROMPT_TEMPLATE_MD5:
        raise RuntimeError(
            "prompt 模板已被修改。用改过的模板打出的分数与已发布读数不可比。\n"
            f"  期望 md5 {PROMPT_TEMPLATE_MD5}\n  实得 md5 {fingerprint}\n"
            "若改动是有意的，请同步更新 PROMPT_TEMPLATE_MD5。")


_assert_prompt_unchanged()


# ============================== 读样本 ==============================


def label_to_int(label: Any) -> int | None:
    """pos/neg 与 1/0 两套写法都认；**认不出一律返回 None，绝不猜成某一类**。"""
    if isinstance(label, bool):
        return int(label)
    if isinstance(label, int) and label in {0, 1}:
        return label
    text = str(label).strip().lower()
    if text in {"1", "pos", "positive"}:
        return 1
    if text in {"0", "neg", "negative"}:
        return 0
    return None


def load_samples(dataset: Path, limit: int | None) -> list[dict[str, Any]]:
    """读 jsonl 成样本表。坏行一律抛错，不静默跳过。"""
    samples: list[dict[str, Any]] = []
    with dataset.open(encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            paths = [row.get("image_path") or "", row.get("render_image_path") or ""]
            if not all(paths):
                raise ValueError(f"{dataset}:{line_no} 缺图像路径（需原图 + 渲染图各一张）")
            # item_id 从 0 开始，不能写成 `row.get("item_id") or line_no`——`or` 会把第 0 条当成缺失。
            item_id = row.get("item_id")
            samples.append({
                "item_id": line_no - 1 if item_id is None else item_id,
                "category": row.get("category") or "unknown",
                "label": label_to_int(row.get("label")),
                # 相对路径按 jsonl 所在目录解析
                "images": [str(p if Path(p).is_absolute() else (dataset.parent / p).resolve())
                           for p in paths],
                "ocr_text": str(row.get("ocr_text") or ""),
            })
            if limit is not None and len(samples) >= limit:
                break
    if not samples:
        raise ValueError(f"{dataset} 里没有可打分的行")
    return samples


def pad_extreme_aspect_image(path: str, tmp_dir: Path) -> str:
    """长宽比超限的图补白边后另存，返回该送进 processor 的路径；未超限原样返回。"""
    with Image.open(path) as img:
        width, height = img.size
        if min(width, height) <= 0 or max(width, height) / min(width, height) <= MAX_ASPECT_RATIO:
            return path
        if width >= height:
            new_width, new_height = width, max(height, int(width / MAX_ASPECT_RATIO + 0.999999))
        else:
            new_width, new_height = max(width, int(height / MAX_ASPECT_RATIO + 0.999999)), height
        canvas = Image.new("RGB", (new_width, new_height), "white")
        canvas.paste(img.convert("RGB"), ((new_width - width) // 2, (new_height - height) // 2))

    tmp_dir.mkdir(parents=True, exist_ok=True)
    out_path = tmp_dir / f"{Path(path).stem}__padded_{new_width}x{new_height}.png"
    if not out_path.exists():
        canvas.save(out_path)
    return str(out_path)


# ============================== 打分 ==============================


def load_model_and_processor(checkpoint: Path) -> tuple[Any, Any]:
    import torch
    from transformers import AutoProcessor, Qwen3_5ForSequenceClassification

    processor = AutoProcessor.from_pretrained(checkpoint)
    print(f"[INFO] 图像预算走 ckpt 原生配置: {processor.image_processor.size}", flush=True)

    # bf16 是发布口径，不开放成参数——换精度就是换了一套分数。
    model = Qwen3_5ForSequenceClassification.from_pretrained(
        checkpoint, dtype=torch.bfloat16, device_map="cuda:0")
    model.eval()
    if model.config.num_labels != 2:
        raise RuntimeError(f"期望 num_labels=2，实为 {model.config.num_labels}")
    return model, processor


def assert_pooled_token(inputs: Any) -> None:
    """token 级口径闸：被池化位置的 token 必须是训练口径那个（id 271 '\\n\\n'）。

    HF 的 seq_cls 取「最右侧非 padding token」，所以这里按 attention_mask 定位，
    不能直接取 input_ids[:, -1] —— 右 padding 下那是 pad token。
    """
    input_ids = inputs["input_ids"]
    mask = inputs.get("attention_mask")
    if mask is None:
        last_idx = [input_ids.shape[1] - 1] * input_ids.shape[0]
    else:
        last_idx = (mask.shape[1] - 1 - mask.flip(dims=[1]).argmax(dim=1)).tolist()
    bad = [(i, int(input_ids[i, last_idx[i]])) for i in range(input_ids.shape[0])
           if int(input_ids[i, last_idx[i]]) != EXPECTED_LAST_TOKEN_ID]
    if bad:
        raise RuntimeError(
            f"被池化的末 token 不符训练口径：期望 {EXPECTED_LAST_TOKEN_ID}，"
            f"实得 {bad[:5]}（本批 {len(bad)}/{input_ids.shape[0]} 条）。"
            " prompt 或 tokenizer 口径不符，分数不可比。")


def score_batch(model: Any, processor: Any, samples: list[dict[str, Any]],
                tmp_dir: Path) -> list[float]:
    """返回本批每条的 prob_1。"""
    import torch

    texts: list[str] = []
    flat_images: list[str] = []
    nested_images: list[list[str]] = []
    for sample in samples:
        images = [pad_extreme_aspect_image(p, tmp_dir) for p in sample["images"]]
        prompt = build_prompt(sample["ocr_text"])
        check_prompt_tail(prompt)                   # 口径闸（字符串级）
        texts.append(prompt)
        flat_images.extend(images)
        nested_images.append(images)

    kwargs: dict[str, Any] = {"text": texts, "return_tensors": "pt"}
    if len(samples) > 1:
        kwargs["padding"] = True
    try:
        inputs = processor(images=flat_images, **kwargs)
    except Exception as flat_exc:
        # 少数行在扁平图列表下会撞 processor 的配对推断，改按样本嵌套重试
        try:
            inputs = processor(images=nested_images, **kwargs)
        except Exception as nested_exc:
            raise RuntimeError(
                f"processor 两种图像入参都失败; flat_error={flat_exc!r}") from nested_exc

    assert_pooled_token(inputs)                     # 口径闸（token 级）

    inputs = {k: (v.to(model.device) if hasattr(v, "to") else v) for k, v in inputs.items()}
    with torch.inference_mode():
        logits = model(**inputs).logits
    if logits.dim() == 1:
        logits = logits.unsqueeze(0)
    probs = torch.softmax(logits.float(), dim=-1).detach().cpu().tolist()
    if len(probs) != len(samples):
        raise RuntimeError(f"模型返回 {len(probs)} 条 logits，但本批有 {len(samples)} 条样本")
    return [p[1] for p in probs]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", required=True, type=Path, help="待打分 jsonl")
    ap.add_argument("--checkpoint", required=True, type=Path, help="权重目录")
    ap.add_argument("--out", required=True, type=Path, help="产物 predictions.jsonl")
    ap.add_argument("--batch-size", type=int, default=4)
    ap.add_argument("--limit", type=int, default=None, help="只打前 N 条，用于冒烟")
    args = ap.parse_args()

    samples = load_samples(args.dataset.resolve(), args.limit)
    unlabeled = sum(1 for s in samples if s["label"] is None)
    print(f"[INFO] 样本 {len(samples)} 条，其中无有效标签 {unlabeled} 条", flush=True)

    model, processor = load_model_and_processor(args.checkpoint)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    tmp_dir = args.out.parent / "tmp_padded_images"

    # 边打边写：中途崩了也留得下已打的部分，不必为续跑另建一套索引。
    with args.out.open("w", encoding="utf-8") as handle:
        for start in range(0, len(samples), args.batch_size):
            batch = samples[start:start + args.batch_size]
            for sample, prob_1 in zip(batch, score_batch(model, processor, batch, tmp_dir)):
                handle.write(json.dumps({
                    "item_id": sample["item_id"],
                    "category": sample["category"],
                    "label": sample["label"],
                    "prob_1": prob_1,
                }, ensure_ascii=False) + "\n")
            handle.flush()
            print(f"[INFO] {min(start + args.batch_size, len(samples))}/{len(samples)}", flush=True)

    print(f"WROTE {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
