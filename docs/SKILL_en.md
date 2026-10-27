---
name: minicpmvocr-sdk
description: Install, deploy and verify MiniCPM-OCR 1.0 document parsing (PDF / image → Markdown). Use when the user wants to install the minicpmvocr SDK, start a vLLM or transformers inference service (including the DSpark accelerated build), parse documents, troubleshoot installation or inference errors, or run a word-for-word vLLM vs transformers two-sided verification.
---

# MiniCPM-OCR 1.0 deployment

The SDK (`minicpmvocr`) handles layout detection (PP-DocLayoutV3), chunking, stitching and concurrency scheduling, and calls the inference service over HTTP. The SDK and the inference service are installed in separate venvs.

## 1. Determine the plan

First ask which inference backend the user wants, and whether the SDK and the service are on the same machine. If the user has no preference, use the default plan.

| User goal | Environment |
|---|---|
| Parse documents (default) | `sdk-env` + `vllm-ocr-env`, DSpark accelerated build |
| Do not want to compile vLLM | `sdk-env` + `tf-ocr-env` |
| Already have llama.cpp / OpenAI-compatible service | Install `sdk-env` only |
| Word-for-word vLLM vs transformers verification | Both inference environments, or a combined `ocr-env` (see section 7) |

- Install only one inference environment, unless the user needs two-sided verification.
- `sdk-env` must not be installed together with torch / vLLM, otherwise numpy and opencv versions conflict.
- The SDK can run on a machine without a GPU, connecting to a remote service via `--server-url` or an SSH tunnel.

## 2. Pre-installation checks

```bash
nvidia-smi                                                      # VRAM ≥ 24 GB, driver ≥ 580
nvidia-smi --query-compute-apps=pid,used_memory --format=csv    # find an idle GPU
df -h .                                                         # at least 20 GB free
```

- Drivers 535–579 cannot run the default combination (torch cu130). Tell the user they need to upgrade the driver, or build vLLM themselves with torch cu126 (verified on A100; not covered by this skill).
- The vLLM environment needs Python ≥ 3.11; the SDK and transformers environments ≥ 3.10.

Paths the user must provide (ask if not given; do not guess):

| Placeholder | Meaning |
|---|---|
| `<SDK_REPO>` | Official repository: `https://github.com/OpenBMB/MiniCPM-OCR.git` |
| `<VLLM_SRC>` | feat-ocr vLLM source directory (commit `5c2b92a5dc`) |
| `<TRANSFORMERS_SRC>` | feat-ocr transformers source directory (commit `69eafbc5bd`) |

All commands below run in the same working directory: environments are created in directories such as `./sdk-env`, models are in `./models/`, and the repository is cloned into `./minicpmvocr-sdk/`, with the SDK source in its `sdk/` subdirectory.

## 3. Installation

### 3.1 sdk-env

```bash
python3 -m venv sdk-env && source sdk-env/bin/activate
pip install paddlepaddle-gpu==3.3.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu129/
# Without a GPU, install the CPU build instead: pip install paddlepaddle==3.2.1
git clone <SDK_REPO> minicpmvocr-sdk
pip install -e "./minicpmvocr-sdk/sdk[all]"
pip install paddlex==3.4.2
minicpmvocr list-backends
```

Pass criterion: the output contains the backends `vllm`, `llamacpp`, `openai` and the three layout providers `ppdoclayout3_paddlex`, `ppdoclayout3_torch`, `ppdoclayout3_server`.

If the CPU build of paddle is installed, every subsequent `minicpmvocr` command needs `--set layout.device=cpu`.

### 3.2 vllm-ocr-env

