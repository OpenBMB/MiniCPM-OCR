# llama.cpp Deployment Guide

[← Back to README](../README.md)

## Overview

llama.cpp enables CPU and local GPU inference with GGUF models, ideal for resource-constrained environments or offline deployment.

## Requirements

- **Hardware**: CPU with AVX2, or NVIDIA/AMD GPU
- **RAM**: ≥16GB system memory
- **Storage**: ~2.5GB for the F16 model + vision projector

## GGUF Weights

Download from [openbmb/ MiniCPM-OCR-1.0-gguf](https://huggingface.co/openbmb/MiniCPM-OCR-1.0-gguf):

| File | Size | Description |
|---|---|---|
| `MiniCPM-OCR-1_0-F16.gguf` | 1.4 GB | Language model (F16) |
| `mmproj-model-f16-4x.gguf` | 859 MB | Vision projector (4x downsample) |

Both files are required: the language model for `--model`, the projector for `--mmproj`.

Quantized versions (Q4_K_M, Q8_0) are coming soon. To quantize them yourself:

```bash
./build/bin/llama-quantize MiniCPM-OCR-1_0-F16.gguf MiniCPM-OCR-1.0-Q8_0.gguf Q8_0
```

## Installation

### Build from source

```bash
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp

# NVIDIA GPU
cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build -j --target llama-server llama-quantize

# AMD GPU:   cmake -B build -DGGML_HIP=ON ...
# CPU only:  cmake -B build ...
```

> Tips: on recent NVIDIA GPUs you can speed up the build by targeting one architecture,
> e.g. `-DCMAKE_CUDA_ARCHITECTURES=120` (RTX 5090), `90` (H100), or `80` (A100).
> See the official [build documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md)
> for the full list of options.

### Using pre-built binaries

Download from [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases).

## Serving

### Start server

```bash
./build/bin/llama-server \
  --model ./MiniCPM-OCR-1_0-F16.gguf \
  --mmproj ./mmproj-model-f16-4x.gguf \
  --host 0.0.0.0 \
  --port 18499 \
  --ctx-size 40960 \
  --n-gpu-layers 999
```

Flags:
- `--mmproj FILE`: path to the multimodal projector file — required for image input
- `--n-gpu-layers 999`: offload all layers to GPU; `0` for CPU-only inference
- `--ctx-size`: context window size

The official GGUF works out of the box — the embedded chat template already disables
thinking mode, so no extra template flags are needed. (If you convert the GGUF weights
yourself, start the server with `--chat-template-kwargs '{"enable_thinking":false}'`.)

### Verify service

```bash
curl http://127.0.0.1:18499/health
# {"status":"ok"}
```

## SDK Configuration

Install the SDK and layout model as described in the [SDK tutorial](./minicpmvocr_tutorial_en.md#installation), using `.minicpm-ocr` for the SDK environment. For CPU layout detection as shown below, replace the tutorial's `paddlepaddle-gpu` installation command with:

```bash
python -m pip install "paddlepaddle==3.2.1"
```

Then run from the root of this repository:

```bash
source .minicpm-ocr/bin/activate
export OCR_LAYOUT_MODEL_DIR="$PWD/PP-DocLayoutV3_infer"
export PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True

minicpmvocr parse --config sdk/minicpmvocr/configs/minicpmvocr.yaml \
  --backend llamacpp --server-url http://127.0.0.1:18499 \
  --model minicpm-ocr \
  --set layout.device=cpu \
  --set pipeline.queue_mode=serial \
  --set pipeline.max_workers=1 \
  --input doc.pdf --output doc.md
```

For GPU layout detection, install GPU PaddlePaddle as described in the SDK tutorial, activate `.minicpm-ocr`, and use `--set layout.device=cuda:0` instead.

> **Concurrency**: llama-server processes one request at a time by default. Keep
> `pipeline.queue_mode=serial` and `pipeline.max_workers=1` in the SDK options.

## Performance

Measured on a single RTX 5090 (32GB) with the F16 weights:

- Model + projector load: ~2.3s
- One table crop (1,312 prompt + 265 output tokens): ~1.0s
- VRAM: ~26GB with `--ctx-size 40960` — reduce the value on smaller GPUs
- CPU-only (48 threads): one table image end-to-end (layout + recognition + assembly) in ~21s

### Quantization trade-offs

| Quantization | Size | Table | Dense text / XML | Notes |
|---|---|---|---|---|
| F16 | 1.4 GB | baseline | baseline | highest fidelity |
| Q8_0 | 775 MB | lossless | ≈lossless | recommended balance |
| Q4_K_M | 505 MB | lossless | small degradation | closing-tag slashes may be dropped in dense code — prefer Q8_0 for code-heavy documents |

## Limitations

- Quantization introduces small accuracy loss (~1-2% on benchmarks, most visible on dense code/XML at Q4_K_M)
- No speculative decoding support (no DSpark)
- Slower than vLLM on high-end GPUs

---

For more details, see the [llama.cpp documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).
