# SGLang Deployment Guide

[中文](./sglang_deploy_zh.md)

[← Back to README](../README.md)

SGLang serves MiniCPM-OCR through an OpenAI-compatible API. This guide enables DSpark decoding with a matched target model and draft model. The SDK runs in a separate environment and connects over HTTP.

This guide follows the environment layout and SDK settings in the [vLLM tutorial](./minicpmvocr_tutorial_en.md). The commands target Linux x86_64, an NVIDIA GPU and Python 3.12.

## 1. Prepare the source

MiniCPM-OCR 1.0 support is provided by [PR #45799](https://github.com/sgl-project/sglang/pull/45799), which is open as of October 26, 2026. This guide uses the PR commit [`aaab6bfc3de5354b052f2e96d5e566d70b9f69a2`](https://github.com/tc-mb/sglang/commit/aaab6bfc3de5354b052f2e96d5e566d70b9f69a2), from branch `model/MiniCPM-OCR-1.0`.

Run all commands below from the **root of this repository**, `MiniCPM-OCR`:

```bash
git clone https://github.com/sgl-project/sglang.git sources/sglang
git -C sources/sglang fetch origin pull/45799/head
git -C sources/sglang checkout aaab6bfc3de5354b052f2e96d5e566d70b9f69a2
```

If `sources/sglang` already exists, skip the clone and run the fetch and checkout commands.

## 2. Set up the SDK environment

Install the SDK and GPU PaddlePaddle in `.minicpm-ocr` as described in the [SDK tutorial](./minicpmvocr_tutorial_en.md#1-set-up-the-sdk-environment). Reuse this environment if it is already installed for vLLM.

For CPU layout detection, follow the same steps but replace the `paddlepaddle-gpu` installation command with:

```bash
python -m pip install "paddlepaddle==3.2.1"
```

## 3. Install the service environment

The `sglang` profile in this repository's [`pyproject.toml`](../pyproject.toml) installs `sources/sglang/python` and the CUDA 13 components. PyTorch 2.14.1, Transformers 5.19.0 and the other SGLang dependencies come from the source's own [`python/pyproject.toml`](https://github.com/tc-mb/sglang/blob/aaab6bfc3de5354b052f2e96d5e566d70b9f69a2/python/pyproject.toml). The installer uses a separate `.venv-sglang` environment because the vLLM profile requires a different PyTorch version.

Prepare the system build dependencies on Ubuntu 22.04. Run as root, or prefix APT commands with `sudo`:

```bash
apt-get update
apt-get install -y software-properties-common build-essential pkg-config libssl-dev curl ca-certificates protobuf-compiler
add-apt-repository -y ppa:ubuntu-toolchain-r/test
apt-get update
apt-get install -y gcc-13 g++-13 libdw-dev libelf-dev
```

> **Driver compatibility:** CUDA 13 normally requires driver ≥580. For supported GPUs with an older driver, configure the compatibility library as described in the [FAQ](./faq_en.md#cuda-driver-version-is-insufficient). Set its environment variables in the installation, service and GPU SDK terminals.

Install the service environment:

```bash
bash scripts/install.sh sglang
source .venv-sglang/bin/activate
```

The installer creates or reuses `.venv-sglang`, installs `rustup` if needed, and selects the Rust version pinned by the SGLang source (1.92 for this commit). It also prepares the CUDA compiler and library links. If the driver's `libcuda.so.1` is outside `/usr/lib/x86_64-linux-gnu`, set `OCR_LIBCUDA` to its path before installation. When using the driver compatibility library, keep the value configured in the FAQ.

Check the environment:

```bash
uv pip check
"$(python -c 'import sysconfig; print(sysconfig.get_path("purelib") + "/nvidia/cu13/bin/nvcc")')" --version
python -c 'import sglang; print(sglang.__file__)'
python -c 'import torch, transformers; print("torch", torch.__version__, "CUDA", torch.version.cuda, "transformers", transformers.__version__); x = torch.ones(1, device="cuda"); print(torch.cuda.get_device_name(0), (x + 1).item())'
```

The SGLang path should point into `sources/sglang/python/sglang`; NVCC should report CUDA 13.0.

SGLang provides the model configuration and image processor for this PR. Its installation uses its own dependency list; the tutorial's Transformers adaptation checkout is used by vLLM and is not installed here.

## 4. Prepare the models

Download the SDK's PP-DocLayoutV3 layout model, or reuse the directory prepared for vLLM:

```bash
mkdir -p models
curl -fL -o ./models/PP-DocLayoutV3_infer.tar \
  https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-DocLayoutV3_infer.tar
tar xf ./models/PP-DocLayoutV3_infer.tar -C ./models
```

Download the [MiniCPM-OCR-1.0 target model](https://huggingface.co/openbmb/MiniCPM-OCR-1.0) and its matched [MiniCPM-OCR-1.0-DSpark draft model](https://huggingface.co/openbmb/MiniCPM-OCR-1.0-DSpark):

```bash
source .venv-sglang/bin/activate
hf download openbmb/MiniCPM-OCR-1.0 --local-dir ./models/MiniCPM-OCR-1.0
hf download openbmb/MiniCPM-OCR-1.0-DSpark --local-dir ./models/MiniCPM-OCR-1.0-DSpark
```

If the models are already present, reuse them. Set `--model-path` below to the DSpark target directory, `--speculative-draft-model-path` to its matched draft directory, and the SDK's `layout.model_dir` to the layout model directory.

## 5. Start the service

Open a service terminal at the repository root. On a single-GPU machine, finish the SDK run and stop the previous inference service before starting SGLang so that its GPU memory is available.

> **Older drivers:** Set the compatibility-library environment variables in this terminal before starting the service, as described in the [FAQ](./faq_en.md#cuda-driver-version-is-insufficient). Activating `.venv-sglang` does not restore variables from another terminal.

```bash
source .venv-sglang/bin/activate
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
export RUSTUP_TOOLCHAIN=1.92
export CC=gcc-13 CXX=g++-13
export CUDA_HOME="$(python -c 'import sysconfig; print(sysconfig.get_path("purelib") + "/nvidia/cu13")')"
export PATH="$CUDA_HOME/bin:$PATH"

CUDA_VISIBLE_DEVICES=0 python -m sglang.launch_server \
  --model-path ./models/MiniCPM-OCR-1.0 \
  --served-model-name minicpm-ocr \
  --host 127.0.0.1 --port 18499 \
  --context-length 40960 \
  --max-running-requests 32 \
  --mem-fraction-static 0.85 \
  --speculative-algorithm DSPARK \
  --speculative-draft-model-path ./models/MiniCPM-OCR-1.0-DSpark \
  --default-chat-template-kwargs '{"enable_thinking":false}'
```

`--speculative-algorithm DSPARK` enables DSpark. SGLang reads the draft block size from the draft configuration and derives its verification window; do not copy vLLM's `--speculative-config` JSON into this command.

The source checkout can compile its Rust cache extension on first startup. Keep Cargo's directory in `PATH` and use Rust 1.92 in this terminal; the system Cargo may be older even after the installation script finishes. Reactivating the virtual environment resets `PATH`, so rerun all exports in this block after activation.

> **GPU and port:** `CUDA_VISIBLE_DEVICES=0` selects physical GPU 0. Change it to another GPU index when needed. If another service already uses port `18499`, choose a free port here and use the same port in the SDK command below. Services sharing a GPU also share its available memory.

> **Concurrency:** This SGLang configuration permits up to 32 running requests, including with DSpark enabled. The SDK example below sends at most 32 requests concurrently. Reduce both values if memory is insufficient; actual capacity also depends on image size and sequence length.

The chat-template setting disables thinking mode, as required by the adaptation PR. Check readiness in another terminal:

```bash
curl --noproxy 127.0.0.1 -f http://127.0.0.1:18499/v1/models
```

The returned model list should include `minicpm-ocr`.

## 6. Parse a document with the SDK

In a separate terminal at the repository root:

```bash
source .minicpm-ocr/bin/activate

minicpmvocr parse --config sdk/minicpmvocr/configs/minicpmvocr.yaml \
  --backend sglang \
  --server-url http://127.0.0.1:18499 \
  --model minicpm-ocr \
  --set layout.model_dir="$PWD/models/PP-DocLayoutV3_infer" \
  --set layout.device=cuda:0 \
  --set pipeline.queue_mode=concurrent \
  --set engine.max_model_len=40960 \
  --set pipeline.max_workers=32 \
  --set pipeline.merge_cross_page_tables=false \
  --set pipeline.overlap_layout=true \
  --input doc.pdf --output doc.md
```

The input can be a PDF, PNG or JPG. PDFs are parsed in full; add `--set input.limit=1` to check only the first page. The SDK model name must match the service's `--served-model-name`.

`pipeline.overlap_layout=true` lets layout detection and recognition run at the same time. `pipeline.max_workers=32` limits concurrent recognition requests, rather than pages; adjust it for the service's capacity. `pipeline.queue_mode` applies when layout overlap is disabled. `--backend sglang` selects SGLang; the SDK internally maps this alias to its OpenAI-compatible client.

> **CPU layout detection:** Use the CPU PaddlePaddle environment configured above, activate `.minicpm-ocr`, and replace `--set layout.device=cuda:0` with `--set layout.device=cpu`.

> **GPU selection:** `cuda:0` selects the first GPU visible to the SDK process. If that process uses `CUDA_VISIBLE_DEVICES=3`, its single visible GPU is addressed as `cuda:0`. New terminals using an older driver must also restore the compatibility-library environment variables from the [FAQ](./faq_en.md#cuda-driver-version-is-insufficient) before running GPU layout detection or the service.

## Troubleshooting

| Symptom | Check |
|---|---|
| Unknown `minicpm_ocr` model type or architecture | Confirm the source is at the pinned PR commit and was installed in `.venv-sglang` |
| CUDA driver error | Check driver compatibility and the compatibility-library environment variables in the [FAQ](./faq_en.md#cuda-driver-version-is-insufficient) |
| `nvcc` not found or NVCC linking files missing | Restore `CUDA_HOME` and `PATH` from step 5; rerun `bash scripts/install.sh sglang` if the compiler files are incomplete |
| NVCC reports an unknown `--compress-mode=size` option | Restore `CUDA_HOME` and `PATH` from the service command, then restart the service |
| Rust cache compilation fails with `edition2024` or Cargo exit code 101 | Check the first compiler error. For `edition2024`, restore Cargo's `PATH` and `RUSTUP_TOOLCHAIN` from step 5; `cargo --version` should report 1.92.0 |
| Out of GPU memory | Reduce `--max-running-requests`, SDK workers, or `--context-length`; keep `engine.max_model_len` consistent with the service |
| Thinking tags in the output | Keep `--default-chat-template-kwargs '{"enable_thinking":false}'` when starting the service |

See the [SGLang documentation](https://docs.sglang.io/) for other hardware platforms and serving options.
