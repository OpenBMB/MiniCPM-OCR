#!/usr/bin/env bash


set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/demo_env.sh" webui
VLLM_PY="$VLLM_PYTHON"
MODEL="${OCR_MODEL_PATH}"
PORT="${VLLM_PORT:-18499}"
SERVED="${VLLM_SERVED_NAME:-minicpm-ocr}"
GPU_UTIL="${VLLM_GPU_UTIL:-0.60}"
MAX_LEN="${VLLM_MAX_MODEL_LEN:-16384}"
LOG="${VLLM_LOG:-$(dirname "$0")/../data/vllm.log}"

[[ -x "$VLLM_PY" ]] || { echo "vLLM python not found: $VLLM_PY" >&2; exit 1; }
[[ -d "$MODEL" ]] || { echo "model dir not found: $MODEL" >&2; exit 1; }
mkdir -p "$(dirname "$LOG")"

unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
if [[ -n "${CUDA_COMPAT_DIR:-}" ]]; then
  export LD_LIBRARY_PATH="$CUDA_COMPAT_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
export VLLM_USE_FLASHINFER_SAMPLER=0
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"
export TORCH_EXTENSIONS_DIR="${TORCH_EXTENSIONS_DIR:-/tmp/torchext_$PORT}"
export TRITON_CACHE_DIR="${TRITON_CACHE_DIR:-/tmp/triton_$PORT}"

if curl -s --noproxy '*' -m 3 "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1; then
  echo "vLLM already serving on :$PORT"
  exit 0
fi

echo "starting vLLM: model=$MODEL port=$PORT log=$LOG"
nohup "$VLLM_PY" -m vllm.entrypoints.openai.api_server \
  --model "$MODEL" \
  --served-model-name "$SERVED" \
  --host 0.0.0.0 --port "$PORT" \
  --gpu-memory-utilization "$GPU_UTIL" \
  --max-model-len "$MAX_LEN" \
  --limit-mm-per-prompt '{"image":1}' \
  --trust-request-mm-kwargs \
  >"$LOG" 2>&1 &

echo "pid=$! ; waiting for readiness (up to 600s)"
for _ in $(seq 1 200); do
  if curl -s --noproxy '*' -m 3 "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1; then
    echo "READY  http://127.0.0.1:$PORT  (served-model-name=$SERVED)"
    exit 0
  fi
  sleep 3
done
echo "TIMEOUT waiting for vLLM; tail of $LOG:" >&2
tail -30 "$LOG" >&2
exit 1
