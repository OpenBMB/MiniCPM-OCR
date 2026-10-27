#!/usr/bin/env bash


set -Eeuo pipefail
unset https_proxy http_proxy all_proxy HTTPS_PROXY HTTP_PROXY ALL_PROXY
RM_MODEL_PATH=${RM_MODEL_PATH:-/models/rm/hf_l4_binary_vocab_5000}
RM_VLLM_PORT="${RM_VLLM_PORT:-18520}"
RM_PORT="${RM_PORT:-8012}"
RM_GPU_UTIL=${RM_GPU_UTIL:-0.30}
RM_MAX_NUM_BATCHED_TOKENS=8192

"${RM_PYTHON:-/opt/vllm-venv/bin/python}" -m vllm.entrypoints.openai.api_server \
  --model "$RM_MODEL_PATH" --served-model-name rm-minicpm-binary --trust-remote-code \
  --host 127.0.0.1 --port "$RM_VLLM_PORT" \
  --max-model-len 16384 --max-num-seqs 64 --max-num-batched-tokens "$RM_MAX_NUM_BATCHED_TOKENS" \
  --limit-mm-per-prompt '{"image":36}' --max-logprobs 20 \
  --gpu-memory-utilization "$RM_GPU_UTIL" \
  --chat-template-content-format string 2>&1 | sed -u 's/^/[rm-vllm] /' &

until curl -fs -m 5 http://127.0.0.1:$RM_VLLM_PORT/v1/models >/dev/null 2>&1; do sleep 3; done
echo "[entry] rm-vllm ready"

cd /opt/ocr-rm-serving
export RM_VLLM_BASE=http://127.0.0.1:$RM_VLLM_PORT/v1 RM_PORT
export RM_PROFILE=tts RM_VLLM_CONCURRENCY=32
export RM_BACKEND_MAX_NUM_SEQS=64 RM_BACKEND_MAX_NUM_BATCHED_TOKENS=$RM_MAX_NUM_BATCHED_TOKENS
export RM_MAX_ITEMS=64 RM_THRESHOLD=0.5
export RM_RENDER_ENABLED=0 RM_NODE_BIN=/usr/local/bin/node
export RM_WORK_ROOT=/tmp/rm_service_work RM_KEEP_WORK=0
mkdir -p "$RM_WORK_ROOT"
exec "${RM_PYTHON:-/opt/vllm-venv/bin/python}" -m ocr_rm_serving 2>&1 | sed -u 's/^/[rm] /'
