#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/demo_env.sh" webdemo
cd "$OCR_DEMO_DIR"
ocr_require_python
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY

export CUDA_VISIBLE_DEVICES=""
export OCR_PAGE_ROLE=dispatcher
export OCR_PAGE_WINDOW="${OCR_PAGE_WINDOW:-8}"
export OCR_PAGE_SLOTS="${OCR_PAGE_SLOTS:-64}"
PY="$OCRWEB_PYTHON"
COUNT="${OCR_DISPATCH_COUNT:-16}"

OCR_DISPATCH_RECOVER=1 "$PY" -s -c 'import obs_jobs; obs_jobs.recover_interrupted()'
unset OCR_DISPATCH_RECOVER

pids=()
start_one() {
  "$PY" -s dispatcher.py &
  pids+=("$!")
}
for _ in $(seq 1 "$COUNT"); do
  start_one
done

cleanup() {
  kill "${pids[@]}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

while true; do
  for i in "${!pids[@]}"; do
    if ! kill -0 "${pids[$i]}" 2>/dev/null; then
      "$PY" -s dispatcher.py &
      pids[$i]="$!"
    fi
  done
  sleep 2
done