```bash
sudo add-apt-repository -y ppa:ubuntu-toolchain-r/test
sudo apt-get update && sudo apt-get install -y gcc-13 g++-13 libdw-dev libelf-dev

python3.13 -m venv vllm-ocr-env && source vllm-ocr-env/bin/activate
pip install torch==2.14.0 torchaudio==2.11.0 torchvision==0.29.0
pip install "transformers>=5.16.1,<5.20.0"
pip install "setuptools-rust>=1.9.0" "setuptools-scm>=8.0" "setuptools>=77.0.3,<81.0.0" \
    "cmake>=3.26.1" ninja packaging wheel jinja2
pip install nvidia-cuda-nvcc==13.0.48 nvidia-cuda-crt==13.0.48 nvidia-nvvm==13.0.48 \
    nvidia-cuda-runtime==13.0.96 nvidia-cuda-nvrtc==13.0.88 nvidia-nvjitlink==13.4.92 \
    nvidia-cuda-cccl==13.3.4.3.1
```

`nvidia-cuda-cccl` cannot be omitted; without it you get `cuda_fp16.h: nv/target: No such file or directory`.

Fill in the directory layout of the pip CUDA packages:

```bash
CU="$VIRTUAL_ENV/lib/python$(python -c 'import sys; print("%d.%d" % sys.version_info[:2])')/site-packages/nvidia/cu13"
mkdir -p "$CU/nvvm/bin" && ln -sf "$CU/bin/cicc" "$CU/nvvm/bin/cicc"
ln -sfn lib "$CU/lib64"
ln -sf "$CU/lib/libcudart.so.13" "$CU/lib/libcudart.so"
ln -sf "$CU/lib/libnvrtc.so.13" "$CU/lib/libnvrtc.so"
mkdir -p "$CU/lib64/stubs" && ln -sf /usr/lib/x86_64-linux-gnu/libcuda.so.1 "$CU/lib64/stubs/libcuda.so"
```

If the 13.0.48 packages lack `bin/crt/link.stub`, `prelink.stub` or `bin/nvdisasm`, copy them from a 13.4.92 environment on the same machine into the corresponding location under `$CU/bin/`.

Compile (about 20 minutes on 96 cores; lower `MAX_JOBS` when memory is small):

```bash
cd <VLLM_SRC>
# If GitHub is unreachable, first set the variables under "Offline compilation" below
CUDA_HOME="$CU" PATH="$VIRTUAL_ENV/bin:$CU/bin:$PATH" \
  CC=gcc-13 CXX=g++-13 CUDAHOSTCXX=g++-13 MAX_JOBS=64 \
  pip install -e . --no-build-isolation --progress-bar off
cd -
python -c "from vllm import LLM; print('vLLM OK')"
```

Do not use `import vllm._C` to judge whether compilation succeeded. On this branch the extension is named `_C_stable_libtorch.abi3.so`.

The DSpark main model uses the `minicpm_ocr` architecture, which PyPI transformers does not support. Install the feat-ocr transformers after vLLM is compiled; the order cannot be reversed:

```bash
pip install --no-deps -e <TRANSFORMERS_SRC>
python -c "import transformers; print(transformers.__version__)"   # should be 5.19.0.dev0
```

Offline compilation (when CMake times out fetching CUTLASS and other dependencies):

```bash
DEPS=<existing vLLM source>/.deps
export VLLM_CUTLASS_SRC_DIR="$DEPS/cutlass-src"
export VLLM_FLASH_ATTN_SRC_DIR="$DEPS/vllm-flash-attn-src"
export FLASH_KDA_SRC_DIR="$DEPS/flashkda-src"
export DEEPSELECT_SRC_DIR="$DEPS/deepselect-src"
export FLASH_MLA_SRC_DIR="$DEPS/flashmla-src"
export TRITON_KERNELS_SRC_DIR="$DEPS/triton_kernels-src/python/triton_kernels/triton_kernels"
export TML_FA4_SRC_DIR="$DEPS/tml_fa4-src"
export FMHA_SM100_SRC_DIR="$DEPS/fmha_sm100-src"
export QUTLASS_SRC_DIR="$DEPS/qutlass-src"
export DEEPGEMM_SRC_DIR="$DEPS/deepgemm-src"
export CMAKE_ARGS="-DCUTLASS_ENABLE_TESTS=OFF"   # otherwise googletest is also fetched
```

