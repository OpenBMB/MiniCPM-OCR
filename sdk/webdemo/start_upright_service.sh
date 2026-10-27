#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/demo_env.sh" webdemo
cd "$OCR_DEMO_DIR"
ocr_require_python
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY

export OCR_UPRIGHT_WORKERS="${OCR_UPRIGHT_WORKERS:-20}"
export OCR_UPRIGHT_DEVICE="${OCR_UPRIGHT_DEVICE:-cpu}"
export OCR_UPRIGHT_CPU_THREADS="${OCR_UPRIGHT_CPU_THREADS:-1}"
export OCR_CV2_THREADS="${OCR_CV2_THREADS:-1}"
exec "$OCRWEB_PYTHON" -s upright_server.py --host "${HOST:-0.0.0.0}" --port "${OCR_UPRIGHT_PORT:-18080}"
