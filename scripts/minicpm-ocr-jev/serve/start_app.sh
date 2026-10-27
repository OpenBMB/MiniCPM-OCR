#!/usr/bin/env bash
# Start the scoring service: precheck + render here, forward pass over HTTP.
#
# Start `vllm serve` first (see start_vllm.sh) -- this process answers /healthz
# with 503 until the backend is up, rather than failing to start, so that a
# restart of either half does not require restarting the other.
#
#   usage: ./start_app.sh <port> <vllm base url>
#   e.g.   ./start_app.sh 8030 http://127.0.0.1:8026
#
# Both arguments are required. A default backend URL would mean a typo in the
# port silently scores against whatever else happens to be listening.
set -euo pipefail

PORT="${1:?port required}"
export RM_VLLM_URL="${2:?vLLM base url required, e.g. http://127.0.0.1:8026}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export PORT
export HOST="${HOST:-0.0.0.0}"
# Deliberately not defaulted. app.py asks the backend which model it serves, so
# the two halves cannot disagree about the name; defaulting it here would set the
# override on every start and put the hardcoded name straight back. Pass it
# through only when the caller actually chose one.
if [ -n "${RM_VLLM_MODEL:-}" ]; then export RM_VLLM_MODEL; fi
export RM_THRESHOLD="${RM_THRESHOLD:-0.5}"
export RM_MAX_ITEMS="${RM_MAX_ITEMS:-64}"
# Keep one Chromium open for the life of the process. The alternative,
# RM_RENDER_MODE=subprocess, starts one per batch and costs 2.3s before the first
# candidate is drawn; it is here as a fallback for environments where the pool
# will not start, not as a tuning choice.
export RM_RENDER_MODE="${RM_RENDER_MODE:-persistent}"
export RM_RENDER_BROWSERS="${RM_RENDER_BROWSERS:-2}"
export RM_BROWSER_CONCURRENCY="${RM_BROWSER_CONCURRENCY:-8}"
export RM_FORWARD_CONCURRENCY="${RM_FORWARD_CONCURRENCY:-32}"

# Workers, not browsers, are the throughput axis -- and the reason is not
# obvious, so it is worth writing down. Every browser a process owns is driven
# over one Playwright connection by one asyncio loop, and rendered screenshots
# come back through it; that one pipe saturates long before the browsers do.
# Measured on 128 cores, four candidates per request, at 32-way concurrency:
#
#     1 worker  x 8 browsers    11.5 candidates/s, p50 5.5s
#     8 workers x 2 browsers    45.5 candidates/s, p50 2.5s
#
# Same sixteen Chromiums in the second row as eight in the first, four times the
# throughput and half the latency. So: scale workers first, keep browsers per
# worker small.
if [ -z "${RM_WORKERS:-}" ]; then
    cores="$( (nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 8) )"
    # One worker per 8 cores: a worker runs two browsers, a Node precheck and its
    # own Python. Capped at 16, which is where one GPU backend saturates --
    # measured end to end at 51 candidates/s, against 52 for the backend alone.
    # Past that the renderer is waiting on the GPU and more workers only cost
    # memory (16 workers hold 32 Chromiums in about 4.3 GB).
    #
    # Read with care inside a container: nproc reports the host's cores, not the
    # CPU quota. On a quota-limited container, set RM_WORKERS explicitly.
    WORKERS="$(( cores / 8 ))"
    [ "$WORKERS" -lt 1 ] && WORKERS=1
    [ "$WORKERS" -gt 16 ] && WORKERS=16
else
    WORKERS="$RM_WORKERS"
fi

echo "app port=$PORT  backend=$RM_VLLM_URL  workers=$WORKERS" \
     "render=$RM_RENDER_MODE browsers=$RM_RENDER_BROWSERS pages=$RM_BROWSER_CONCURRENCY"

cd "$HERE"
exec python3 -m uvicorn app:app --host "$HOST" --port "$PORT" --workers "$WORKERS"
