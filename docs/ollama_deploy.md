# Ollama Deployment Guide

[中文](./ollama_deploy_zh.md)

[← Back to README](../README.md)

Deploy MiniCPM-OCR 1.0 with Ollama using the **Q8_0 main model, Q8_0 DSpark draft head, and F16 4× vision projector** together, with DSpark speculative decoding enabled. Run the commands below from the **root of this repository** in Bash.

## 1. Install Ollama

Use **Ollama v0.40.12 or later**. Install the reference version on Linux:

```bash
curl -fsSL https://ollama.com/install.sh | OLLAMA_VERSION=0.40.12 sh
ollama --version
```

For macOS and Windows, use the [official downloads](https://ollama.com/download). If Ollama is already installed, check its version and restart the service after upgrading. GPU and driver requirements are listed in the [Ollama GPU documentation](https://docs.ollama.com/gpu).

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
export OLLAMA_HOST=127.0.0.1:18499
export OLLAMA_MODELS="$PWD/models/ollama"
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=1

ollama serve
```

Keep this terminal running. Ollama selects the inference backend automatically. On Linux with NVIDIA GPUs, use `CUDA_VISIBLE_DEVICES=0 ollama serve` to select GPU 0.

This instance uses port `18499` and stores imported models in `models/ollama`. The default Ollama port is `11434`; use the same host and port in the registration commands below. If you change the port, update all addresses accordingly.

## 4. Register the model and check the service

Open another terminal at the repository root:

```bash
export OLLAMA_HOST=127.0.0.1:18499

cat > ./models/MiniCPM-OCR-1.0-gguf/Modelfile <<'EOF'
FROM ./MiniCPM-OCR-1_0-Q8_0.gguf
FROM ./mmproj-model-f16-4x.gguf
DRAFT ./dspark-MiniCPM-OCR-1_0-Q8_0.gguf
REQUIRES 0.40.12
PARAMETER num_ctx 8192
PARAMETER temperature 0
PARAMETER draft_num_predict 15
EOF

ollama create minicpm-ocr -f ./models/MiniCPM-OCR-1.0-gguf/Modelfile
ollama show minicpm-ocr
ollama show minicpm-ocr --modelfile

curl --noproxy 127.0.0.1 -f http://127.0.0.1:18499/api/version
curl --noproxy 127.0.0.1 -f http://127.0.0.1:18499/api/tags
```

The two `FROM` lines load the main model and vision projector; `DRAFT` loads the matching DSpark draft model. All paths are relative to the Modelfile. `PARAMETER draft_num_predict 15` sets the maximum number of draft tokens per step to 15. Keep the official GGUF's embedded chat template.

`ollama show --modelfile` should include `DRAFT` and `PARAMETER draft_num_predict 15`, `ollama show` should report the `vision` capability, `/api/version` should return version `0.40.12` or later, and `/api/tags` should list `minicpm-ocr:latest`. The service is available at **`http://127.0.0.1:18499`**, with the local model name **`minicpm-ocr`**. Ollama loads the main and draft models on the first inference request; the underlying llama.cpp automatically selects `draft-dspark` from the draft file metadata.

On the first inference request, the service log should show `adding speculative implementation 'draft-dspark'`. After generation, look for `draft acceptance` or `statistics ... draft-dspark` to confirm that DSpark participated in decoding.
