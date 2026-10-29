# MiniCPM-OCR 安装与推理

[English](./minicpmvocr_tutorial_en.md)

MiniCPM-OCR 是一个文档解析模型：输入 PDF 或图片，输出 Markdown，包括正文、表格（HTML）、公式（LaTeX）和阅读顺序。

运行时分为两部分：SDK 负责版面检测、切块和结果拼接；推理服务（本文使用 vLLM）运行识别模型，并通过 DSpark 投机解码加速，需同时准备主模型和同版本的草稿模型。两者使用独立的 Python 环境，分别在两个终端中运行。

> **数据隐私**：按本教程在本地部署 SDK 和推理服务后，文档处理与模型推理均在本地完成，无需调用云端 OCR 服务，也无需将原始文档、图片或解析结果上传至云端，有助于保障数据隐私。安装依赖和首次下载模型时需要联网。

---

## 环境要求

| 项目 | 要求 |
|---|---|
| 系统 | Linux x86_64（vLLM 源码编译要求）；下文命令以 Ubuntu 22.04 为例 |
| GPU | NVIDIA GPU；本文命令已在 RTX 5090（32 GB）上验证 |
| NVIDIA 驱动 | ≥ 580（CUDA 13）；旧驱动见 [FAQ](./faq_zh.md#cuda-driver-version-is-insufficient) |
| Python | 3.12，由 uv 自动下载，无需预装 |
| 磁盘 | 至少预留 40 GB：GPU 版 SDK 环境约 9 GB（CPU 版不到 1 GB），vLLM 环境约 8 GB，vLLM 源码与编译产物约 6 GB，模型约 3 GB，其余为下载和编译缓存 |

---
## 安装

### 1. SDK 环境配置
先创建虚拟环境，再安装 SDK 和 PaddlePaddle GPU 环境。

```bash
pip install uv
uv venv .minicpm-ocr --python 3.12 --seed
source .minicpm-ocr/bin/activate

python -m pip install --upgrade "minicpm-ocr[all]"
python -m pip install "paddlepaddle-gpu==3.3.0" \
  -i https://www.paddlepaddle.org.cn/packages/stable/cu129/
```


### 2. 推理服务环境配置

推理服务任选其一，本文使用 vLLM。SGLang、llama.cpp、Ollama 和 FlagOS 见 [其他推理框架](#其他推理框架)。


> **旧驱动**：驱动低于 580 时，先按 [FAQ](./faq_zh.md#cuda-driver-version-is-insufficient) 配置适用于所用 GPU 的 CUDA 兼容库。安装和启动 vLLM、运行 GPU 版 SDK 的终端都需要设置相应的环境变量。

```bash
apt-get update
apt-get install -y software-properties-common
apt-get update
add-apt-repository -y ppa:ubuntu-toolchain-r/test
apt-get install -y gcc-13 g++-13 libdw-dev libelf-dev

bash scripts/install.sh vllm
```

> 脚本会下载固定版本的 vLLM 和 Transformers 源码并编译，环境位于 `.venv-vllm`。编译默认使用 8 个进程，CPU 和内存充足时可用 `MAX_JOBS=32 bash scripts/install.sh vllm` 加速（96 核机器上整个安装约 40 分钟）。

### 3. 启动服务

新开一个终端，在仓库根目录启动 vLLM 服务（默认开启 DSpark 加速）。

> **旧驱动**：在这个新终端中也需要先按 [FAQ](./faq_zh.md#cuda-driver-version-is-insufficient) 设置 CUDA 兼容库环境变量。

```bash
source .venv-vllm/bin/activate
export CC=gcc-13 CXX=g++-13
export CUDA_HOME="$(python -c \
  'import sysconfig; print(sysconfig.get_path("purelib") + "/nvidia/cu13")')"
export PATH="$CUDA_HOME/bin:$PATH"

vllm serve openbmb/MiniCPM-OCR-1.0 \
  --served-model-name minicpm-ocr \
  --host 127.0.0.1 \
  --port 18499 \
  --max-model-len 40960 \
  --max-num-batched-tokens 40960 \
  --max-num-seqs 32 \
  --limit-mm-per-prompt '{"image":36,"video":0}' \
  --attention-backend FLASH_ATTN \
  --mm-encoder-attn-backend FLASH_ATTN \
  --mm-processor-kwargs '{"downsample_mode":"4x"}' \
  --gpu-memory-utilization 0.85 \
  --trust-request-mm-kwargs \
  --speculative-config '{
    "method": "dspark",
    "model": "openbmb/MiniCPM-OCR-1.0-DSpark",
    "num_speculative_tokens": 15,
    "enable_adaptive_verification": false
  }' \
  --default-chat-template-kwargs '{"enable_thinking":false}'
```

> `--speculative-config` 开启 DSpark 加速；删除该参数及其完整 JSON 配置即可使用普通解码，此时无需草稿模型。

### 4. 解析文档

从仓库根目录运行下面的命令。SDK 会检查 `models/PP-DocLayoutV3_infer/`：文件完整时直接复用；缺失或不完整时，自动从 [Paddle 官方地址](https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-DocLayoutV3_infer.tar)下载版面模型。

**GPU 版面检测：**

```bash
source .minicpm-ocr/bin/activate

minicpmvocr parse \
  --device cuda:0 \
  --server-url http://127.0.0.1:18499 \
  --model minicpm-ocr \
  --input doc.pdf \
  --output doc.md
```

---

更多配置请参见 [SDK API 与配置说明](./minicpmvocr_api.md)。

---
## 其他推理框架

上面的安装和启动步骤使用 vLLM。换用其他推理框架时，SDK 的版面检测和结果拼接不变，按对应文档启动识别服务后再连接。

| 框架 | 文档 |
|---|---|
| SGLang | [部署指南（英文）](./sglang_deploy.md)。启动命令带 DSpark。 |
| llama.cpp | [GGUF 部署指南](./llamacpp_deploy_zh.md)。默认启用 DSpark。 |
| Ollama | [部署指南](./ollama_deploy_zh.md)。启用 DSpark。 |
| FlagOS | [多芯片部署指南](./flagos_deploy_zh.md)。 |

---
## 常见问题

| 问题 | 处理方式 |
|---|---|
| 第三方源码准备失败 | 按脚本提示检查 GitHub 连接或 `sources/` 中已有目录的版本，再运行 `bash scripts/install.sh vllm` |
| 报不支持 `minicpm_ocr` 架构 | 重新运行 `bash scripts/install.sh vllm`，安装配套的 Transformers 源码 |
| vLLM 编译进程被杀 | 减少 `MAX_JOBS`，确认编译内存充足 |
| 显存不足 | 减小 `--max-model-len`，必要时降低 `--gpu-memory-utilization` |
| SDK 请求失败或一直等待 | 先检查 `/v1/models`；确认服务地址正确，vLLM 启动时带了 `--trust-request-mm-kwargs` |

更多排障见 [FAQ](./faq_zh.md)。
