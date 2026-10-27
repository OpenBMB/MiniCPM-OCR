#!/usr/bin/env bash


set -euo pipefail
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
source "$REPO/scripts/demo_env.sh" webdemo
GPU="${GPU:-0}"

OCR_MODEL_DIR="$OCR_MODEL_PATH"
: "${OCR_IMAGE:?Set OCR_IMAGE to an OCR vLLM image}"
: "${RM_IMAGE:?Set RM_IMAGE to an OCR-RM image}"
LAYOUT_DIR="$OCR_LAYOUT_MODEL_DIR"
ocr_require_python
PY="$OCRWEB_PYTHON"
SERVED="${OCR_SERVED_NAME:-minicpm-ocr}"
VLLM_PORT="${VLLM_PORT:-18501}"
RM_PORT="${RM_PORT:-8012}"
PORT="${PORT:-8952}"
DATA_DIR="${OCRWEB_DATA_DIR:-$REPO/webdemo/data}"
LOG="$DATA_DIR/webdemo.log"

wait_http() {
  for _ in $(seq 1 $(( $3 / 5 ))); do
    curl -fs --noproxy '*' -m 3 "$2" >/dev/null 2>&1 && { echo "  $1 就绪"; return; }
    sleep 5
  done
  echo "  $1 启动超时：$2" >&2; exit 1
}

echo "[1/3] OCR vLLM → GPU $GPU :$VLLM_PORT"
docker rm -f "ocr-vllm-gpu$GPU" >/dev/null 2>&1 || true
docker run -d --name "ocr-vllm-gpu$GPU" --gpus "device=$GPU" --network host --shm-size 4g \
  -v "$OCR_MODEL_DIR":/model:ro --entrypoint "${OCR_CONTAINER_PYTHON:-/opt/venv/bin/python}" "$OCR_IMAGE" \
  -m vllm.entrypoints.openai.api_server --model /model --served-model-name "$SERVED" \
  --host 127.0.0.1 --port "$VLLM_PORT" --trust-remote-code \
  --gpu-memory-utilization 0.35 --max-model-len 40960 \
  --max-num-seqs 256 --max-num-batched-tokens 8192 \
  --limit-mm-per-prompt '{"image":36}' \
  --mm-processor-kwargs '{"downsample_mode":"4x","max_slice_nums":9}' \
  --trust-request-mm-kwargs --gdn-prefill-backend triton --uvicorn-log-level warning >/dev/null

wait_http "OCR vLLM" "http://127.0.0.1:$VLLM_PORT/v1/models" 900

echo "[2/3] RM → GPU $GPU :$RM_PORT"
docker rm -f "ocr-rm-gpu$GPU" >/dev/null 2>&1 || true
docker run -d --name "ocr-rm-gpu$GPU" --gpus "device=$GPU" --network host --shm-size 4g \
  -v "$HERE/rm_entry.sh":/rm_entry.sh:ro -e "RM_PORT=$RM_PORT" --entrypoint bash "$RM_IMAGE" /rm_entry.sh >/dev/null
wait_http "RM" "http://127.0.0.1:$RM_PORT/healthz" 900

echo "[3/3] webdemo → :$PORT"
mkdir -p "$DATA_DIR"
pkill -f "[u]vicorn server:app --host 0.0.0.0 --port $PORT" 2>/dev/null || true
sleep 1
cd "$REPO/webdemo"
PYTHONPATH="$REPO" PYTHONNOUSERSITE=1 PORT="$PORT" CUDA_VISIBLE_DEVICES="$GPU" \
VLLM_URL="http://127.0.0.1:$VLLM_PORT" OCR_SERVED_NAME="$SERVED" \
OCR_LAYOUT_MODEL_DIR="$LAYOUT_DIR" OCR_LAYOUT_DEVICE=cuda:0 \
OCR_RM_URL="http://127.0.0.1:$RM_PORT" OCR_RM_INPUT_FORM=binary \
OCRWEB_DATA_DIR="$DATA_DIR" \
nohup "$PY" -s -m uvicorn server:app --host 0.0.0.0 --port "$PORT" --workers 1 \
  >"$LOG" 2>&1 </dev/null &
wait_http "webdemo" "http://127.0.0.1:$PORT/ready" 120
echo "日志：$LOG"
