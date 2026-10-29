# Web Demo 部署教程

[English](./webdemo_deploy.md)

[← 返回首页](../README_zh.md)

本文提供自部署的 Web Demo 教程，在本机运行文档解析页。

## 1. 环境准备

开始前，确保已经按 [SDK 教程](./minicpm_ocr_tutorial.md) 装好环境，并跑通全页面解析流程。后端环境仅需要在 `.minicpm-ocr` 环境基础上补页面服务：

```bash
source .minicpm-ocr/bin/activate
python -m pip install fastapi uvicorn python-multipart
```

准备旋转自适应模型：

```bash
bash webdemo/backend/prepare_upright_models.sh
```

前端需要 Node.js 22 或更高版本。pnpm 10.32.1 由 Corepack 提供：

```bash
cd webdemo/frontend
corepack pnpm install
```

## 2. 启动识别服务

任选以下一种识别服务并保持运行，参照指南把模型以 **`minicpm-ocr`** 提供在 **`http://127.0.0.1:18499`**。

| 服务 | 文档 | `OCR_ENGINE_TYPE` |
|---|---|---|
| vLLM | [部署指南](./vllm_deploy.md) | `vllm` |
| SGLang | [部署指南](./sglang_deploy_zh.md) | `openai` |
| llama.cpp | [GGUF 部署指南](./llamacpp_deploy_zh.md) | `llamacpp` |
| Ollama | [部署指南](./ollama_deploy_zh.md) | `ollama` |

确认识别服务已通，返回的模型列表里应有 `minicpm-ocr`：

```bash
curl -f http://127.0.0.1:18499/v1/models
# Ollama 改查 `http://127.0.0.1:18499/api/tags`。
```

## 3. 启动后端服务

```bash
source .minicpm-ocr/bin/activate

export OCRWEB_PYTHON=python
export OCR_ENGINE_TYPE=vllm  # 按第 2 节填写
export OCR_SERVER_URL=http://127.0.0.1:18499
export OCR_SERVED_NAME=minicpm-ocr
export OCR_LAYOUT_MODEL_DIR="$PWD/models/PP-DocLayoutV3_infer"  # SDK 教程已经下载的目录
export OCR_LAYOUT_DEVICE=cuda  # CPU 上改为 cpu，并设置 OCR_LAYOUT_DEVICES=cpu
export OCR_LAYOUT_WORKERS=1  # 显存够可以调高
export PORT=8966 
# 旋转自适应默认打开，模型用第 1 节准备的 models/paddle_upright

bash webdemo/backend/start_local_worker.sh
```

```bash
curl -f http://127.0.0.1:8966/health
# 返回 {"status":"ok"} 即进程已起来。
```

## 4. 启动前端

```bash
cd webdemo/frontend
VITE_OCR_TARGET=http://127.0.0.1:8966 corepack pnpm dev --host --port 5173 --strictPort
```

打开 **`http://localhost:5173/playground/document-parse`**，即可开始体验本地的 WebDemo！