Warnings that can be ignored after compiling:

- `vllm.third_party.deep_gemm ... undefined symbol: _ZSt8to_charsPcS_DF128_`: OCR models do not use DeepGEMM.
- `FlashInfer's precompiled kernels are missing or do not match`: cold start is slightly slower (about 104 seconds of initialization measured), with no effect on results.

### 3.3 tf-ocr-env

```bash
python3 -m venv tf-ocr-env && source tf-ocr-env/bin/activate
pip install torch==2.14.0 torchvision
pip install -e <TRANSFORMERS_SRC>         # install "<TRANSFORMERS_SRC>[serving]" if you need the OpenAI-compatible service
pip install accelerate
# Optional acceleration kernels; without them it falls back to the reference implementation, same results but slower:
# pip install causal-conv1d flash-linear-attention
```

### 3.4 Download models

Main model: [MiniCPM-OCR-1.0](https://huggingface.co/openbmb/MiniCPM-OCR-1.0); DSpark draft model: [MiniCPM-OCR-1.0-DSpark](https://huggingface.co/openbmb/MiniCPM-OCR-1.0-DSpark).

```bash
# DSpark: the main model and draft must come from the same release and must not be mixed with other checkpoints
HF_ENDPOINT=https://hf-mirror.com hf download openbmb/MiniCPM-OCR-1.0 --local-dir ./models/MiniCPM-OCR-1.0
HF_ENDPOINT=https://hf-mirror.com hf download openbmb/MiniCPM-OCR-1.0-DSpark --local-dir ./models/MiniCPM-OCR-1.0-DSpark
sha256sum ./models/MiniCPM-OCR-1.0-DSpark/model.safetensors   # compare with weight_sha256 in release_manifest.json

curl -L -o PP-DocLayoutV3_infer.tar \
  https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-DocLayoutV3_infer.tar
tar xf PP-DocLayoutV3_infer.tar
export OCR_LAYOUT_MODEL_DIR=$PWD/PP-DocLayoutV3_infer
test -f "$OCR_LAYOUT_MODEL_DIR/inference.pdiparams" && echo "layout OK"
```

- ModelScope: `modelscope download --model <MS_REPO_ID> --local_dir <same-named directory>`.
- The main model directory should contain `config.json`, `model.safetensors`, `tokenizer.json`, `preprocessor_config.json`, `chat_template.jinja`.
- `OCR_LAYOUT_MODEL_DIR` must be a Paddle inference directory (containing `inference.pdiparams`, `inference.json`, `inference.yml`), not a safetensors directory.

## 4. Start the inference service

Before starting vLLM in each new shell, set `CUDA_HOME`; otherwise the first start on Blackwell GPUs fails with `Could not find nvcc`:

```bash
source vllm-ocr-env/bin/activate
CU="$VIRTUAL_ENV/lib/python$(python -c 'import sys; print("%d.%d" % sys.version_info[:2])')/site-packages/nvidia/cu13"
export CUDA_HOME="$CU" PATH="$VIRTUAL_ENV/bin:$CU/bin:$PATH"
```

### 4.1 DSpark accelerated build (default)

```bash
CUDA_VISIBLE_DEVICES=<idle GPU> python -m vllm.entrypoints.openai.api_server \
  --model ./models/MiniCPM-OCR-1.0 \
  --served-model-name minicpm-ocr \
  --port 18499 \
  --max-model-len 40960 \
  --max-num-batched-tokens 40960 \
  --max-num-seqs 1 \
  --attention-backend FLASH_ATTN \
  --mm-encoder-attn-backend FLASH_ATTN \
  --mm-processor-kwargs '{"downsample_mode":"4x"}' \
  --gpu-memory-utilization 0.85 \
  --trust-request-mm-kwargs \
  --speculative-config '{"method":"dspark","model":"./models/MiniCPM-OCR-1.0-DSpark","num_speculative_tokens":15,"enable_adaptive_verification":false}' \
  --default-chat-template-kwargs '{"enable_thinking":false}'
```

- `--max-num-seqs 1` means only one request is handled at a time, so the SDK's concurrent requests queue up. If the user needs high throughput, start multiple instances and pass `--server-url` repeatedly, or switch to the standard build.
- Start the service with `--served-model-name minicpm-ocr` and use `--model minicpm-ocr` in the SDK parsing command. If you change the name, update both options.

### 4.2 Standard build (no speculative sampling)

```bash
CUDA_VISIBLE_DEVICES=<idle GPU> python -m vllm.entrypoints.openai.api_server \
  --model ./models/MiniCPM-OCR-1.0 \
  --served-model-name minicpm-ocr \
  --port 18499 \
  --max-model-len 40960 \
  --limit-mm-per-prompt '{"image": 36}' \
  --gpu-memory-utilization 0.85 \
  --trust-request-mm-kwargs
```

Both builds must include `--trust-request-mm-kwargs`. Without it the service returns 400 for every request and the SDK retries silently until it errors out after 600 seconds, which looks like a hang.

### 4.3 transformers serve

```bash
source tf-ocr-env/bin/activate
transformers serve ./models/MiniCPM-OCR-1.0 --port 18499 --host 0.0.0.0 --continuous-batching
```

### 4.4 Readiness check

```bash
curl --noproxy 127.0.0.1 http://127.0.0.1:18499/v1/models     # first start takes about 3 minutes
```

It is only ready if the response contains `"id":"minicpm-ocr"`. If the first start times out or gets SIGTERM during CUDA graph capture, simply restart once (the compilation cache has been generated); if it still fails, add `--enforce-eager`.

## 5. Parse documents

```bash
source sdk-env/bin/activate
export OCR_LAYOUT_MODEL_DIR=$PWD/PP-DocLayoutV3_infer
export PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True

minicpmvocr parse --config minicpmvocr-sdk/configs/backends/vllm.yaml \
  --server-url http://127.0.0.1:18499 \
  --model minicpm-ocr \
  --set input.limit=1 --input <file> --output out.md
```

- Start with `--set input.limit=1` to parse only one page; once it passes, remove it to parse all pages.
- The configuration files are all in `minicpmvocr-sdk/configs/backends/`: `vllm.yaml` for vLLM; `openai.yaml` for transformers serve and other OpenAI-compatible services; `llamacpp.yaml` for llama.cpp.
- With `openai.yaml` add `--set engine.extra_body='{"chat_template_kwargs":{"enable_thinking":false}}'`, otherwise the output may be empty or garbled. `vllm.yaml` already disables thinking mode automatically.
- On multi-GPU machines layout detection uses GPU 0 by default. If GPU 0 is occupied, add `--set layout.device=cuda:N`.
- Commands other than `parse` (`run`, `parse-layout`, `prepare`, `infer`, `show-config`) all need the input specified via `--set input.file_path`, `input.files_dir` or `input.image_dir`.
- Relative paths in `--set` are resolved against the configuration file's directory, so always write absolute paths (such as `$PWD/doc.pdf`). `--input` is resolved against the current directory.
- `run`'s output directory is determined by the fixed `run.run_tag` in the configuration, and pages that already have results are skipped. Before rerunning, change `--set run.run_tag=<new name>`.
- Artifacts are written under `runs/` in the SDK directory by default. If disk space is tight, add `--set run.run_root=<absolute path on another disk>`.

## 6. Verify results

```bash
python - <<'PY'
from pathlib import Path
md = Path("out.md").read_text(encoding="utf-8")
assert md.strip(), "output is empty"
assert "<otsl>" not in md, "table is still OTSL, not converted to HTML"
print("OK", len(md), "chars", "| table" if "<table>" in md else "")
PY
```

- Table pages should contain `<table>`, formula pages should contain LaTeX (such as `\frac`), and body-text pages should contain readable text.
- For the DSpark build, also confirm that speculative sampling is active. After sending a few requests:

```bash
curl --noproxy 127.0.0.1 -s http://127.0.0.1:18499/metrics | grep spec_decode_num
```

You should see `spec_decode_num_accepted_tokens_total` and `spec_decode_num_drafts_total`, and the values should increase with requests. accept length = 1 + accepted / drafts, which was 5.2–7.0 in the verification environment. If neither metric is present, the service was started without `--speculative-config`. A service that responds does not mean DSpark is active.

## 7. Optional: word-for-word two-sided verification

Do this only when the user asks for it. `verify_transformers.py` and `verify_vllm.py` are provided with the feat-ocr source, not in the SDK. If the user does not have these two scripts, skip this step and do not claim that the two sides were verified to match.

If you want to run both sides in one environment, do it in the environment where vLLM is already compiled (the order cannot be reversed):

```bash
pip install --no-deps -e <TRANSFORMERS_SRC>
pip install --no-deps accelerate
python -c "import transformers, vllm, torch; print(transformers.__version__, vllm.__version__, torch.__version__)"
```

Run each side separately:

```bash
# transformers side (tf-ocr-env or the combined environment)
CUDA_VISIBLE_DEVICES=<idle GPU> python verify_transformers.py \
  --model ./models/MiniCPM-OCR-1.0 --image table.png \
  --prompt "请识别图中的表格并输出 OTSL" --attn sdpa --max-new-tokens 512

# vLLM side (vllm-ocr-env or the combined environment; set CUDA_HOME as in section 4 first)
CUDA_VISIBLE_DEVICES=<idle GPU> python verify_vllm.py \
  --model ./models/MiniCPM-OCR-1.0 --image table.png \
  --prompt "请识别图中的表格并输出 OTSL" --max-tokens 512
```

Pass criteria:

- The transformers side loads with no missing, unexpected or mismatched keys, and the parameter count is 1.300B.
- Both sides have the same prompt token count and produce word-for-word identical output, both ending with `</otsl>`.

Reference values (1080×1080 table image): prompt 1975 tokens, vision 1936 tokens, 284 tokens generated, 677 characters of output. These numbers change with a different image or prompt; the criterion is that the two sides agree.

## 8. Troubleshooting

### Installation and compilation

| Symptom | Action |
|---|---|
| `Failed to clone https://github.com/nvidia/cutlass.git` | GitHub is unreachable; set `*_SRC_DIR` as in the offline compilation in 3.2 |
| Still fetches `googletest` after disabling the CUTLASS fetch | Set `CMAKE_ARGS="-DCUTLASS_ENABLE_TESTS=OFF"` |
| `Could not find a package configuration file provided by "MLIR"` | The `TRITON_KERNELS_SRC_DIR` level is wrong; it should point to `.../python/triton_kernels/triton_kernels` |
| Many `FAILED: [code=9]` during compilation | Compiler processes were killed for lack of memory. Lower `MAX_JOBS` (8–32 for 147 GB of RAM), and install `ccache` first to avoid recompiling |
| `ld: cannot find -lcudart` | Add the `lib64`, `libcudart.so` and `stubs/libcuda.so` links from 3.2 |
| `CUDA_nvrtc_LIBRARY ... NOTFOUND` | Add the `libnvrtc.so` link |
| `cuda_fp16.h ... nv/target: No such file` | Install `nvidia-cuda-cccl==13.3.4.3.1` |
| `No module named vllm._C` | Not a compilation failure; verify with `from vllm import LLM` |
| transformers in the vLLM environment is `5.19.0` instead of `5.19.0.dev0` | The editable install was overwritten by vLLM dependencies; re-run `pip install --no-deps -e <TRANSFORMERS_SRC>` |
| Layout reports missing `pypdfium2` | `pip install "pypdfium2>=4"`; needed even for image-only processing |

### Starting the service

| Symptom | Action |
|---|---|
| `model type 'minicpm_ocr' ... does not recognize this architecture` | The vLLM environment lacks feat-ocr transformers; install as in 3.2. vLLM does not need to be recompiled |
| `Could not find nvcc` | `CUDA_HOME` was not set; see section 4 |
| `ptxas fatal: Unsupported .version 9.4` or `CUDA compiler and CUDA toolkit headers are incompatible` | Unify nvcc, runtime, nvrtc and nvjitlink on 13.4.92, then add the links as in 3.2 |
| `flashinfer-cubin version does not match` | `pip uninstall flashinfer-cubin`; run `vllm download-kernels` if it exists |
| `CUDA driver version is insufficient` | Driver is below 580; see section 2 |
| With a driver below 580: `TopKMaskLogits ... device kernel image is invalid` | Set `VLLM_USE_FLASHINFER_SAMPLER=0`; greedy decoding results are the same |
| With a driver below 580: `nvcc fatal: Unknown option '--compress-mode=size'` | Point `CUDA_HOME` at the toolchain matching torch (cu126 corresponds to 12.8) |
| `libtorchcodec_image.so` when importing vLLM | `pip uninstall torchcodec` |
| `Free memory on device ... less than desired GPU memory utilization` | That GPU is occupied; switch `CUDA_VISIBLE_DEVICES` |
| OOM | Lower `--gpu-memory-utilization` to 0.7, or lower `--max-model-len` to 16384 |
| CUDA graph capture times out or gets SIGTERM | Restart once; if it still fails, add `--enforce-eager` |

### Parsing

| Symptom | Action |
|---|---|
| Parsing produces no result for a long time and the log shows `request failed until timeout` | The service is missing `--trust-request-mm-kwargs`, so requests are rejected and the SDK keeps retrying until the 600-second timeout |
| The SDK waits a long time and then reports `no ... endpoint became ready within 1800s` | The service is not up or the address is wrong; check with `curl /v1/models` first |
| Requests with images return 400 | The standard build is missing `--limit-mm-per-prompt '{"image": 36}'` |
| Output is empty or garbled | Thinking mode was not disabled; see section 5 |
| Tables are `<otsl>` rather than `<table>` | Direct API calls do not convert them; go through the SDK pipeline |
| Crop images report `assign N multimodal tokens to M placeholders` | The vLLM version is too old; switch to the feat-ocr build |
| Layout reports a CUDA error | The CPU build of paddle is installed; add `--set layout.device=cpu` |
| `At least one of input.image_dir / input.files_dir / input.file_path is required` | Add `--set input.file_path=<absolute path to the file>` |
| `input.file_path not found` although the file exists | A relative path was used in `--set`; change it to an absolute path |
| `run` produces the same results when rerun | Change `--set run.run_tag=<new name>` |
| pip times out | Use a domestic mirror. When accessing localhost, set `no_proxy=127.0.0.1,localhost,::1` |
| The service is on a remote machine | `ssh -L 18499:127.0.0.1:18499 user@host`, and use `--server-url http://127.0.0.1:18499` in the SDK |

## 9. Verified versions

| Component | Version |
|---|---|
| vLLM environment | Python 3.13.9, torch 2.14.0+cu130, vLLM source `5c2b92a5dc`, feat-ocr transformers `69eafbc5bd` |
| transformers environment | Python 3.10.12 / 3.13.9, torch 2.14.0+cu130, transformers 5.19.0.dev0 (`69eafbc5bd`) |
| SDK environment | minicpmvocr 0.2.3, paddlepaddle-gpu 3.3.0 or paddlepaddle 3.2.1, paddlex 3.4.2 |
| Hardware | 3×RTX 5090, driver 590.48.01, Ubuntu 22.04.5 (2026-10-19) |

## 10. Reporting rules

- The 5090 is only the verification machine; do not say that a 5090 is required. The thresholds are VRAM ≥ 24 GB and driver ≥ 580.
- Report only the checks that were actually run. If two-sided verification was not run, do not say the two sides match; if `/metrics` was not checked, do not say DSpark is active.
- The SDK repository has no Web UI scripts; do not mention or direct the user to run any `demo_*.py`.
