#!/usr/bin/env bash
# Local page worker: layout runs in this process. Recognition is sent to an
# already-running server. This script does not start that server.
# Rotation adaptation is on by default. OCR_UPRIGHT_WORKERS=0 loads no model here.
#
# OCR_ENGINE_TYPE  vllm (default), llamacpp, ollama, or openai
#                  openai also covers sglang and lmdeploy
# OCR_SERVER_URL   base URL of that server. VLLM_URL is the same setting.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/env.sh"
ocr_require OCR_LAYOUT_MODEL_DIR
ocr_require OCRWEB_PYTHON

if [[ -z "${OCR_SERVER_URL:-}" && -z "${VLLM_URL:-}" ]]; then
  echo "Set OCR_SERVER_URL to the recognition server." >&2
  exit 1
fi
export OCR_SERVER_URL="${OCR_SERVER_URL:-$VLLM_URL}"
export VLLM_URL="$OCR_SERVER_URL"
export OCR_ENGINE_TYPE="${OCR_ENGINE_TYPE:-vllm}"

export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"
export OCR_LAYOUT_WORKERS="${OCR_LAYOUT_WORKERS:-4}"
export OCR_LAYOUT_DEVICE="${OCR_LAYOUT_DEVICE:-cuda}"
export OCR_LAYOUT_DEVICES="${OCR_LAYOUT_DEVICES:-}"
export OCR_PAGE_SLOTS="${OCR_PAGE_SLOTS:-8}"
export OCR_UPRIGHT_DIR="${OCR_UPRIGHT_DIR:-$REPO_DIR/models/paddle_upright}"
export OCR_UPRIGHT_WORKERS="${OCR_UPRIGHT_WORKERS:-1}"
export OCR_UPRIGHT_DEVICE="${OCR_UPRIGHT_DEVICE:-cpu}"
export OCR_SHARED_CROP_POOL="${OCR_SHARED_CROP_POOL:-1}"
export OCR_CROP_WORKERS="${OCR_CROP_WORKERS:-96}"
export OCR_SERVED_NAME="${OCR_SERVED_NAME:-minicpm-ocr}"
export OCR_PAGE_ROLE=worker
export PORT="${PORT:-8966}"

cd "$BACKEND_DIR"
exec "$OCRWEB_PYTHON" -s -m uvicorn server:app --host 0.0.0.0 --port "$PORT" --workers 1
