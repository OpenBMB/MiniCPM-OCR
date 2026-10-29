# Web Demo Deployment Tutorial

[中文](./webdemo_deploy_zh.md)

[← Back to README](../README.md)

This guide is a self-hosted Web Demo tutorial. It runs the document-parse page on your own machine.

## 1. Prepare the environment

Before you start, follow the [SDK tutorial](./minicpm_ocr_tutorial_en.md) to set up the environment and complete a full-page parse. On top of the `.minicpm-ocr` environment, the backend only needs the page server packages:

```bash
source .minicpm-ocr/bin/activate
python -m pip install fastapi uvicorn python-multipart
```

Prepare the rotation-adaptation models:

```bash
bash webdemo/backend/prepare_upright_models.sh
```

The frontend needs Node.js 22 or later. Corepack provides pnpm 10.32.1:

```bash
cd webdemo/frontend
corepack pnpm install
```

## 2. Start the recognition service

Choose one of the services below and leave it running. Follow its guide and serve the model as **`minicpm-ocr`** at **`http://127.0.0.1:18499`**.

| Service | Guide | `OCR_ENGINE_TYPE` |
|---|---|---|
| vLLM | [Deployment guide](./vllm_deploy_en.md) | `vllm` |
| SGLang | [Deployment guide](./sglang_deploy.md) | `openai` |
| llama.cpp | [GGUF deployment guide](./llamacpp_deploy.md) | `llamacpp` |
| Ollama | [Deployment guide](./ollama_deploy.md) | `ollama` |

Confirm the recognition service is up. The model list should include `minicpm-ocr`:

```bash
curl -f http://127.0.0.1:18499/v1/models
# For Ollama, check http://127.0.0.1:18499/api/tags instead.
```

## 3. Start the backend

```bash
source .minicpm-ocr/bin/activate

export OCRWEB_PYTHON=python
export OCR_ENGINE_TYPE=vllm  # Set this from section 2
export OCR_SERVER_URL=http://127.0.0.1:18499
export OCR_SERVED_NAME=minicpm-ocr
export OCR_LAYOUT_MODEL_DIR="$PWD/models/PP-DocLayoutV3_infer"  # Directory already downloaded by the SDK tutorial
export OCR_LAYOUT_DEVICE=cuda  # On CPU, use cpu and also set OCR_LAYOUT_DEVICES=cpu
export OCR_LAYOUT_WORKERS=1  # Raise this when the GPU has room
export PORT=8966
# Rotation adaptation is on by default. It uses models/paddle_upright from section 1.

bash webdemo/backend/start_local_worker.sh
```

```bash
curl -f http://127.0.0.1:8966/health
# {"status":"ok"} means the process is up.
```

## 4. Start the frontend

```bash
cd webdemo/frontend
VITE_OCR_TARGET=http://127.0.0.1:8966 corepack pnpm dev --host --port 5173 --strictPort
```

Open **`http://localhost:5173/playground/document-parse`** to try the local Web Demo.
