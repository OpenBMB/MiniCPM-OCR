# MiniCPM-OCR Jev 微调教程（ms-swift）

[English](finetune_jev_en.md)

## 概述

本文描述如何准备你自己的标注数据微调 MiniCPM-OCR Jev。

## 环境准备

- **显卡**：下面这套配方按 8 × A100 80GB 给出。
- **Python**：3.12
- **训练框架**：ms-swift + DeepSpeed

训练和推理是两套环境，推理侧不需要装 ms-swift 和 DeepSpeed。

**训练环境**

```bash
conda create -n minicpm-ocr-jev python=3.12 -y
conda activate minicpm-ocr-jev

pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu128
MAX_JOBS=32 NVCC_THREADS=4 pip install --no-build-isolation flash-attn==2.8.3
pip install \
  torch==2.8.0 torchvision==0.23.0 \
  transformers==5.10.4  tokenizers==0.22.2 ms-swift==4.4.0 \
  deepspeed==0.18.9 accelerate==1.13.0 flash-attn==2.8.3 \
  safetensors==0.8.0 pillow==11.3.0 numpy==2.5.1 \
  qwen-vl-utils==0.0.14
```

**推理 / 评测环境**

```bash
pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu128
pip install \
 torch==2.8.0 torchvision==0.23.0 transformers==5.10.4 \
 tokenizers==0.22.2 safetensors==0.8.0 accelerate==1.13.0 \
 pillow==11.3.0 numpy==2.5.1
```

**依赖版本参考**

```text
python                        3.12.13
torch                         2.8.0+cu128
transformers                  5.10.4
ms-swift                      4.4.0
deepspeed                     0.18.9
accelerate                    1.13.0
flash-attn                    2.8.3
qwen-vl-utils                 0.0.14
```

其中 `transformers>=5.10.4` 是硬性要求,再早的版本里没有 `Qwen3_5ForSequenceClassification` 和 `Qwen3VLProcessor`。如果训练时 triton 编译失败，把 `CUDA_HOME` 指向你的 CUDA 安装目录即可。

## 数据格式

训练数据为（原图、OCR 文本、渲染图、标签）四元组，标签是二分类的：

| 标签 | 含义 | 判定标准 |
| --- | --- | --- |
| `1` | OCR 文本与图像内容**一致** | 文字、公式、表格结构都对得上 |
| `0` | **不一致** | 出现任意一种：漏字错字、公式结构被破坏、表格行列错位等 |

标签是针对整段 OCR 输出打的，不定位到具体字符。模型只回答一件事：这份结果能不能用。

每行一个 JSON 对象：

```json
{
  "messages": [
    {
      "role": "user",
      "content": "<image>\nOCR文本：\n<table><tr><td>Refs</td><td>Accuracy (%)</td></tr></table>\n<image>\n第一张图是原图，第二张图是上述 OCR 文本渲染得到的图片。\n请判断该 OCR 文本及其对应渲染图是否与原图内容一致。\n这是一个二分类任务：一致标为 1，不一致标为 0。"
    }
  ],
  "images": [
    "/path/to/images/gt/case_0025318.png",
    "/path/to/images/label/case_0025318.png"
  ],
  "label": 1
}
```

- `images` 必须正好两个路径，**顺序是 [原图, 渲染图]**；
- `content` 里的两个 `<image>` 占位符分别对应这两张图，OCR 文本放在中间；
- 末尾那三句提示语**一字不改**，训练和推理必须用同一套prompt；
- `label` 是整数 `0` 或 `1`。

### 怎么造标注数据

负样本两个来源缺一不可：

| 来源 | 做法 | 为什么需要它 |
| --- | --- | --- |
| **真实负样本** | 拿真实 OCR 模型的错误输出，标成不一致 | 它的错误分布和线上一致，正是模型真正要学会分辨的那一类 |
| **合成负样本** | 对正确文本做规则扰动（改数字、破坏公式结构、挪动表格单元格），再重新渲染 | 补上真实负样本覆盖不到的错误类型；量大且便宜，标签天然正确 |

正样本则是标注为一致的真实 OCR 输出。


训练前先把 OCR 文本里嵌了 base64 图片的样本剔掉——这类文本长到会把图像的 token 预算挤没：

```bash
python scripts/minicpm-ocr-jev/data/filter_embedded_base64.py \
  --input-dir /path/to/dataset_dir --output-dir /path/to/filtered --splits train
```

## 启动训练

接一个 2 分类的序列分类头做微调，单机 8 × A100 80GB。环境和数据准备好之后，执行下面的脚本：

