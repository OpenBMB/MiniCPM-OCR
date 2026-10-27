#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/demo_env.sh" webdemo
cd "$OCR_DEMO_DIR"
ocr_require_python
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY

: "${OCR_REPLICA_GPUS:?Set OCR_REPLICA_GPUS to space-separated GPU IDs}"
export VLLM_SERVED_NAME="${VLLM_SERVED_NAME:-minicpm-ocr}"
export VLLM_GPU_UTIL="${VLLM_GPU_UTIL:-0.90}"
export VLLM_MAX_MODEL_LEN="${VLLM_MAX_MODEL_LEN:-16384}"
export VLLM_USE_FLASHINFER_SAMPLER="${VLLM_USE_FLASHINFER_SAMPLER:-0}"
base_port="${VLLM_BASE_PORT:-18500}"
read -r -a gpus <<< "$OCR_REPLICA_GPUS"
pids=()
replica_urls=""
for index in "${!gpus[@]}"; do
  port=$((base_port + index))
  replica_urls="${replica_urls:+$replica_urls,}http://127.0.0.1:$port"
  CUDA_VISIBLE_DEVICES="${gpus[$index]}" VLLM_PORT="$port" VLLM_LOG="$OCRWEB_DATA_DIR/vllm_${port}.log" \
    bash "$OCR_DEMO_DIR/scripts/start_vllm.sh" &
  pids+=("$!")
done
fail=0
for pid in "${pids[@]}"; do
  wait "$pid" || fail=1
done
[[ "$fail" -eq 0 ]] || { echo "vLLM failed to become ready" >&2; exit 1; }
export VLLM_URL="${VLLM_URL:-http://127.0.0.1:$base_port}"
export VLLM_URLS="${VLLM_URLS:-$replica_urls}"
export PORT="${PORT:-8952}"
exec bash "$OCR_DEMO_DIR/start_local_worker.sh"
