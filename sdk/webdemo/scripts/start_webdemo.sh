#!/usr/bin/env bash


set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
source "$REPO/scripts/demo_env.sh" webdemo
PY="$OCRWEB_PYTHON"
PORT="${PORT:-8950}"
LOG="${OCRWEB_LOG:-$OCRWEB_DATA_DIR/webdemo.log}"

[[ -x "$PY" ]] || { echo "python not found: $PY（先跑 scripts/setup_env.sh）" >&2; exit 1; }
mkdir -p "$(dirname "$LOG")"


unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
export PYTHONPATH="$REPO${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONNOUSERSITE=1
export PORT


export OCR_LAYOUT_MODEL_DIR="${OCR_LAYOUT_MODEL_DIR}"
export OCR_UPRIGHT_DIR="${OCR_UPRIGHT_DIR}"
export VLLM_URL="${VLLM_URL:-http://127.0.0.1:18499}"
export OCR_SERVED_NAME="${OCR_SERVED_NAME:-minicpm-ocr}"


export OCR_RM_URL="${OCR_RM_URL:-http://127.0.0.1:8000}"


pkill -f "[u]vicorn server:app --host 0.0.0.0 --port $PORT" 2>/dev/null || true
sleep 0.5

cd "$REPO/webdemo"
nohup "$PY" -s -m uvicorn server:app --host 0.0.0.0 --port "$PORT" --workers 1 >"$LOG" 2>&1 </dev/null &
PID=$!
sleep 3

if ! kill -0 "$PID" 2>/dev/null; then
  echo "启动失败，日志尾部：" >&2; tail -20 "$LOG" >&2; exit 1
fi
IP=$(hostname -I 2>/dev/null | awk '{print $1}')

curl -s --noproxy '*' -m 5 -o /dev/null -w "pid=$PID  http://${IP:-127.0.0.1}:$PORT/ready  status=%{http_code}\n" "http://127.0.0.1:$PORT/ready"
echo "日志: $LOG"
