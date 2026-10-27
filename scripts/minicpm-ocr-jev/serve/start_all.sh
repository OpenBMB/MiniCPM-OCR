#!/usr/bin/env bash
# Run both halves in one place: `vllm serve` for the forward pass, and app.py for
# precheck, rendering and the HTTP contract.
#
#   usage: ./start_all.sh <app port> <model path> [vllm port]
#
# This is the shape to use when the service has to look like one endpoint to its
# callers -- a single container with a single port, replacing an older single-
# container service. The two halves are still two processes, and that is the whole
# point: a browser pool and a vLLM engine in one Python process share one asyncio
# loop, and the loop saturates at about a quarter of the throughput. Measured on
# one machine, four candidates per request, same GPU, same checkpoint:
#
#     in-process engine + browser pool     13.0 candidates/s, p50 14.0s
#     two processes, 16 workers x 2        54.3 candidates/s, p50  2.7s
#
# So: one container if you need one address, never one process.
#
# The GPU is chosen from outside (CUDA_VISIBLE_DEVICES, or docker's --gpus), so
# there is no GPU argument here: inside a container with one GPU assigned, the
# visible index is 0.
set -euo pipefail

APP_PORT="${1:?app port required}"
MODEL="${2:?path to the checkpoint directory required}"
VLLM_PORT="${3:-${RM_VLLM_PORT:-8026}}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Which interpreter runs which half. Two environments, because vLLM requires only
# pillow>=12.3.0 while the renderer pins it exactly: sharing one environment lets a
# vLLM upgrade move Pillow and change every score. Point these at one interpreter
# if you have deliberately installed both into it.
VLLM_PYTHON_BIN="${VLLM_PYTHON_BIN:-/opt/venv-vllm/bin}"
RENDER_PYTHON_BIN="${RENDER_PYTHON_BIN:-/opt/venv-render/bin}"

READY_TIMEOUT="${READY_TIMEOUT:-900}"

log() { printf '[start_all] %s\n' "$*"; }

backend_pid=""
app_pid=""

# Kill the other half on the way out. Without this, stopping the container leaves
# whichever process is not PID 1 to be killed by the runtime at timeout, and a
# vLLM holding 20 GB of GPU memory takes its time about it.
cleanup() {
    trap - EXIT INT TERM
    [ -n "$app_pid" ]     && kill -TERM "$app_pid"     2>/dev/null || true
    [ -n "$backend_pid" ] && kill -TERM "$backend_pid" 2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------- backend
log "backend: vllm serve on 127.0.0.1:$VLLM_PORT  (model $MODEL)"
PATH="$VLLM_PYTHON_BIN:$PATH" HOST=127.0.0.1 \
    bash "$HERE/start_vllm.sh" 0 "$VLLM_PORT" "$MODEL" &
backend_pid=$!

# Wait for the backend by asking it, not by sleeping. Loading weights, capturing
# CUDA graphs and warming the multi-modal path took 174s on the machine this was
# written on; a fixed sleep is either wrong or wasteful.
log "waiting for the backend (up to ${READY_TIMEOUT}s)"
t0=$(date +%s)
while :; do
    if ! kill -0 "$backend_pid" 2>/dev/null; then
        log "[error] the backend exited before becoming ready"
        exit 1
    fi
    if curl -sf -m 5 "http://127.0.0.1:$VLLM_PORT/v1/models" >/dev/null 2>&1; then
        log "backend ready after $(( $(date +%s) - t0 ))s"
        break
    fi
    if [ $(( $(date +%s) - t0 )) -ge "$READY_TIMEOUT" ]; then
        log "[error] the backend did not become ready within ${READY_TIMEOUT}s"
        exit 1
    fi
    sleep 5
done

# ---------------------------------------------------------------- service
log "service: app.py on 0.0.0.0:$APP_PORT"
PATH="$RENDER_PYTHON_BIN:$PATH" \
    bash "$HERE/start_app.sh" "$APP_PORT" "http://127.0.0.1:$VLLM_PORT" &
app_pid=$!

# ---------------------------------------------------------------- supervise
# Exit as soon as either half dies, so that a restart policy can act on it. A
# container whose backend has died but whose HTTP layer still answers -- with 503,
# correctly, forever -- is the failure mode worth avoiding here: it looks alive to
# everything except the caller reading the response body.
log "both halves up; supervising"
while :; do
    if ! kill -0 "$backend_pid" 2>/dev/null; then
        log "[error] the backend exited; stopping the service too"
        exit 1
    fi
    if ! kill -0 "$app_pid" 2>/dev/null; then
        log "[error] the service exited; stopping the backend too"
        exit 1
    fi
    sleep 5
done
