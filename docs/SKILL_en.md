---
name: minicpmvocr-sdk
description: Install, deploy and verify the MiniCPM-OCR 1.0 document parsing SDK with vLLM, SGLang or llama.cpp, including DSpark, PDF/image to Markdown and installation troubleshooting. Use SKILL_jev_en.md for Jev scoring services.
---

# MiniCPM-OCR 1.0 installation, deployment and verification

[中文](./SKILL.md) · [Back to README](../README.md)

The SDK (command `minicpmvocr`, distribution `minicpm-ocr`) detects layout, crops regions and assembles results over HTTP with a separate inference service. Preserve the user's backend choice; otherwise select a route for their system and hardware. Install only the selected inference backend, keeping the SDK separate from PyTorch inference environments.

## 1. Choose a backend and working directory

| Situation | Inference environment | SDK backend | Detailed reference |
|---|---|---|---|
| Linux x86_64 + NVIDIA, default route | `.venv-vllm`, DSpark available | `vllm` | [SDK tutorial](./minicpmvocr_tutorial_en.md) |
| Linux x86_64 + NVIDIA, SGLang selected | `.venv-sglang`, DSpark available | `sglang` | [SGLang guide](./sglang_deploy.md) |
| CPU, local GPU or Apple Silicon, llama.cpp selected | `sources/llama.cpp/build`, GGUF weights | `llamacpp` | [llama.cpp guide](./llamacpp_deploy.md) |
| Existing compatible inference service | Reuse it; install only the SDK | Select by protocol | Section 7 below |

- Use `--backend sglang` for SGLang. The SDK internally maps `sglang` to the `openai`-compatible client; `list-backends` does not list SGLang separately. Select `llamacpp` for llama.cpp and avoid vLLM-specific request fields.
- A llama.cpp Metal server does not require CUDA. Full parsing also needs an SDK environment that can run PP-DocLayoutV3. If PaddlePaddle has no matching local wheel, use a compatible SDK host; a working Metal server alone does not validate the entire SDK.
- The SDK and server may run on different machines. Establish the actual OS, GPU/memory, free disk space, destination directory and endpoint; reuse information already provided.

Install the SDK directly from PyPI. When connecting to an existing inference service, run sections 3 and 7 in your own working directory without cloning this repository. To deploy vLLM or SGLang yourself, the installation steps below use repository scripts; enter an existing checkout or clone it first. Inference examples use the **MiniCPM-OCR repository root**; on a separate SDK host, `.minicpm-ocr`, `models/` and input/output paths are relative to its working directory:

```bash
git clone https://github.com/OpenBMB/MiniCPM-OCR.git
cd MiniCPM-OCR
```

## 2. Check versions and prerequisites against the checkout

Before deploying an inference service yourself, read the root [`pyproject.toml`](../pyproject.toml), [`scripts/install.sh`](../scripts/install.sh), [`sdk/pyproject.toml`](../sdk/pyproject.toml) and [`sdk/minicpmvocr/_version.py`](../sdk/minicpmvocr/_version.py). For SDK-only installation, use the PyPI package in section 3. The versions below describe this Skill's baseline. When the checkout changes, use its declarations and recheck launch arguments; do not mix old feat-ocr checkouts with the public adaptation.

