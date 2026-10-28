# MiniCPM-OCR Installation and Inference

[中文](./minicpmvocr_tutorial.md)

MiniCPM-OCR parses PDFs and images into Markdown, including body text, tables (HTML), formulas (LaTeX), and reading order.

The runtime has two parts: the SDK handles layout detection, cropping, and result assembly; the inference service (vLLM in this tutorial) runs the recognition model and accelerates inference through DSpark speculative decoding, which requires both the main model and a draft model from the same release. The two parts use separate Python environments and run in separate terminals.

---
## Requirements

| Item | Requirement |
|---|---|
| OS | Linux x86_64 (required for building vLLM from source); commands below use Ubuntu 22.04 |
| GPU | NVIDIA GPU; these commands have been verified on an RTX 5090 (32 GB) |
| NVIDIA driver | ≥ 580 (CUDA 13); for older drivers, see the [FAQ](./faq_en.md#cuda-driver-version-is-insufficient) |
| Python | 3.12, downloaded automatically by uv; no prior installation required |
| Disk | Reserve at least 40 GB: about 9 GB for the GPU SDK environment (under 1 GB for CPU), 8 GB for the vLLM environment, 6 GB for vLLM source and build artifacts, 3 GB for models, and the rest for download and build caches |

---
## Installation

### 1. Set up the SDK environment

Create a virtual environment, then install the SDK and PaddlePaddle GPU packages.

```bash
pip install uv
uv venv .minicpm-ocr --python 3.12 --seed
source .minicpm-ocr/bin/activate

python -m pip install "minicpm-ocr[all]==1.0.2"
python -m pip install "paddlepaddle-gpu==3.3.0" \
  -i https://www.paddlepaddle.org.cn/packages/stable/cu129/
```

### 2. Set up the inference environment

Choose one inference service. This tutorial uses vLLM; for SGLang and llama.cpp, see the [SGLang deployment guide](./sglang_deploy.md) and [llama.cpp deployment guide](./llamacpp_deploy.md).

> **Older drivers**: For drivers below 580, first configure a CUDA compatibility library suitable for your GPU as described in the [FAQ](./faq_en.md#cuda-driver-version-is-insufficient). Set its environment variables in each terminal used to install or start vLLM, or run the GPU SDK.

```bash
apt-get update
apt-get install -y software-properties-common
apt-get update
add-apt-repository -y ppa:ubuntu-toolchain-r/test
apt-get install -y gcc-13 g++-13 libdw-dev libelf-dev

bash scripts/install.sh vllm
```

> The script downloads pinned versions of the vLLM and Transformers source code and builds vLLM in `.venv-vllm`. Compilation uses 8 processes by default. With sufficient CPU and memory, use `MAX_JOBS=32 bash scripts/install.sh vllm` to speed it up (the full installation takes about 40 minutes on a 96-core machine).

### 3. Start the service

Open a new terminal at the repository root and start vLLM with DSpark acceleration enabled.

> **Older drivers**: Set the CUDA compatibility-library environment variables in this new terminal as described in the [FAQ](./faq_en.md#cuda-driver-version-is-insufficient).

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

> `--speculative-config` enables DSpark acceleration. Remove this argument and its entire JSON configuration to use standard decoding without a draft model.

### 4. Parse documents

Run the following command from the repository root. The SDK checks `models/PP-DocLayoutV3_infer/`: it reuses complete model files and automatically downloads the layout model from the [official Paddle URL](https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-DocLayoutV3_infer.tar) if files are missing or incomplete.

**GPU layout detection:**

```bash
source .minicpm-ocr/bin/activate

minicpmvocr parse \
  --device cuda:0 \
  --server-url http://127.0.0.1:18499 \
  --model minicpm-ocr \
  --input doc.pdf \
  --output doc.md
```

For more options, see [SDK API and Configuration](./minicpmvocr_api_en.md).

---
## FAQ

| Issue | Solution |
|---|---|
| Third-party source preparation fails | Follow the script's message to check GitHub access or existing source revisions under `sources/`, then rerun `bash scripts/install.sh vllm` |
| Unsupported `minicpm_ocr` architecture | Rerun `bash scripts/install.sh vllm` to install the matching Transformers source |
| vLLM build processes are killed | Reduce `MAX_JOBS` and check that enough memory is available for compilation |
| Out of GPU memory | Reduce `--max-model-len` and, if necessary, `--gpu-memory-utilization` |
| SDK requests fail or keep waiting | Check `/v1/models` first, verify the service URL, and keep `--trust-request-mm-kwargs` in the vLLM startup command |

For more troubleshooting, see the [FAQ](./faq_en.md).
