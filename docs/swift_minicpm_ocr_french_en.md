# MiniCPM-OCR 1.0 Fine-Tuning Tutorial (ms-swift)

[中文版](swift_minicpm_ocr_french.md)

## Model and Task Overview

This tutorial uses the [Teklia/RIMES-2011-line](https://huggingface.co/datasets/Teklia/RIMES-2011-line) dataset as an example of fine-tuning [MiniCPM-OCR 1.0](https://huggingface.co/openbmb/MiniCPM-OCR-1.0) for French handwritten text-line recognition.

Training task:

- Input a French handwritten text-line image with the prompt `Text Recognition:`.
- The target `assistant` response is the corresponding French transcription.

This training run uses full-parameter SFT to train the vision encoder and language model while freezing the multimodal projector, with 4x visual token compression.

## Environment Setup

Source: [tsjyma/ms-swift](https://github.com/tsjyma/ms-swift)

**Minimum runnable installation steps**

```bash
conda create -n "MiniCPM-OCR-French-Swift" python=3.11 -y
conda activate "MiniCPM-OCR-French-Swift"

pip install torch==2.9.1 torchvision==0.24.1 torchaudio==2.9.1

git clone https://github.com/tsjyma/ms-swift.git
cd ms-swift
git checkout 903565756360d81fdc16fa14b0340a6e17ace900
pip install -e .

pip install \
  accelerate==1.13.0 deepspeed==0.18.8 \
  peft==0.18.1 trl==0.24.0 datasets==4.8.4 \
  flash-linear-attention==0.4.2 \
  ninja einops safetensors tokenizers sentencepiece

pip install /path/to/transformers
```

Install the latest Transformers source last (> 5.20.2).

**Reference dependency versions**

```text
Python                    3.11.11
PyTorch                   2.9.1+cu128
torchvision               0.24.1
torchaudio                2.9.1
Transformers              > 5.20.2
DeepSpeed                 0.18.8
Accelerate                1.13.0
PEFT                      0.18.1
TRL                       0.24.0
flash-linear-attention    0.4.2
datasets                  4.8.4
ms-swift                  4.7.0.dev0
```

## Data Preparation

Use the official RIMES training, validation, and test splits.

- Exclude training samples that contain the `¤` annotation marker. For validation and test samples, remove only the delimiter and keep the text, while preserving case, accents, punctuation, internal spaces, and the original text-line images.

| Dataset | Samples |
| --- | ---: |
| Training | 10,138 |
| Validation | 1,138 |
| Test | 778 |

After downloading the dataset, pair each image path with its transcription in the JSONL format below.

**Data format reference**

![French handwritten training line](../assets/minicpm-ocr/french_train_line.jpg)

```json
{
  "messages": [
    {
      "role": "user",
      "content": "<image>Text Recognition:"
    },
    {
      "role": "assistant",
      "content": "J'ai perdu mon emploi depuis 3 mois et je me"
    }
  ],
  "images": [
    "/path/to/rimes_french/images/train/00000.jpg"
  ]
}
```

The ms-swift template inserts a newline after the image placeholder, so use `<image>Text Recognition:` in JSONL.

## Launch Training

Train for three epochs on one node with 8 × A100 80GB GPUs: 80 updates per epoch and 240 updates in total. Per-device batch size 1 and gradient accumulation 16 give a global batch size of 128. Evaluate on the complete validation set and save a checkpoint after each epoch, then select the checkpoint with the lowest validation loss.

- Training appends `<think>\n\n</think>\n\n`. User text, image tokens, and the empty thinking prefix are masked from loss; the answer and end markers are supervised.

Run the following script after Environment Setup:

```bash
set -euo pipefail
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0,1,2,3,4,5,6,7}"
export NPROC_PER_NODE=8
export MASTER_ADDR=127.0.0.1 MASTER_PORT=29781
export DOWNSAMPLE_MODE=4x

DOC_DIR=/path/to/ocr_doc
MODEL_PATH=/path/to/MiniCPM-OCR-1.0
TRAIN_DATA=/path/to/rimes_french/train_swift.jsonl
VAL_DATA=/path/to/rimes_french/validation_swift.jsonl
OUTPUT_DIR=/path/to/outputs/minicpm_ocr_french_swift

swift sft \
  --model "$MODEL_PATH" \
  --model_type minicpm_ocr \
  --template minicpm_ocr \
  --add_non_thinking_prefix true \
  --dataset "$TRAIN_DATA" \
  --split_dataset_ratio 0.0 \
  --deepspeed "$DOC_DIR/assets/minicpm-ocr/ds_zero2.json" \
  --tuner_type full \
  --torch_dtype bfloat16 \
  --freeze_vit false \
  --freeze_aligner true \
  --freeze_llm false \
  --packing false \
  --padding_free false \
  --max_length 4096 \
  --num_train_epochs 3.0 \
  --per_device_train_batch_size 1 \
  --gradient_accumulation_steps 16 \
  --gradient_checkpointing true \
  --vit_gradient_checkpointing true \
  --gradient_checkpointing_kwargs '{"use_reentrant": false}' \
  --learning_rate 5e-06 \
  --lr_scheduler_type cosine \
  --warmup_ratio 0.05 \
  --optim adamw_torch_fused \
  --adam_beta1 0.9 \
  --adam_beta2 0.95 \
  --adam_epsilon 1e-08 \
  --weight_decay 0.1 \
  --max_grad_norm 1.0 \
  --logging_steps 1 \
  --save_total_limit 3 \
  --save_only_model false \
  --load_from_cache_file false \
  --dataset_num_proc 8 \
  --dataloader_num_workers 8 \
  --attn_impl sdpa \
  --loss_scale ignore_empty_think \
  --eval_strategy epoch \
  --output_dir "$OUTPUT_DIR" \
  --report_to none \
  --seed 42 \
  --data_seed 42 \
  --add_version false \
  --use_hf true \
  --dataset_shuffle false \
  --train_dataloader_shuffle true \
  --val_dataset "$VAL_DATA" \
  --save_strategy epoch \
  --load_best_model_at_end true \
  --metric_for_best_model eval_loss \
  --greater_is_better false \
  --per_device_eval_batch_size 1
```

## Training Curves

![ms-swift French training curves](../assets/minicpm-ocr/french_swift_training_curves.png)

| Epochs | Updates | Training time | Mean training loss |
| ---: | ---: | --- | ---: |
| 3 | 240 | 34m 22s | 0.203644 |

| Model | Epoch | Validation loss ↓ |
| --- | ---: | ---: |
| MiniCPM-OCR 1.0 | 0 | 1.683164 |
| Fine-tuned model | 1 | 0.225709 |
| Fine-tuned model | 2 | 0.206930 |
| Fine-tuned model | 3 | 0.208526 |

Select `checkpoint-160` at epoch two. The evaluation results below use this checkpoint.

## Evaluation Results

Evaluate on all 778 official RIMES test lines. Both the base and fine-tuned model use 4x visual token compression, non-thinking mode, greedy decoding, batch size 8, and a maximum of 512 newly generated tokens per line. Use the same prompt, `Text Recognition:`, as in training.

Evaluation metrics:

| Metric | Description |
| --- | --- |
| CER ↓ | Character error rate: total character edit distance divided by the total number of reference characters. Lower is better. |
| WER ↓ | Word error rate: total word edit distance divided by the total number of reference words, using whitespace-delimited words. Lower is better. |

Both metrics use complete model outputs, normalize Unicode to NFC, trim leading/trailing whitespace, and preserve case, accents, punctuation, and internal spaces.

| Model | RIMES CER ↓ | RIMES WER ↓ |
| --- | ---: | ---: |
| MiniCPM-OCR 1.0 | 5.67% | 15.78% |
| Fine-tuned model | 3.08% | 7.86% |

**Output examples**

The examples below are actual outputs from the selected checkpoint on RIMES test images.

**Example 1: Insurance contract**

![Example 1: Insurance contract](../assets/minicpm-ocr/french_eval_contract.jpg)

```text
# Question
<image>
Text Recognition:

# Fine-tuned model
Comme indiqué dans les conditions particulières de mon contrat d'assurance
```

**Example 2: Address and date**

![Example 2: Address and date](../assets/minicpm-ocr/french_eval_address.jpg)

```text
# Question
<image>
Text Recognition:

# Fine-tuned model
de mon domicile du 3 Rue Gambetta, 57000 METZ, en date du 28 février
```
