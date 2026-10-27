#!/usr/bin/env bash

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
source "$REPO/scripts/demo_env.sh" webui
PY="$OCRWEB_PYTHON"
PORT="${PORT:-8950}"
LOG="${OCRWEB_LOG:-$OCRWEB_DATA_DIR/webui.log}"

[[ -x "$PY" ]] || { echo "python not found: $PY（先跑 scripts/setup_env.sh）" >&2; exit 1; }
mkdir -p "$(dirname "$LOG")"


unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
export PYTHONPATH="$REPO${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONNOUSERSITE=1


export OCR_LAYOUT_MODEL_DIR="${OCR_LAYOUT_MODEL_DIR}"
export OCR_UPRIGHT_DIR="${OCR_UPRIGHT_DIR}"
export OCR_SERVED_NAME="${OCR_SERVED_NAME:-minicpm-ocr}"
export VLLM_URL="${VLLM_URL:-http://127.0.0.1:18499}"

pkill -f "ocrweb-server $PORT" 2>/dev/null || true
sleep 0.5

cd "$REPO/webui"
PORT="$PORT" nohup "$PY" -s server.py "ocrweb-server $PORT" >"$LOG" 2>&1 &
PID=$!
sleep 1.5

if ! kill -0 "$PID" 2>/dev/null; then
  echo "启动失败，日志尾部：" >&2; tail -20 "$LOG" >&2; exit 1
fi
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
curl -s --noproxy '*' -m 5 -o /dev/null -w "pid=$PID  http://${IP:-127.0.0.1}:$PORT  status=%{http_code}\n" "http://127.0.0.1:$PORT/"
echo "日志: $LOG"
