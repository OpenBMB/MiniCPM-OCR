#!/usr/bin/env bash


set -Eeuo pipefail
unset https_proxy http_proxy all_proxy HTTPS_PROXY HTTP_PROXY ALL_PROXY

if (( $# > 0 )); then
  [[ "$1" == vllm ]] && shift
  [[ "${1:-}" == serve ]] && shift
  IGNORED=()
  while (( $# )); do
    case "$1" in
      --port) PORT=$2; shift 2 ;;
      --port=*) PORT=${1#*=}; shift ;;
      --served-model-name) LIS_SERVED_MODEL_NAME=$2; shift 2 ;;
      --served-model-name=*) LIS_SERVED_MODEL_NAME=${1#*=}; shift ;;
      *) IGNORED+=("$1"); shift ;;
    esac
  done
  echo "[entry] LIS 启动参数：端口=$PORT 服务名=${LIS_SERVED_MODEL_NAME:-}；忽略 ${#IGNORED[@]} 项: ${IGNORED[*]}"
fi

: "${PORT:=8000}"
for f in "$OCR_MODEL_PATH/config.json" "$RM_MODEL_PATH/model.safetensors" "$OCR_LAYOUT_MODEL_DIR/inference.pdiparams"; do
  [[ -f "$f" ]] || { echo "[entry] ❌ 镜像自带权重缺失：$f（权重目录被挂载覆盖了？）" >&2; exit 1; }
done
OCR_PORT=18499
RM_VLLM_PORT=18520
RM_PORT=8012
STARTUP_TIMEOUT_SEC=${STARTUP_TIMEOUT_SEC:-1800}
OCR_GPU_UTIL=${OCR_GPU_UTIL:-0.40}
RM_GPU_UTIL=${RM_GPU_UTIL:-0.30}
GPU_MEM_MIB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
if [[ -z "${RM_MAX_NUM_BATCHED_TOKENS:-}" ]]; then

  if (( ${GPU_MEM_MIB:-0} >= 45000 )); then RM_MAX_NUM_BATCHED_TOKENS=24576; else RM_MAX_NUM_BATCHED_TOKENS=8192; fi
fi
echo "[entry] gpu ${GPU_MEM_MIB:-?}MiB  OCR=$OCR_GPU_UTIL  RM=$RM_GPU_UTIL(batched=$RM_MAX_NUM_BATCHED_TOKENS)  webdemo=:$PORT"

declare -A PIDS=()
shutdown() {
  trap - TERM INT
  for name in "${!PIDS[@]}"; do kill -TERM "${PIDS[$name]}" 2>/dev/null || true; done
  wait || true
}
trap 'shutdown; exit 143' TERM INT


start() {
  local name=$1; shift
  ( "$@" ) > >(sed -u "s/^/[$name] /") 2>&1 &
  PIDS[$name]=$!
}

wait_http() {
  local name=$1 url=$2
  local deadline=$((SECONDS + STARTUP_TIMEOUT_SEC))
  until curl -fs -m 5 "$url" >/dev/null 2>&1; do
    kill -0 "${PIDS[$name]}" 2>/dev/null || { echo "[entry] ❌ $name 启动期间退出" >&2; shutdown; exit 1; }
    (( SECONDS < deadline )) || { echo "[entry] ❌ $name 就绪超时: $url" >&2; shutdown; exit 1; }
    sleep 3
  done
  echo "[entry] ✅ $name 就绪 (${SECONDS}s)"
}

run_ocr() {

  exec /opt/venv/bin/python -m vllm.entrypoints.openai.api_server \
    --model "$OCR_MODEL_PATH" --served-model-name "$OCR_SERVED_NAME" --trust-remote-code \
    --host 127.0.0.1 --port "$OCR_PORT" \
    --max-model-len 40960 --max-num-batched-tokens 8192 --max-num-seqs 256 \
    --limit-mm-per-prompt '{"image": 36}' \
    --mm-processor-kwargs '{"downsample_mode":"4x","max_slice_nums":9}' \
    --gpu-memory-utilization "$OCR_GPU_UTIL" \
    --attention-backend FLASH_ATTN --trust-request-mm-kwargs \
    --gdn-prefill-backend "$VLLM_GDN_PREFILL_BACKEND" \
    --uvicorn-log-level warning
}

run_rm_vllm() {


  exec /opt/venv/bin/python -m vllm.entrypoints.openai.api_server \
    --model "$RM_MODEL_PATH" --served-model-name rm-minicpm-binary --trust-remote-code \
    --host 127.0.0.1 --port "$RM_VLLM_PORT" \
    --max-model-len 16384 --max-num-seqs 64 --max-num-batched-tokens "$RM_MAX_NUM_BATCHED_TOKENS" \
    --limit-mm-per-prompt '{"image":36}' --max-logprobs 20 \
    --gpu-memory-utilization "$RM_GPU_UTIL" \
    --chat-template-content-format string \
    --uvicorn-log-level warning
}

run_rm_service() {
  cd /opt/ocr-rm-serving
  export RM_VLLM_BASE=http://127.0.0.1:$RM_VLLM_PORT/v1 RM_HOST=127.0.0.1 RM_PORT
  export RM_PROFILE=tts RM_VLLM_CONCURRENCY=${RM_VLLM_CONCURRENCY:-32}
  export RM_BACKEND_MAX_NUM_SEQS=64 RM_BACKEND_MAX_NUM_BATCHED_TOKENS=$RM_MAX_NUM_BATCHED_TOKENS
  export RM_MAX_ITEMS=${RM_MAX_ITEMS:-64} RM_THRESHOLD=${RM_THRESHOLD:-0.5}

  export RM_RENDER_ENABLED=0 RM_NODE_BIN=/usr/local/bin/node
  export RM_WORK_ROOT=/tmp/rm_service_work RM_KEEP_WORK=${RM_KEEP_WORK:-0}
  mkdir -p "$RM_WORK_ROOT"
  exec /opt/venv/bin/python -m ocr_rm_serving
}

run_webdemo() {
  export LIS_SERVED_MODEL_NAME="${LIS_SERVED_MODEL_NAME:-}"
  mkdir -p "$OCRWEB_DATA_DIR"
  cd /opt/app/webdemo
  exec /opt/venv/bin/python -s -m uvicorn server:app --host 0.0.0.0 --port "$PORT" --workers 1
}

start ocr run_ocr
wait_http ocr "http://127.0.0.1:$OCR_PORT/v1/models"
start rm-vllm run_rm_vllm
wait_http rm-vllm "http://127.0.0.1:$RM_VLLM_PORT/v1/models"
start rm run_rm_service
wait_http rm "http://127.0.0.1:$RM_PORT/healthz"
start webdemo run_webdemo
wait_http webdemo "http://127.0.0.1:$PORT/ready"


/opt/venv/bin/python - "$PORT" <<'PY' || echo "[entry] ⚠ 预热失败，首个请求会慢" >&2
import base64, io, json, sys, urllib.request
from PIL import Image
buf = io.BytesIO(); Image.new("RGB", (800, 600), "white").save(buf, "PNG")
body = json.dumps({"model": "minicpm-ocr", "page_index": 0,
                   "image": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()}).encode()
req = urllib.request.Request(f"http://127.0.0.1:{sys.argv[1]}/api/image-parse", data=body,
                             headers={"Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=600).read()
PY
echo "[entry] ✅ 全链就绪 ${SECONDS}s：webdemo :$PORT"

set +e
wait -n "${PIDS[@]}"
code=$?
for name in "${!PIDS[@]}"; do
  kill -0 "${PIDS[$name]}" 2>/dev/null || echo "[entry] ❌ 子进程 $name 已退出" >&2
done
shutdown
exit $(( code == 0 ? 1 : code ))
