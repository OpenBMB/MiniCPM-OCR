# MiniCPM-OCR 1.0 微调教程（LlamaFactory）

[English](llamafactory_minicpm_ocr_french_en.md)

## 模型与任务概述

本文使用 [Teklia/RIMES-2011-line](https://huggingface.co/datasets/Teklia/RIMES-2011-line) 数据，对 [MiniCPM-OCR 1.0](https://huggingface.co/openbmb/MiniCPM-OCR-1.0) 进行法语手写文本行识别的微调示例。

训练任务：

- 输入法语手写文本行图片，提示词为 `Text Recognition:`。
- `assistant` 输出图片对应的法语文本。

本次训练使用全参数 SFT，训练视觉编码器和语言模型，冻结多模态投影层；视觉 Token 压缩率为 4x。

## 环境准备

代码仓库：[tsjyma/LlamaFactory](https://github.com/tsjyma/LlamaFactory)。

**最小可运行安装步骤**

```bash
conda create -n "MiniCPM-OCR-French-LF" python=3.11 -y
conda activate "MiniCPM-OCR-French-LF"

pip install torch==2.9.1 torchvision==0.24.1 torchaudio==2.9.1

git clone https://github.com/tsjyma/LlamaFactory.git
cd LlamaFactory
git checkout 38fa4bcbac2830c159f2baf9808d21a7fca4e790
pip install -e .

pip install \
  accelerate==1.13.0 deepspeed==0.18.8 \
  peft==0.18.1 trl==0.24.0 datasets==4.0.0 \
  flash-linear-attention==0.4.2 \
  ninja einops safetensors tokenizers sentencepiece

pip install /path/to/transformers
export DISABLE_VERSION_CHECK=1
```

最后安装最新的 Transformers 源码（> 5.20.2）。

**依赖版本参考**

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
datasets                  4.0.0
LlamaFactory              0.9.6.dev0
```



## 数据准备

使用 RIMES 官方的训练、验证和测试划分。

- 过滤含 `¤` 标注标记的训练样本，验证集和测试集只删除该分隔符并保留文本，同时保留大小写、重音符号、标点、内部空格和原始文本行图片。


| 数据集 | 样本数    |
| --- | ------ |
| 训练集 | 10,138 |
| 验证集 | 1,138  |
| 测试集 | 778    |


下载数据后，将图片路径与对应转写文本整理为以下 JSONL 格式。

**数据格式示例**

![法语手写训练图片](../assets/minicpm-ocr/french_train_line.jpg)

```json
{
  "messages": [
    {
      "role": "user",
      "content": "<image>\nText Recognition:"
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

在 `dataset_info.json` 中注册训练集和验证集：

```json
{
  "rimes_train": {
    "file_name": "train.jsonl",
    "formatting": "sharegpt",
    "columns": {
      "messages": "messages",
      "images": "images"
    },
    "tags": {
      "role_tag": "role",
      "content_tag": "content",
      "user_tag": "user",
      "assistant_tag": "assistant"
    }
  },
  "rimes_validation": {
    "file_name": "validation.jsonl",
    "formatting": "sharegpt",
    "columns": {
      "messages": "messages",
      "images": "images"
    },
    "tags": {
      "role_tag": "role",
      "content_tag": "content",
      "user_tag": "user",
      "assistant_tag": "assistant"
    }
  }
}
```

## 启动训练

在单机 8 × A100 80GB 上训练 3 epoch，每轮 80 个更新步，共 240 步。每卡 batch size 为 1，梯度累积 16 步，全局 batch size 为 128。每轮使用完整验证集计算 loss 并保存检查点，训练结束后选择验证 loss 最低的检查点。

- 训练时追加 `<think>\n\n</think>\n\n`，用户提示词、图像和空思考前缀不参与 loss，答案及结束标记参与监督。

执行环境准备后，运行以下脚本：

```bash
set -euo pipefail
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0,1,2,3,4,5,6,7}"
export FORCE_TORCHRUN=1 NPROC_PER_NODE=8
export MASTER_ADDR=127.0.0.1 MASTER_PORT=29780
export DOWNSAMPLE_MODE=4x
export DISABLE_VERSION_CHECK=1

DOC_DIR=/path/to/ocr_doc
DATA_DIR=/path/to/rimes_french
OUTPUT_DIR=/path/to/outputs/minicpm_ocr_french_llamafactory
mkdir -p "$OUTPUT_DIR"

cat > "$OUTPUT_DIR/train.yaml" <<YAML
model_name_or_path: /path/to/MiniCPM-OCR-1.0
trust_remote_code: false
flash_attn: sdpa
use_reentrant_gc: false
stage: sft
do_train: true
finetuning_type: full
freeze_vision_tower: false
freeze_multi_modal_projector: true
dataset_dir: ${DATA_DIR}
dataset: rimes_train
template: minicpm_ocr
enable_thinking: false
train_on_prompt: false
cutoff_len: 4096
packing: false
preprocessing_num_workers: 8
dataloader_num_workers: 8
output_dir: ${OUTPUT_DIR}
logging_steps: 1
save_strategy: epoch
save_only_model: false
save_total_limit: 3
report_to: none
per_device_train_batch_size: 1
gradient_accumulation_steps: 16
learning_rate: 5.0e-06
num_train_epochs: 3.0
lr_scheduler_type: cosine
warmup_steps: 0.05
bf16: true
ddp_find_unused_parameters: true
seed: 42
data_seed: 42
eval_strategy: epoch
weight_decay: 0.1
do_eval: true
deepspeed: ${DOC_DIR}/assets/minicpm-ocr/ds_zero2.json
optim: adamw_torch_fused
adam_beta1: 0.9
adam_beta2: 0.95
adam_epsilon: 1.0e-08
max_grad_norm: 1.0
overwrite_cache: true
eval_dataset: rimes_validation
load_best_model_at_end: true
metric_for_best_model: eval_loss
greater_is_better: false
per_device_eval_batch_size: 1
YAML

llamafactory-cli train "$OUTPUT_DIR/train.yaml"
```



## 训练曲线

![LlamaFactory 法语微调曲线](../assets/minicpm-ocr/french_llamafactory_training_curves.png)


| 训练轮数 | 更新步数 | 训练时长      | 平均训练 loss |
| ---- | ---- | --------- | --------- |
| 3    | 240  | 33 分 52 秒 | 0.203473  |



| 模型               | Epoch | Validation loss ↓ |
| ---------------- | ----- | ----------------- |
| MiniCPM-OCR 1.0  | 0     | 1.683845          |
| Fine-tuned model | 1     | 0.225827          |
| Fine-tuned model | 2     | 0.206137          |
| Fine-tuned model | 3     | 0.207547          |


本轮选择第 2 epoch 的 `checkpoint-160`；下文评测结果使用该检查点。

## 评测结果

在 RIMES 官方测试集全部 778 行上评测。原始模型与微调后的模型统一使用 4x 视觉 Token 压缩率、非 thinking 模式、greedy 解码和 batch size 8，每行最多生成 512 tokens。提示词沿用训练时的 `Text Recognition:`。

评测指标说明：


| 指标    | 说明                                |
| ----- | --------------------------------- |
| CER ↓ | 字符错误率：字符编辑距离总和除以参考字符总数，越低越好。      |
| WER ↓ | 词错误率：按空格分词后，词级编辑距离总和除以参考词总数，越低越好。 |


两项指标均使用完整模型输出，统一 Unicode NFC、去除首尾空白，保留大小写、重音符号、标点和内部空格。


| 模型               | RIMES CER ↓ | RIMES WER ↓ |
| ---------------- | ----------- | ----------- |
| MiniCPM-OCR 1.0  | 5.67%       | 15.78%      |
| Fine-tuned model | 2.98%       | 7.66%       |


**输出样例**

以下为所选检查点在 RIMES 测试图片上的实际输出。

**样例 1：保险合同文本**

![样例 1：保险合同文本](../assets/minicpm-ocr/french_eval_contract.jpg)

```text
# Question
<image>
Text Recognition:

# Fine-tuned model
Comme indiqué dans les conditions particulières de mon contrat d'assurance
```

**样例 2：地址与日期**

![样例 2：地址与日期](../assets/minicpm-ocr/french_eval_address.jpg)

```text
# Question
<image>
Text Recognition:

# Fine-tuned model
de mon domicile du 3 Rue Gambetta, 57000 METZ, en date du 28 février
```
