#!/usr/bin/env bash
# Upright worker. Loads the orientation models and registers its address in
# OCR_UPRIGHT_REGISTRY. The webdemo process only reads that directory.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/env.sh"
ocr_require OCR_UPRIGHT_DIR
ocr_require OCRWEB_PYTHON

export OCR_UPRIGHT_WORKERS="${OCR_UPRIGHT_WORKERS:-20}"
export OCR_UPRIGHT_DEVICE="${OCR_UPRIGHT_DEVICE:-cpu}"
export OCR_UPRIGHT_CPU_THREADS="${OCR_UPRIGHT_CPU_THREADS:-1}"
export OCR_CV2_THREADS="${OCR_CV2_THREADS:-1}"
HOST="${OCR_UPRIGHT_HOST:-0.0.0.0}"
PORT="${OCR_UPRIGHT_PORT:-18080}"

cd "$BACKEND_DIR"
exec "$OCRWEB_PYTHON" -s upright_server.py --host "$HOST" --port "$PORT"
