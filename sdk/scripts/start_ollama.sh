#!/usr/bin/env bash


set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_LOCAL="${OCR_ENV_FILE:-$SDK_DIR/scripts/env.local.sh}"
# shellcheck disable=SC1090
[ -f "$ENV_LOCAL" ] && source "$ENV_LOCAL"

ASSETS_DIR="${OCR_ASSETS_DIR:-$(cd "$SDK_DIR/.." && pwd)}"

find_ollama() {
    if [ -n "${OLLAMA_BIN:-}" ]; then echo "$OLLAMA_BIN"; return; fi
    command -v ollama 2>/dev/null && return
    for candidate in "$HOME/projects/ollama/ollama" "$ASSETS_DIR/../ollama/ollama"; do
        [ -x "$candidate" ] && { echo "$candidate"; return; }
    done
    echo ""
}

OLLAMA_BIN="$(find_ollama)"
OLLAMA_MODELFILE="${OLLAMA_MODELFILE:-$ASSETS_DIR/ollama-ocr/Modelfile}"
OLLAMA_MODEL="${OLLAMA_MODEL:-surgery-ocr}"
OLLAMA_GPU="${OLLAMA_GPU:-${CUDA_VISIBLE_DEVICES:-0}}"
OLLAMA_HOST_ADDR="${OLLAMA_HOST_ADDR:-127.0.0.1:11434}"

if [ -z "$OLLAMA_BIN" ] || [ ! -x "$OLLAMA_BIN" ]; then
    echo "错误: 找不到 ollama 可执行文件。装好后放进 PATH，或 export OLLAMA_BIN=/path/to/ollama" >&2
    exit 1
fi


[ -n "${OLLAMA_MODELS_DIR:-}" ] && export OLLAMA_MODELS="$OLLAMA_MODELS_DIR"
export OLLAMA_HOST="$OLLAMA_HOST_ADDR"
export CUDA_VISIBLE_DEVICES="$OLLAMA_GPU"

create_model() {
    if "$OLLAMA_BIN" list 2>/dev/null | awk '{print $1}' | grep -qx "${OLLAMA_MODEL}\(:latest\)\?"; then
        echo "模型 ${OLLAMA_MODEL} 已存在，跳过 create"
        return
    fi
    if [ ! -f "$OLLAMA_MODELFILE" ]; then
        echo "错误: 模型 ${OLLAMA_MODEL} 不存在，且找不到 Modelfile: $OLLAMA_MODELFILE" >&2
        echo "      export OLLAMA_MODELFILE=/path/to/Modelfile 后重试" >&2
        exit 1
    fi
    echo "创建模型 ${OLLAMA_MODEL} <- ${OLLAMA_MODELFILE}"
    "$OLLAMA_BIN" create "$OLLAMA_MODEL" -f "$OLLAMA_MODELFILE"
}

if [ "${1:-}" = "--create-only" ]; then
    create_model
    exit 0
fi

echo "启动 ollama serve: GPU=$OLLAMA_GPU  http://${OLLAMA_HOST_ADDR}"
"$OLLAMA_BIN" serve &
SERVE_PID=$!
trap 'kill "$SERVE_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
    curl -sf "http://${OLLAMA_HOST_ADDR}/api/tags" >/dev/null 2>&1 && break
    sleep 1
done

create_model
echo "就绪。模型列表: curl -s http://${OLLAMA_HOST_ADDR}/api/tags"
wait "$SERVE_PID"
