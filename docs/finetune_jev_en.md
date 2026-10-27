# MiniCPM-OCR Jev Fine-Tuning Tutorial (ms-swift)

[中文版](finetune_jev_zh.md)

## Overview

This guide covers fine-tuning MiniCPM-OCR Jev on your own labelled data.

## Requirements

- **GPU**: 8 × A100 80GB for the recipe below
- **Python**: 3.12
- **Training framework**: ms-swift + DeepSpeed

Training and inference are two environments; the inference side needs neither ms-swift nor DeepSpeed.

**Training environment**

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

**Inference / evaluation environment**

```bash
pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu128
pip install \
 torch==2.8.0 torchvision==0.23.0 transformers==5.10.4 \
 tokenizers==0.22.2 safetensors==0.8.0 accelerate==1.13.0 \
 pillow==11.3.0 numpy==2.5.1
```

**Reference dependency versions**

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

`transformers>=5.10.4` is a hard requirement: `Qwen3_5ForSequenceClassification` and `Qwen3VLProcessor` do not exist in earlier versions. If triton fails to compile during training, point `CUDA_HOME` at your CUDA installation.

## Dataset Format

The training data consists of quadruples: (original image, OCR text, rendered image, label), where the label is binary.

| label | Meaning | Criterion |
| --- | --- | --- |
| `1` | The OCR text **matches** the image | Text, formulas and table structure all line up |
| `0` | **Does not match** | Any of: missing or wrong characters, broken formula structure, misaligned table rows or columns, and similar errors |

A label applies to the whole OCR output; there is no character-level localisation. The model only answers "is this result usable".

One JSON object per line:

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

- `images` holds exactly two paths, **in the order [original, rendered]**;
- the two `<image>` placeholders in `content` correspond to those two images, and the OCR text is placed in the middle;
- the three closing lines are **fixed verbatim**; training and inference must use the same prompt;
- `label` is the integer `0` or `1`.

### Creating labelled data

Negatives have to come from both of these sources:

| Source | How | Why it is needed |
| --- | --- | --- |
| **Real negatives** | Wrong outputs from real OCR models, annotated as mismatched | Matches the error distribution seen in production — the class the model actually has to learn |
| **Synthetic negatives** | Rule-based perturbation of correct text (change digits, break formula structure, move table cells), then re-render | Covers error types the real negatives miss; cheap at volume, and the labels are correct by construction |

Positives are real OCR outputs annotated as matching.


Before training, drop rows whose OCR text embeds a base64 image; such text is long enough to crowd out the image budget:

```bash
python scripts/minicpm-ocr-jev/data/filter_embedded_base64.py \
  --input-dir /path/to/dataset_dir --output-dir /path/to/filtered --splits train
```

## Launch Training

Fine-tuning with a 2-class sequence-classification head, on one node with 8 × A100 80GB. Run the following script after Environment Setup and Data Preparation:

```bash
# run_jev_sft.sh
#!/bin/bash
set -euo pipefail

export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0,1,2,3,4,5,6,7}"
export NPROC_PER_NODE="${NPROC_PER_NODE:-8}"

# Training-side image budget. Evaluation and inference use the native budget — do not set it there.
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

### Key arguments

- `--task_type seq_cls --num_labels 2 --problem_type single_label_classification` turn the base model into a scorer rather than a generator; they are what puts the 2-way head on the last token.
- `--packing true --max_length 12000`: two images plus OCR text make for long sequences, and throughput drops sharply without packing.
- `IMAGE_MAX_TOKEN_NUM=2048` applies to training only. Evaluation and inference use the checkpoint preprocessor's native budget; this train/inference asymmetry is intentional, do not harmonise it.
- To change GPU count, set `CUDA_VISIBLE_DEVICES` and `NPROC_PER_NODE`. Global batch = GPUs × per-device batch × gradient accumulation.

## Evaluation

Evaluation runs on **[JevOCRBench](https://huggingface.co/datasets/openbmb/JevOCRBench)**, a block-level benchmark for OCR verifiers. Each sample is a block image, one OCR candidate, and a rendering of that candidate; the ground truth is a human judgment of correct or incorrect, and the metric is AUROC.

```bash
huggingface-cli download openbmb/JevOCRBench --repo-type dataset \
  --local-dir /path/to/JevOCRBench
```

A sample row:

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

Score and compute AUROC on a single GPU:

```bash
# 1. Score: one prob_1 per sample
python scripts/minicpm-ocr-jev/eval/score.py \
  --dataset /path/to/JevOCRBench/data/jevocrbench.jsonl \
  --checkpoint /path/to/weights \
  --out /path/to/predictions.jsonl

# 2. Compute AUROC: overall and per category
python scripts/minicpm-ocr-jev/eval/evaluate.py \
  --predictions /path/to/predictions.jsonl
```


Benchmark results for the released model are in [the README leaderboard](../README.md#jev-benchmark).

## Best Practices

1. **Split by page, never by sample** — regions from one page are highly correlated.
2. **Keep both negative sources.** Synthetic-only data trains a model that fails on real OCR errors; real-only data leaves error types uncovered.
3. **Freeze the renderer.** A new renderer version is a new input distribution; re-evaluate rather than reusing old numbers.
4. **Keep the prompt byte-identical to training** at evaluation and inference time, and check the last token id.
