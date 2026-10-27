#!/usr/bin/env bash


set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_LOCAL="${OCR_ENV_FILE:-$SDK_DIR/scripts/env.local.sh}"
# shellcheck disable=SC1090
[ -f "$ENV_LOCAL" ] && source "$ENV_LOCAL"

ASSETS_DIR="${OCR_ASSETS_DIR:-$(cd "$SDK_DIR/.." && pwd)}"

LLAMA_SERVER_BIN="${LLAMA_SERVER_BIN:-$ASSETS_DIR/llama.cpp-omni/build/bin/llama-server}"
OCR_GGUF_MODEL="${OCR_GGUF_MODEL:-$ASSETS_DIR/gguf/ocr_model-F16.gguf}"
OCR_GGUF_MMPROJ="${OCR_GGUF_MMPROJ:-$ASSETS_DIR/gguf/ocr_mmproj-F16.gguf}"
LLAMA_HOST="${LLAMA_HOST:-127.0.0.1}"
LLAMA_PORT="${LLAMA_PORT:-18601}"
LLAMA_GPU="${LLAMA_GPU:-${CUDA_VISIBLE_DEVICES:-0}}"
LLAMA_NGL="${LLAMA_NGL:-99}"
LLAMA_CTX="${LLAMA_CTX:-8192}"
LLAMA_PARALLEL="${LLAMA_PARALLEL:-0}"


LLAMA_DOWNSAMPLE_MODE="${LLAMA_DOWNSAMPLE_MODE:-none}"

for f in "$LLAMA_SERVER_BIN" "$OCR_GGUF_MODEL" "$OCR_GGUF_MMPROJ"; do
    if [ ! -e "$f" ]; then
        echo "错误: 找不到 $f" >&2
        echo "      ASSETS_DIR=$ASSETS_DIR（用 OCR_ASSETS_DIR 换根目录，或单独 export 对应变量）" >&2
        exit 1
    fi
done


BIN_DIR="$(cd "$(dirname "$LLAMA_SERVER_BIN")" && pwd)"
export LD_LIBRARY_PATH="${BIN_DIR}${LLAMA_LIB_DIRS:+:$LLAMA_LIB_DIRS}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
[ -n "${LLAMA_LD_PRELOAD:-}" ] && export LD_PRELOAD="$LLAMA_LD_PRELOAD"
export CUDA_VISIBLE_DEVICES="$LLAMA_GPU"


preflight() {
    local ldd_out missing stale_symbols probe
    ldd_out="$(ldd "$LLAMA_SERVER_BIN" 2>&1 || true)"


    missing="$(echo "$ldd_out" | awk '/=> *not found/ {print $1}' | sort -u)"
    if [ -n "$missing" ]; then
        echo "错误: 以下动态库找不到:" >&2
        echo "$missing" | sed 's/^/        /' >&2
        echo "      把它们所在目录加进 LLAMA_LIB_DIRS（冒号分隔）后重试，例如:" >&2
        echo "        export LLAMA_LIB_DIRS=/path/to/nccl/lib:/path/to/cuda/lib64" >&2
        echo "      定位办法: ldd '$LLAMA_SERVER_BIN' | grep 'not found'" >&2
        return 1
    fi


    probe="$("$LLAMA_SERVER_BIN" --help 2>&1 >/dev/null || true)"
    stale_symbols="$(printf '%s\n%s\n' "$ldd_out" "$probe" | grep -oE "(GLIBCXX|CXXABI)_[0-9.]+" | sort -u)"
    if [ -n "$stale_symbols" ]; then
        echo "错误: 依赖的 libstdc++ 太旧，缺少符号: $(echo "$stale_symbols" | tr '\n' ' ')" >&2
        echo "$probe" | head -2 | sed 's/^/        /' >&2
        echo "      找一个够新的 libstdc++.so.6 并设置（RPATH 压过 LD_LIBRARY_PATH，只有 LD_PRELOAD 有效）:" >&2
        echo "        export LLAMA_LD_PRELOAD=/path/to/lib/libstdc++.so.6" >&2
        echo "      挑选办法: strings <libstdc++.so.6> | grep -E '^(GLIBCXX|CXXABI)_' | tail" >&2
        return 1
    fi
    return 0
}

preflight || exit 1
if [ "${1:-}" = "--check" ]; then
    echo "自检通过: $LLAMA_SERVER_BIN 可加载"
    exit 0
fi

ARGS=(
    -m "$OCR_GGUF_MODEL"
    --mmproj "$OCR_GGUF_MMPROJ"
    --host "$LLAMA_HOST"
    --port "$LLAMA_PORT"
    -ngl "$LLAMA_NGL"
    -c "$LLAMA_CTX"
)
[ "$LLAMA_DOWNSAMPLE_MODE" != "none" ] && ARGS+=(--downsample-mode "$LLAMA_DOWNSAMPLE_MODE")
[ "$LLAMA_PARALLEL" -gt 0 ] && ARGS+=(--parallel "$LLAMA_PARALLEL")

echo "启动 llama-server: GPU=$LLAMA_GPU  http://${LLAMA_HOST}:${LLAMA_PORT}"
echo "  健康检查: curl -s http://${LLAMA_HOST}:${LLAMA_PORT}/health"
exec "$LLAMA_SERVER_BIN" "${ARGS[@]}" "$@"
