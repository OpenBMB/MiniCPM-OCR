#!/usr/bin/env bash

SDK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "$SDK_ROOT/.." && pwd)"
OCR_DEMO_DIR="$SDK_ROOT/${1:-webdemo}"
SDK_PROFILE="${SDK_PROFILE:-sdk-gpu}"
OCRWEB_ENV="${OCRWEB_ENV:-$PROJECT_ROOT/.venv-$SDK_PROFILE}"
OCRWEB_PYTHON="${OCRWEB_PYTHON:-$OCRWEB_ENV/bin/python}"
VLLM_PYTHON="${VLLM_PYTHON:-$PROJECT_ROOT/.venv-vllm/bin/python}"

export OCR_ASSETS_DIR="${OCR_ASSETS_DIR:-$PROJECT_ROOT/models}"
export OCR_MODEL_PATH="${OCR_MODEL_PATH:-$OCR_ASSETS_DIR/MiniCPM-OCR}"
export OCR_LAYOUT_MODEL_DIR="${OCR_LAYOUT_MODEL_DIR:-$OCR_ASSETS_DIR/PP-DocLayoutV3_infer}"
export OCR_UPRIGHT_DIR="${OCR_UPRIGHT_DIR:-$OCR_ASSETS_DIR/paddle_upright}"
export OCRWEB_DATA_DIR="${OCRWEB_DATA_DIR:-$OCR_DEMO_DIR/data}"
export OCR_PAGE_REGISTRY="${OCR_PAGE_REGISTRY:-$OCRWEB_DATA_DIR/page-workers}"
export OCR_UPRIGHT_REGISTRY="${OCR_UPRIGHT_REGISTRY-$OCRWEB_DATA_DIR/upright-workers}"
export PYTHONPATH="$SDK_ROOT${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONNOUSERSITE=1

ocr_require_python() {
    [[ -x "$OCRWEB_PYTHON" ]] || {
        echo "Python not found: $OCRWEB_PYTHON. Run $OCR_DEMO_DIR/scripts/setup_env.sh or set OCRWEB_PYTHON." >&2
        return 1
    }
}
