# llama.cpp Deployment Guide

[中文](./llamacpp_deploy_zh.md)

[← Back to README](../README.md)

Deploy MiniCPM-OCR 1.0 with the **Q8_0 main model, Q8_0 DSpark draft head, and F16 4× vision projector** together, with DSpark speculative decoding enabled. Run the commands below from the **root of this repository** in Bash.

## 1. Install llama.cpp

Use the verified reference version **[b11901](https://github.com/ggml-org/llama.cpp/releases/tag/b11901)**. You need Git, CMake, and a C++ compiler to build it:

```bash
mkdir -p ./sources
git clone --branch b11901 --depth 1 https://github.com/ggml-org/llama.cpp.git ./sources/llama.cpp
cmake -S ./sources/llama.cpp -B ./sources/llama.cpp/build -DCMAKE_BUILD_TYPE=Release
cmake --build ./sources/llama.cpp/build -j --target llama-server
./sources/llama.cpp/build/bin/llama-server --version
```

On Apple Silicon, the configuration above enables Metal by default; on Linux, it builds the CPU backend. For NVIDIA GPUs, append `-DGGML_CUDA=ON` to the `cmake -S ...` configuration command before building, with the CUDA toolkit installed. See the official [build instructions](https://github.com/ggml-org/llama.cpp/blob/b11901/docs/build.md) for other backends.

Alternatively, download and extract the package for your system from the same release page. Replace `./sources/llama.cpp/build/bin/llama-server` in the commands below with the extracted `llama-server` executable path. Keep the executable and its accompanying libraries together. The serving command below was verified with the official b11901 macOS ARM64 package.

## 2. Download the main model, projector, and DSpark draft

Download the main model and projector from the [main model repository](https://huggingface.co/openbmb/MiniCPM-OCR-1.0-gguf), and the matching quantized draft from the [DSpark GGUF repository](https://huggingface.co/openbmb/MiniCPM-OCR-1.0-DSpark-gguf). All three files are required; use matched weights from the same 1.0 release:

| File | Approximate size | Purpose |
|---|---|---|
| `MiniCPM-OCR-1_0-Q8_0.gguf` | 0.81 GB | Q8_0 main model |
| `mmproj-model-f16-4x.gguf` | 0.90 GB | F16 vision projector, required for image input |
| `dspark-MiniCPM-OCR-1_0-Q8_0.gguf` | 0.33 GB | Q8_0 DSpark draft model for speculative decoding |

```bash
mkdir -p ./models/MiniCPM-OCR-1.0-gguf
curl -fL --retry 3 \
  -o ./models/MiniCPM-OCR-1.0-gguf/MiniCPM-OCR-1_0-Q8_0.gguf \
  https://huggingface.co/openbmb/MiniCPM-OCR-1.0-gguf/resolve/main/MiniCPM-OCR-1_0-Q8_0.gguf
curl -fL --retry 3 \
  -o ./models/MiniCPM-OCR-1.0-gguf/mmproj-model-f16-4x.gguf \
  https://huggingface.co/openbmb/MiniCPM-OCR-1.0-gguf/resolve/main/mmproj-model-f16-4x.gguf
curl -fL --retry 3 \
  -o ./models/MiniCPM-OCR-1.0-gguf/dspark-MiniCPM-OCR-1_0-Q8_0.gguf \
  https://huggingface.co/openbmb/MiniCPM-OCR-1.0-DSpark-gguf/resolve/main/dspark-MiniCPM-OCR-1_0-Q8_0.gguf
```

If Hugging Face is unreachable, create the same directory and use the official ModelScope [main model repository](https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0-gguf) and [DSpark repository](https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0-DSpark-gguf) instead:

```bash
mkdir -p ./models/MiniCPM-OCR-1.0-gguf
curl -fL --retry 3 \
  -o ./models/MiniCPM-OCR-1.0-gguf/MiniCPM-OCR-1_0-Q8_0.gguf \
  https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0-gguf/resolve/master/MiniCPM-OCR-1_0-Q8_0.gguf
curl -fL --retry 3 \
  -o ./models/MiniCPM-OCR-1.0-gguf/mmproj-model-f16-4x.gguf \
  https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0-gguf/resolve/master/mmproj-model-f16-4x.gguf
curl -fL --retry 3 \
  -o ./models/MiniCPM-OCR-1.0-gguf/dspark-MiniCPM-OCR-1_0-Q8_0.gguf \
  https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0-DSpark-gguf/resolve/master/dspark-MiniCPM-OCR-1_0-Q8_0.gguf
```

## 3. Start the service

In a service terminal at the repository root:

```bash
./sources/llama.cpp/build/bin/llama-server \
  --model ./models/MiniCPM-OCR-1.0-gguf/MiniCPM-OCR-1_0-Q8_0.gguf \
  --mmproj ./models/MiniCPM-OCR-1.0-gguf/mmproj-model-f16-4x.gguf \
  --model-draft ./models/MiniCPM-OCR-1.0-gguf/dspark-MiniCPM-OCR-1_0-Q8_0.gguf \
  --spec-type draft-dspark \
  --spec-draft-n-max 15 \
  --n-gpu-layers 99 \
  --gpu-layers-draft 99 \
  --flash-attn on \
  --ctx-size 8192 \
  --parallel 1 \
  --host 127.0.0.1 \
  --port 18499 \
  --alias minicpm-ocr \
  --jinja \
  --reasoning off
```

Keep this terminal running. The service is available at **`http://127.0.0.1:18499`**, with the OpenAI-compatible chat endpoint **`/v1/chat/completions`** and model name **`minicpm-ocr`**. Choose an unused port; stop an Ollama instance using `18499` or change the port in all commands.

- `--model-draft` loads the matching quantized DSpark head; `--spec-type draft-dspark` selects DSpark decoding. The draft head cannot serve OCR on its own.
- `--spec-draft-n-max 15` sets the maximum draft length per step to 15 tokens. `--flash-attn on` enables Flash Attention.
- `--n-gpu-layers 99` and `--gpu-layers-draft 99` offload the main and draft model layers to GPU. For CPU-only serving, set both to `0` and add `--no-mmproj-offload`.
- `--ctx-size 8192 --parallel 1` starts one request slot with an 8192-token context. Increase the context if the image tokens and output exceed this limit; memory usage also increases.
- `--jinja --reasoning off` uses the official GGUF chat template with thinking disabled.

## 4. Check the service

Open another terminal:

```bash
curl --noproxy 127.0.0.1 -f http://127.0.0.1:18499/health
curl --noproxy 127.0.0.1 -f http://127.0.0.1:18499/v1/models
```

`/health` should return `{"status":"ok"}`, and `/v1/models` should include `minicpm-ocr`. During startup, the service log should show `adding speculative implementation 'draft-dspark'` and `n_max=15`. After the first inference request, look for `draft acceptance` with accepted and generated token counts to confirm that DSpark participated in decoding.
