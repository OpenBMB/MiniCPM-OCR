#!/usr/bin/env bash
# Start the render+score service -- built-in renderer. Renders candidates, then
# scores them.
#
#   usage: ./start_render_score.sh <port> [engine base url]
#
# Run it with the renderer's interpreter -- the environment sdk/setup_render.sh
# built -- because this process renders in-process through serve/render_pool.py.
# That environment pins Pillow to the version the model was calibrated on, which
# the backend's environment deliberately does not.
#
#   PATH=/opt/venv-render/bin:$PATH bash sdk/start_render_score.sh 18500 http://127.0.0.1:18499
#
# The engine URL is omitted -- not defaulted -- for the one backend that has no
# URL to give:
#
#   ./start_render_score.sh 18500 http://127.0.0.1:18499   vllm, sglang, llamacpp, ollama
#   ./start_render_score.sh 18500                          transformers (runs in process)
#
# A *default* URL would point this service at some other engine and produce
# scores rather than an error; omitting the argument introduces no default, and a
# config for an HTTP engine that names no base_url fails at startup saying so.
#
# ⚠ With the transformers backend the two environments described above become
# one: this process renders *and* holds the weights, so it needs the renderer's
# pinned Pillow and torch in the same interpreter. That is what
# sdk/requirements-transformers.txt is for, and why it pins Pillow itself rather
# than leaving it to the model stack to resolve.
#
#   PATH=/opt/venv-transformers/bin:$PATH \
#   JEV_BACKEND_CONFIG=sdk/backends/transformers.yaml bash sdk/start_render_score.sh 18500
set -euo pipefail

PORT="${1:?port required}"
BACKEND="${2-}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -n "$BACKEND" ]; then
    export JEV_BACKEND_URL="$BACKEND"
fi
export JEV_WEIGHTS="${JEV_WEIGHTS:-}"

# This service imports rm_render.py and serve/render_pool.py, and Python writes a
# __pycache__ next to whatever it imports. serve/ is the image's source and is
# meant to stay byte-verifiable, so the bytecode goes somewhere else instead of
# accumulating inside it. It also keeps the material installable on a read-only
# mount, where the default would be a warning on every start.
export PYTHONPYCACHEPREFIX="${PYTHONPYCACHEPREFIX:-${TMPDIR:-/tmp}/jev-pycache}"

# One worker. The render pool keeps browsers open for the life of the process, so
# a second worker is a second set of browsers competing for the same cores, not
# twice the throughput. Scale RM_RENDER_BROWSERS instead.
HOST="${HOST:-0.0.0.0}"

python3 -c 'import playwright' 2>/dev/null || {
    echo "[error] playwright is not importable with this python3. This service" >&2
    echo "        renders in process; run it with the renderer environment:" >&2
    echo "          PATH=/opt/venv-render/bin:\$PATH bash sdk/start_render_score.sh $PORT $BACKEND" >&2
    exit 1; }

echo "render+score service on $HOST:$PORT  ->  engine ${BACKEND:-from ${JEV_BACKEND_CONFIG:-sdk/backends/vllm.yaml} (no URL given)}  (render mode ${RM_RENDER_MODE:-persistent})"

cd "$HERE"
exec python3 -m uvicorn app:app --host "$HOST" --port "$PORT" --no-access-log