```bash
# run_jev_sft.sh
#!/bin/bash
set -euo pipefail

export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0,1,2,3,4,5,6,7}"
export NPROC_PER_NODE="${NPROC_PER_NODE:-8}"

# 这是训练侧的图像 token 预算。评测和推理用原生预算，不要在那两侧设这个变量。
export IMAGE_MAX_TOKEN_NUM=2048
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

MODEL_PATH="${MODEL_PATH:-/path/to/Qwen3.5-2B}"
TRAIN_DATA="${TRAIN_DATA:-/path/to/filtered/train.jsonl}"
OUTPUT_DIR="${OUTPUT_DIR:-/path/to/outputs/minicpm_ocr_jev}"

swift sft \
  --model "${MODEL_PATH}" \
  --dataset "${TRAIN_DATA}" \
  --task_type seq_cls \
  --num_labels 2 \
  --problem_type single_label_classification \
  --tuner_type full \
  --torch_dtype bfloat16 \
  --freeze_vit true \
  --freeze_aligner true \
  --freeze_llm false \
  --num_train_epochs 3 \
  --per_device_train_batch_size 1 \
  --gradient_accumulation_steps 1 \
  --learning_rate 1e-5 \
  --lr_scheduler_type cosine \
  --warmup_ratio 0.05 \
  --weight_decay 0.1 \
  --max_grad_norm 1.0 \
  --max_length 12000 \
  --packing true \
  --packing_length 12000 \
  --packing_num_proc 8 \
  --deepspeed zero3 \
  --gradient_checkpointing true \
  --attn_impl flash_attn \
  --logging_steps 10 \
  --eval_strategy no \
  --save_strategy steps \
  --save_steps 500 \
  --save_total_limit 40 \
  --save_only_model true \
  --dataset_num_proc 48 \
  --dataloader_num_workers 4 \
  --ddp_timeout 10800 \
  --seed 42 \
  --output_dir "${OUTPUT_DIR}" \
  --report_to tensorboard
```

### 关键参数说明

- `--task_type seq_cls --num_labels 2 --problem_type single_label_classification`：这三个参数把基座从"生成"改成"打分"，也就是在最后一个 token 上接出那个二分类头。
- `--packing true --max_length 12000`：两张图加一段 OCR 文本，序列本身就长，不开 packing 吞吐会掉得很厉害。
- `IMAGE_MAX_TOKEN_NUM=2048` 只作用于训练。评测和推理走 checkpoint 自带预处理器的原生预算——训练与推理在这一项上不对齐是刻意的，别去统一它。
- 要改卡数，调 `CUDA_VISIBLE_DEVICES` 和 `NPROC_PER_NODE` 即可。全局 batch = 卡数 × 单卡 batch × 梯度累积步数。

## 评测

评测在 **[JevOCRBench](https://huggingface.co/datasets/openbmb/JevOCRBench)** 上做。这是面向 OCR verifier 的块级评测集，每条样本是「块图 + 一条 OCR 候选文本 + 该候选的渲染图」，真值为人工标注的正确／错误，指标是 AUROC。

```bash
huggingface-cli download openbmb/JevOCRBench --repo-type dataset \
  --local-dir /path/to/JevOCRBench
```

数据样例如下：

```json
{
  "item_id": 0,
  "image_path": "images/00001.png",
  "render_image_path": "renders/00001.png",
  "ocr_text": "【整句翻译】___",
  "label": "neg",
  "category": "text"
}
```

单卡执行评测计算AUROC：

```bash
# 1. 打分：每条出一个 prob_1
python scripts/minicpm-ocr-jev/eval/score.py \
  --dataset /path/to/JevOCRBench/data/jevocrbench.jsonl \
  --checkpoint /path/to/weights \
  --out /path/to/predictions.jsonl

# 2. 算 AUROC：整体 + 分类别
python scripts/minicpm-ocr-jev/eval/evaluate.py \
  --predictions /path/to/predictions.jsonl
```


已发布模型的评测结果见 [README 中的榜单](../README_zh.md#jev-benchmark)。

## 实践建议

1. **按页划分数据集，不要按样本划分**——同一页上的各个区域彼此高度相关。
2. **两类负样本都要留。** 只用合成负样本，模型会在真实 OCR 错误上失灵；只用真实负样本，又会有一批错误类型没被覆盖到。
3. **渲染器要冻住。** 换一个版本的渲染器，就等于换了一套输入分布，老的数不能接着用，必须重测。
4. **评测和推理时，prompt 要和训练时逐字节一致**，并检查最后一个 token id 是否对得上。
