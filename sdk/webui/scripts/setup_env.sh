#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../../scripts/demo_env.sh" webui
case "$SDK_PROFILE" in
  sdk-cpu|sdk-gpu) ;;
  *) echo "SDK_PROFILE must be sdk-cpu or sdk-gpu" >&2; exit 2 ;;
esac
command -v uv >/dev/null || { echo "Install uv first: python3 -m pip install uv" >&2; exit 1; }
if [[ ! -x "$OCRWEB_ENV/bin/python" ]]; then
  uv venv --python "${OCR_PYTHON:-3.12}" "$OCRWEB_ENV"
fi
uv pip install --python "$OCRWEB_ENV/bin/python" -r "$PROJECT_ROOT/pyproject.toml" \
  --extra "$SDK_PROFILE" fastapi uvicorn python-multipart httpx
if [[ "${OCR_DOWNLOAD_UPRIGHT:-0}" == 1 ]]; then
  endpoint="${HF_ENDPOINT:-https://huggingface.co}"
  for model in PP-LCNet_x1_0_doc_ori PP-OCRv5_mobile_det PP-LCNet_x1_0_textline_ori; do
    mkdir -p "$OCR_UPRIGHT_DIR/$model"
    for file in config.json inference.json inference.pdiparams inference.yml; do
      curl -fL --retry 3 "$endpoint/PaddlePaddle/$model/resolve/main/$file" -o "$OCR_UPRIGHT_DIR/$model/$file"
    done
  done
fi
printf 'Environment ready: %s\nLayout model directory: %s\n' "$OCRWEB_ENV" "$OCR_LAYOUT_MODEL_DIR"
printf 'Start the service with: bash %s/start_webui.sh\n' "$HERE"