| Component | Current source / version |
|---|---|
| SDK | PyPI package `minicpm-ocr[all]`; install or upgrade to the latest stable version compatible with the current Python, matching the [SDK tutorial](./minicpmvocr_tutorial_en.md) |
| Python | Installer default `3.12`; root project requires `>=3.11,<3.14` (SDK alone requires `>=3.10`) |
| vLLM | `fa3b9d1377219247060d3c8b49eae199c9e7e154`, prepared by the installer |
| Transformers required by vLLM | `144ecf007b8b4f2910da104c84a79801db6985a6`, pinned by the root project |
| PyTorch required by vLLM | `torch==2.14.0`, `torchvision==0.29.0` |
| SGLang | [Guide's pinned source](./sglang_deploy.md): `aaab6bfc3de5354b052f2e96d5e566d70b9f69a2`; the root project references a local path without downloading or checking this SHA |
| SGLang dependencies | That source declares `torch==2.14.1`, `transformers==5.19.0` and Rust toolchain `1.92`; keep it separate from vLLM |
| llama.cpp | `a08ab75ae74c36c15accc6c682a989a9e98dbfd2`, the merged MiniCPM-OCR 1.0 adaptation ([PR #30979](https://github.com/ggml-org/llama.cpp/pull/30979)) |
| SDK layout detection | `paddlepaddle==3.2.1` or `paddlepaddle-gpu==3.3.0`, `paddlex==3.4.2` |

For Linux CUDA routes, check:

```bash
uname -srm
nvidia-smi
nvidia-smi --query-compute-apps=pid,used_memory --format=csv
df -h .
```

The vLLM / SGLang installer requires Linux x86_64 and `gcc-13` / `g++-13`, using the CUDA 13 pip components declared by the project. CUDA 13 normally requires driver ≥580. For older drivers, check the GPU and compatibility library in the [FAQ](./faq_en.md#cuda-driver-version-is-insufficient); restore the relevant variables in every installation, server and GPU SDK terminal. Do not reject all backends based solely on the driver number.

Reserve at least 40 GB of disk space for the full vLLM setup described by the tutorial. Lower `MAX_JOBS` when RAM is limited; assess VRAM for the actual context length and concurrency rather than imposing one test machine's hardware. CPU / Metal routes do not need `nvidia-smi`; on Mac, check `xcode-select -p` and install CMake for compilation.

## 3. Install the SDK with pip

Follow the [SDK tutorial](./minicpmvocr_tutorial_en.md) to create a separate `.minicpm-ocr` environment, then install the published SDK package with pip. Reuse uv if installed; otherwise `python3 -m pip install uv` is an option. If system Python is managed under PEP 668, install uv in a separate tools venv. Installing the SDK itself does not require Git; provide Git, curl and build tools when deploying an inference service yourself.

Start with CPU layout detection to avoid consuming inference VRAM. On a machine with a supported PaddlePaddle wheel, run:

```bash
if [ ! -x .minicpm-ocr/bin/python ]; then
  uv venv .minicpm-ocr --python 3.12 --seed
fi
source .minicpm-ocr/bin/activate
python -m pip install --upgrade "minicpm-ocr[all]" "paddlex==3.4.2" "pypdfium2>=4"
python -m pip install "paddlepaddle==3.2.1"
python -m pip check
minicpmvocr list-backends
python -c 'from importlib.metadata import version; import minicpmvocr, paddle, paddlex; print(version("minicpm-ocr"), minicpmvocr.__file__); print(paddle.__version__, paddlex.__version__)'
```

Record the installed distribution version and confirm an import path under the `.minicpm-ocr` environment's `site-packages`. Backends should include `vllm`, `llamacpp`, `openai`, and layout providers should include `ppdoclayout3_paddlex`. These commands also retain the root project's `paddlex==3.4.2` and `pypdfium2>=4` dependencies to provide the layout requirements. Pin the SDK version when reproducing a specific environment.

For GPU layout detection, replace the CPU PaddlePaddle installation line above with the tutorial's GPU command (choose one of the CPU/GPU packages), then use `--device cuda:0` in later SDK commands. Keep using the same `.minicpm-ocr` environment:

```bash
python -m pip install "paddlepaddle-gpu==3.3.0" \
  -i https://www.paddlepaddle.org.cn/packages/stable/cu129/
```

Reuse an existing working SDK environment. Use an editable checkout installation only when developing or modifying SDK source; use the pip installation above for normal parsing.

Without `--config`, `parse` uses the bundled configuration and looks for `models/PP-DocLayoutV3_infer`, downloading and checking the official layout model when needed. Reuse an existing model with `--layout-model /absolute/path/PP-DocLayoutV3_infer`; it must contain `inference.pdiparams`, `inference.json`, `inference.yml`. Do not rely on this automatic download when providing an explicit model path or `--config`.

## 4. vLLM: install, launch and check readiness

Ubuntu system dependencies (install with appropriate permissions or ask the administrator to provide them):

```bash
sudo apt-get update
sudo apt-get install -y software-properties-common build-essential git curl ca-certificates
sudo add-apt-repository -y ppa:ubuntu-toolchain-r/test
sudo apt-get update
sudo apt-get install -y gcc-13 g++-13 libdw-dev libelf-dev
bash scripts/install.sh vllm
```

The installer prepares `sources/vllm` and `sources/transformers` at fixed SHAs, adjusts vLLM's Transformers requirement and prepares the CUDA compiler layout, using `MAX_JOBS=8` by default. It stops if an existing checkout has the wrong revision; preserve local work before resolving that mismatch rather than resetting it. Do not overwrite the adaptation with a floating Transformers install.

In a new server terminal at the repository root, run:

```bash
source .venv-vllm/bin/activate
uv pip check --python "$VIRTUAL_ENV/bin/python"
python -c 'import torch, transformers, vllm; print(torch.__version__, transformers.__version__, vllm.__version__)'
hf download openbmb/MiniCPM-OCR-1.0 --local-dir ./models/MiniCPM-OCR-1.0
hf download openbmb/MiniCPM-OCR-1.0-DSpark --local-dir ./models/MiniCPM-OCR-1.0-DSpark
export CC=gcc-13 CXX=g++-13
export CUDA_HOME="$(python -c 'import sysconfig; print(sysconfig.get_path("purelib") + "/nvidia/cu13")')"
export PATH="$CUDA_HOME/bin:$PATH"

CUDA_VISIBLE_DEVICES=0 vllm serve ./models/MiniCPM-OCR-1.0 \
  --served-model-name minicpm-ocr --host 127.0.0.1 --port 18499 \
  --max-model-len 40960 --max-num-batched-tokens 40960 --max-num-seqs 32 \
  --limit-mm-per-prompt '{"image":36,"video":0}' \
  --attention-backend FLASH_ATTN --mm-encoder-attn-backend FLASH_ATTN \
  --mm-processor-kwargs '{"downsample_mode":"4x"}' \
  --gpu-memory-utilization 0.85 --trust-request-mm-kwargs \
  --speculative-config '{"method":"dspark","model":"./models/MiniCPM-OCR-1.0-DSpark","num_speculative_tokens":15,"enable_adaptive_verification":false}' \
  --default-chat-template-kwargs '{"enable_thinking":false}'
```

Use target and draft models from the same release; reuse existing downloads. For ordinary decoding, remove the entire `--speculative-config` argument and skip the draft download. Adjust the example `CUDA_VISIBLE_DEVICES=0` to a free GPU. SDK requests require `--trust-request-mm-kwargs`. Do not copy SGLang's `DSPARK` arguments into vLLM.

Check from another terminal:

```bash
curl --noproxy 127.0.0.1 -fsS http://127.0.0.1:18499/v1/models
```

Once the model list includes `minicpm-ocr`, continue with image and SDK verification in section 7.

## 5. SGLang: prepare the pinned source, install and launch

This route follows the [SGLang guide](./sglang_deploy.md). Do not assume a plain `pip install sglang` includes the adaptation.

Install the APT build dependencies from section 4 (skip `bash scripts/install.sh vllm`; do not install vLLM), then add SGLang's tools:

```bash
sudo apt-get install -y pkg-config libssl-dev protobuf-compiler
mkdir -p sources
SGLANG_COMMIT=aaab6bfc3de5354b052f2e96d5e566d70b9f69a2
if [ ! -e sources/sglang ]; then
  git clone https://github.com/sgl-project/sglang.git sources/sglang &&
  git -C sources/sglang fetch origin pull/45799/head &&
  git -C sources/sglang checkout --detach "$SGLANG_COMMIT"
fi
test "$(git -C sources/sglang rev-parse HEAD)" = "$SGLANG_COMMIT" || {
  echo "SGLang source revision mismatch; preserve local work and resolve it before installing." >&2
  exit 1
}
protoc --version
bash scripts/install.sh sglang
```

The script installs from `sources/sglang/python`; it neither clones nor pins the SGLang checkout, so retain the revision check above. It reads `rust/rust-toolchain.toml`, installs rustup / Rust as needed and prepares the pip CUDA layout. If `libcuda.so.1` is outside its default location, set `OCR_LIBCUDA` to the actual path before installation; retain the FAQ settings when using a compatibility library.

In a new server terminal at the repository root, activate the environment first, then restore Cargo, Rust, C++ and CUDA settings so first-start extension compilation uses the right tools:

```bash
source .venv-sglang/bin/activate
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
export RUSTUP_TOOLCHAIN="$(python -c 'import tomllib; print(tomllib.load(open("sources/sglang/rust/rust-toolchain.toml", "rb"))["toolchain"]["channel"])')"
export CC=gcc-13 CXX=g++-13 CUDAHOSTCXX=g++-13
export CUDA_HOME="$(python -c 'import sysconfig; print(sysconfig.get_path("purelib") + "/nvidia/cu13")')"
export PATH="$CUDA_HOME/bin:$PATH"
uv pip check --python "$VIRTUAL_ENV/bin/python"
cargo --version
"$CUDA_HOME/bin/nvcc" --version
python -c 'import sglang, torch, transformers; print(sglang.__file__); print(torch.__version__, transformers.__version__); print((torch.ones(1, device="cuda") + 1).item())'
hf download openbmb/MiniCPM-OCR-1.0 --local-dir ./models/MiniCPM-OCR-1.0
hf download openbmb/MiniCPM-OCR-1.0-DSpark --local-dir ./models/MiniCPM-OCR-1.0-DSpark

CUDA_VISIBLE_DEVICES=0 python -m sglang.launch_server \
  --model-path ./models/MiniCPM-OCR-1.0 \
  --served-model-name minicpm-ocr --host 127.0.0.1 --port 18499 \
  --context-length 40960 --max-running-requests 32 --mem-fraction-static 0.85 \
  --speculative-algorithm DSPARK \
  --speculative-draft-model-path ./models/MiniCPM-OCR-1.0-DSpark \
  --default-chat-template-kwargs '{"enable_thinking":false}'
```

The package path should point into `sources/sglang/python/sglang`. This source uses Rust 1.92; NVCC should report the project's CUDA 13.0. Do not install the vLLM route's editable Transformers into this environment: SGLang supplies its own model configuration and processor adaptation.

For ordinary decoding, remove both `--speculative-algorithm` and `--speculative-draft-model-path` and skip the draft download. DSpark requires matched target and draft models; do not reuse vLLM's speculative JSON.

Run the section 4 `/v1/models` check from another terminal, confirm `minicpm-ocr`, then verify with `--backend sglang` in section 7. If the port is occupied, change it in both the server and every client address. Check the previous server's GPU usage before switching services on the same GPU.

## 6. llama.cpp: GGUF files, compilation and launch

llama.cpp needs both a language-model GGUF and a vision-projector GGUF rather than serving HF safetensors directly. This route uses the official F16 files from the [llama.cpp guide](./llamacpp_deploy.md). Reuse `hf` if available. If the server host has no SDK, create only a download environment; PaddlePaddle, torch and weight conversion are unnecessary:

```bash
if ! command -v hf >/dev/null; then
  if [ ! -x .venv-models/bin/python ]; then
    uv venv --python 3.12 .venv-models
  fi
  uv pip install --python .venv-models/bin/python huggingface-hub
  export PATH="$PWD/.venv-models/bin:$PATH"
fi
hf download openbmb/MiniCPM-OCR-1.0-gguf \
  MiniCPM-OCR-1_0-F16.gguf mmproj-model-f16-4x.gguf \
  --local-dir ./models/MiniCPM-OCR-1.0-gguf
mkdir -p sources
LLAMA_COMMIT=a08ab75ae74c36c15accc6c682a989a9e98dbfd2
if [ ! -e sources/llama.cpp ]; then
  git clone https://github.com/ggml-org/llama.cpp.git sources/llama.cpp &&
  git -C sources/llama.cpp checkout --detach "$LLAMA_COMMIT"
fi
test "$(git -C sources/llama.cpp rev-parse HEAD)" = "$LLAMA_COMMIT" || {
  echo "llama.cpp source revision mismatch; preserve local work and resolve it before building." >&2
  exit 1
}
git -C sources/llama.cpp rev-parse HEAD
```

This Skill pins the merged MiniCPM-OCR 1.0 adaptation. If an existing checkout has a different revision, preserve local work before resolving the version or using a separate directory; do not reset it. Confirm the SHA before building and avoid reusing an old binary from another revision.

On Ubuntu, install build dependencies first:

```bash
sudo apt-get update
sudo apt-get install -y cmake build-essential git curl ca-certificates
```

On macOS, check Command Line Tools; if missing, run `xcode-select --install` and wait for installation to finish. Install CMake with Homebrew:

```bash
xcode-select -p
brew install cmake
```

CUDA builds also need a discoverable full CUDA toolkit (`nvcc --version`, `CUDA_HOME`); the GPU driver alone is insufficient for compilation. CPU / Metal builds do not need CUDA. Run **one configuration block** for the selected platform. When changing backends, use a separate build directory or clear the CMake cache you generated:

Linux + NVIDIA:

```bash
cmake -S sources/llama.cpp -B sources/llama.cpp/build \
  -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
```

macOS + Apple Silicon (Metal is enabled by default):

```bash
cmake -S sources/llama.cpp -B sources/llama.cpp/build \
  -DCMAKE_BUILD_TYPE=Release
```

CPU (explicitly disable GPU backends):

```bash
cmake -S sources/llama.cpp -B sources/llama.cpp/build \
  -DGGML_CUDA=OFF -DGGML_METAL=OFF -DCMAKE_BUILD_TYPE=Release
```

Confirm that configuration output includes the intended backend, then build. Adjust `-j 8` for available RAM:

```bash
cmake --build sources/llama.cpp/build -j 8 --target llama-server
./sources/llama.cpp/build/bin/llama-server --version
```

Launch from the repository root (this guide uses port 18499 with an explicit client URL rather than relying on the SDK's backend default port):

```bash
./sources/llama.cpp/build/bin/llama-server \
  --model ./models/MiniCPM-OCR-1.0-gguf/MiniCPM-OCR-1_0-F16.gguf \
  --mmproj ./models/MiniCPM-OCR-1.0-gguf/mmproj-model-f16-4x.gguf \
  --alias minicpm-ocr --host 127.0.0.1 --port 18499 \
  --ctx-size 40960 --n-gpu-layers 999 --parallel 1 --reasoning off
```

For CPU inference, replace `--n-gpu-layers 999` with `--n-gpu-layers 0`. Context length 40960 is not a low-memory guarantee: reduce `--ctx-size` if RAM or VRAM is insufficient, and match `engine.max_model_len` in section 7. Keep `--reasoning off`: the adaptation PR notes that default `auto` can put transcription in `reasoning_content`, while the current SDK reads `content`, resulting in empty output. For self-converted weights, also inspect the template and add `--chat-template-kwargs '{"enable_thinking":false}'` as described by the guide. This llama.cpp route does not enable DSpark.

Check from another terminal:

```bash
curl --noproxy 127.0.0.1 -fsS http://127.0.0.1:18499/health
curl --noproxy 127.0.0.1 -fsS http://127.0.0.1:18499/v1/models
```

Expect `status=ok` from `/health` and check the `minicpm-ocr` alias in the model list, then continue with section 7. Do not replace these download paths with historical model defaults from SDK launch scripts.

## 7. Three verification layers: readiness, image request and one-page parsing

### 7.1 Readiness

Check `/v1/models` for the selected backend and also `/health` for llama.cpp. Match the client model name to the server. The SDK takes the server root URL `http://127.0.0.1:18499` without `/v1`. A health check establishes reachability only.

### 7.2 Send one real image crop through the current SDK client

Activate the installed SDK environment and prepare `sample.png`, a real text crop with readable text. Set `OCR_BACKEND` to `vllm` for vLLM, `sglang` for SGLang, or `llamacpp` for llama.cpp. Adjust the model ID and URL to the actual service:

```bash
source .minicpm-ocr/bin/activate
export OCR_BACKEND=llamacpp
export OCR_TEST_URL=http://127.0.0.1:18499
export OCR_TEST_MODEL=minicpm-ocr
python - <<'PYTEST'
import os
from copy import deepcopy
from PIL import Image
from minicpmvocr import DEFAULT_CONFIG, create_backend

cfg = deepcopy(DEFAULT_CONFIG)
cfg["engine"].update({
    "type": os.environ["OCR_BACKEND"],
    "server_url": os.environ["OCR_TEST_URL"],
    "model_name": os.environ["OCR_TEST_MODEL"],
    "max_model_len": 40960,
    "startup_timeout_sec": 60,
    "request_ready_timeout_sec": 30,
    "extra_body": {"chat_template_kwargs": {"enable_thinking": False}},
})
client = create_backend(cfg)
client.wait_ready(timeout_sec=60)
with Image.open("sample.png") as image:
    result = client.recognize(image.convert("RGB"), "Text Recognition:", max_new_tokens=2048)
assert result["text"].strip(), "Empty OCR output"
assert result["finish_reason"] != "length", "Output truncated; inspect the token budget"
print(result["text"])
print("finish_reason:", result["finish_reason"])
PYTEST
```

This uses the current `create_backend` / `recognize` interface to generate backend-specific requests instead of sending vLLM fields to other services. If the server context was reduced, update `max_model_len` in the script too. Inspect whether the output matches the image; a nonempty assertion is not a quality check. Direct client calls return raw model output; the full pipeline performs table postprocessing.

### 7.3 Parse one page with the SDK

Run **one** of the three examples for the selected backend after activating `.minicpm-ocr`. These use CPU layout detection; if GPU PaddlePaddle was selected in section 3, you can use `--device cuda:0`. Replace `doc.pdf` with a PNG/JPG if needed. Use `parse` with the bundled configuration to enable automatic layout-model preparation.

vLLM:

```bash
minicpmvocr parse --backend vllm \
  --server-url http://127.0.0.1:18499 --model minicpm-ocr \
  --device cpu --workers 1 --set input.limit=1 \
  --set engine.max_model_len=40960 \
  --input doc.pdf --output out-vllm.md
```

SGLang:

```bash
minicpmvocr parse --backend sglang \
  --server-url http://127.0.0.1:18499 --model minicpm-ocr \
  --device cpu --workers 1 --set input.limit=1 \
  --set engine.max_model_len=40960 \
  --set engine.extra_body='{"chat_template_kwargs":{"enable_thinking":false}}' \
  --input doc.pdf --output out-sglang.md
```

llama.cpp (one slot, serial recognition):

```bash
minicpmvocr parse --backend llamacpp \
  --server-url http://127.0.0.1:18499 --model minicpm-ocr \
  --device cpu --workers 1 --set input.limit=1 \
  --set engine.max_model_len=40960 \
  --set pipeline.queue_mode=serial --set pipeline.overlap_layout=false \
  --input doc.pdf --output out-llamacpp.md
```

Pass criteria: Markdown is nonempty, logs show no failed pages/regions, and text matches the image. On table pages, inspect HTML `<table>` output; on formula pages, inspect LaTeX. Check for unprocessed `<otsl>` and obvious truncation. After passing, remove `input.limit=1` to parse the full document; increase vLLM / SGLang SDK workers and server concurrency gradually according to VRAM.

Default parsing does not need `--config`. For custom configuration, locate the reference YAML in the installed package, then point `--config` at that file or your own copy and explicitly set `layout.model_dir` to a prepared model:

```bash
python -c 'from importlib.resources import files; print(files("minicpmvocr").joinpath("configs/minicpmvocr.yaml"))'
```

The source location is `sdk/minicpmvocr/configs/minicpmvocr.yaml`; pip users do not need that source path. Do not use the nonexistent `configs/backends/*.yaml` files. Paths in `--set` are relative to the configuration directory, so use absolute paths; `--input` is relative to the working directory. Staged commands such as `run` need `--set input.file_path=/absolute/path/doc.pdf`. Change `run.run_tag` when rerunning and use `run.run_root` to select another disk when needed.

### 7.4 Optional: verify DSpark acceleration

After enabling DSpark in vLLM and sending real requests, check:

```bash
curl --noproxy 127.0.0.1 -fsS http://127.0.0.1:18499/metrics | grep spec_decode_num
```

Report vLLM DSpark as active only when draft / accepted-token metrics increase with requests. For SGLang, inspect DSPARK behavior in its actual logs/metrics rather than reusing vLLM metric names.

## 8. Diagnose the failing stage and report evidence

| Symptom | Action |
|---|---|
| `Clone the SGLang source ... first` | Prepare and check the pinned source in section 5, then rerun the installer |
| Missing SGLang `protoc` or Rust build failure | Install `protobuf-compiler`; restore Cargo PATH and the source's `RUSTUP_TOOLCHAIN` in new terminals; read the first compiler error |
| Unknown `minicpm_ocr` | For vLLM, check both root-project source pins; for SGLang, check the PR SHA and import path. Do not overwrite one route's Transformers with the other's |
| Missing NVCC or unknown `--compress-mode=size` | Restore the selected server environment's `CUDA_HOME` / PATH and check the actual NVCC; avoid mixing toolchains from other environments |
| CUDA driver error | Check the GPU, driver and compatibility library in the FAQ and restore variables in the current terminal |
| llama.cpp cannot load the model or image | Check both GGUF files, source SHA, binary version and actual backend. A successful `/health` does not establish image support |
| llama.cpp linker / shared-library error | Inspect CMake logs, the CUDA toolkit and library search paths; resolve the actual missing library instead of copying historical absolute paths |
| vLLM returns 400 / SDK keeps retrying | Check `--trust-request-mm-kwargs`, image limits and the original server error |
| Empty output, thinking tags or garbled text | Check the actual model ID and thinking template settings; for llama.cpp, confirm the server was launched with `--reasoning off` and inspect the GGUF template |
| Out of VRAM / compiler process killed | Distinguish inference VRAM from build RAM; reduce context/concurrency or `MAX_JOBS` accordingly |
| `/v1/models` works but parsing fails | Run the single-crop request in 7.2, then isolate inference service, layout model/device and pipeline failures |
| Port occupied / remote service | Update server binding and client URLs together; an SSH tunnel can use `ssh -L 18499:127.0.0.1:18499 user@host` |

Report the actual backend, source SHAs/package versions, model files, device, endpoint and the separate outcomes of installation checks, health checks, image requests and one-page parsing. Installation success, service readiness, correct recognition and active DSpark are distinct conclusions. Do not delete user environments, reset source or conceal version mismatches with unverified temporary patches.

See [SDK configuration](./minicpmvocr_api_en.md) for parameter and API details. For Jev scoring, use the [Jev Skill](./SKILL_jev_en.md); its weights, classification architecture and validation criteria are separate.
