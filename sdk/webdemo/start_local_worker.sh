#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/demo_env.sh" webdemo
cd "$OCR_DEMO_DIR"
ocr_require_python
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY

export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"
export OCR_LAYOUT_WORKERS="${OCR_LAYOUT_WORKERS:-32}"
export OCR_PAGE_SLOTS="${OCR_PAGE_SLOTS:-64}"
export OCR_UPRIGHT_WORKERS="${OCR_UPRIGHT_WORKERS:-20}"
export OCR_SHARED_CROP_POOL="${OCR_SHARED_CROP_POOL:-1}"
export OCR_CROP_WORKERS="${OCR_CROP_WORKERS:-112}"
export OCR_LAYOUT_DEVICE="${OCR_LAYOUT_DEVICE:-cuda:0}"
export OCR_SERVED_NAME="${OCR_SERVED_NAME:-minicpm-ocr}"
export VLLM_URL="${VLLM_URL:-http://127.0.0.1:18499}"
export OCR_RM_URL="${OCR_RM_URL:-http://127.0.0.1:18022}"
export OCR_RM_INPUT_FORM="${OCR_RM_INPUT_FORM:-binary}"
export OCR_PAGE_ROLE=worker
export PORT="${PORT:-8953}"
exec "$OCRWEB_PYTHON" -s -m uvicorn server:app --host "${HOST:-0.0.0.0}" --port "$PORT" --workers 1
