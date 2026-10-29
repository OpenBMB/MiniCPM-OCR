#!/usr/bin/env bash
# Download the three public PaddleOCR models used for rotation adaptation.
# They land in <repo>/models/paddle_upright. Complete directories are kept.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/models/paddle_upright"
BASE="https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0"
FILES=(inference.pdiparams inference.json inference.yml)

ready() {
  local dir="$1" name
  for name in "${FILES[@]}"; do
    [[ -s "$dir/$name" ]] || return 1
  done
}

fetch() {
  local archive_name="$1" target_name="$2"
  local target="$DEST/$target_name"
  if ready "$target"; then
    return 0
  fi
  rm -rf "$target"
  curl -fL --retry 3 -o "$tmp/$archive_name.tar" "$BASE/$archive_name.tar"
  tar -xf "$tmp/$archive_name.tar" -C "$tmp"
  mv "$tmp/$archive_name" "$target"
  ready "$target"
}

mkdir -p "$DEST"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fetch PP-LCNet_x1_0_doc_ori_infer PP-LCNet_x1_0_doc_ori
fetch PP-OCRv5_mobile_det_infer PP-OCRv5_mobile_det
fetch PP-LCNet_x1_0_textline_ori_infer PP-LCNet_x1_0_textline_ori
