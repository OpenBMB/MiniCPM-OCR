#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../../scripts/demo_env.sh" webdemo
: "${BASE_IMAGE:?Set BASE_IMAGE to a CUDA image with vLLM, PaddlePaddle, PaddleOCR and uv}"
: "${OCR_RM_MODEL_DIR:?Set OCR_RM_MODEL_DIR to the RM model directory}"
: "${OCR_RM_SERVING_ROOT:?Set OCR_RM_SERVING_ROOT to the RM service directory containing ocr_rm_serving and vendor}"
: "${RM_NODE_BIN:?Set RM_NODE_BIN to a Linux Node.js executable}"
IMAGE="${IMAGE:-minicpm-ocr-webdemo:latest}"
for directory in "$OCR_MODEL_PATH" "$OCR_LAYOUT_MODEL_DIR" "$OCR_RM_MODEL_DIR" "$OCR_UPRIGHT_DIR" \
    "$OCR_RM_SERVING_ROOT/ocr_rm_serving" "$OCR_RM_SERVING_ROOT/vendor"; do
  [[ -d "$directory" ]] || { echo "Missing directory: $directory" >&2; exit 1; }
done
[[ -f "$RM_NODE_BIN" ]] || { echo "Node.js executable not found: $RM_NODE_BIN" >&2; exit 1; }
context="$(mktemp -d)"
trap 'rm -rf "$context"' EXIT
mkdir -p "$context/models" "$context/rm" "$context/app"
cp "$HERE/Dockerfile" "$HERE/entrypoint.sh" "$context/"
cp -a "$OCR_MODEL_PATH" "$context/models/ocr"
cp -a "$OCR_LAYOUT_MODEL_DIR" "$context/models/layout"
cp -a "$OCR_RM_MODEL_DIR" "$context/models/rm"
cp -a "$OCR_UPRIGHT_DIR" "$context/models/paddle_upright"
cp "$RM_NODE_BIN" "$context/rm/node"
cp -a "$OCR_RM_SERVING_ROOT/ocr_rm_serving" "$OCR_RM_SERVING_ROOT/vendor" "$context/rm/"
tar -C "$SDK_ROOT" --exclude=.git --exclude='.venv*' --exclude=data --exclude=runs \
  --exclude=build --exclude=dist --exclude='*.egg-info' --exclude=__pycache__ --exclude=.env \
  --exclude=env.local.sh -cf - . | tar -C "$context/app" -xf -
docker build --build-arg "BASE_IMAGE=$BASE_IMAGE" -t "$IMAGE" "$context"
printf 'Built %s\n' "$IMAGE"
