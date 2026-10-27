#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/demo_env.sh" webdemo
cd "$OCR_DEMO_DIR"
ocr_require_python
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY

export CUDA_VISIBLE_DEVICES=""
export OCR_PAGE_ROLE=gateway
export OCR_LOCAL_WORKER_URL="${OCR_LOCAL_WORKER_URL:-http://127.0.0.1:8953}"
export PORT="${PORT:-8952}"
exec "$OCRWEB_PYTHON" -s -m uvicorn server:app --host "${HOST:-0.0.0.0}" --port "$PORT" --workers 1
