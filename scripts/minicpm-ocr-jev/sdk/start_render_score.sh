#!/usr/bin/env bash
# Start the render+score service -- built-in renderer. Renders candidates, then
# scores them.
#
#   usage: ./start_render_score.sh <port> <engine base url>
#
# Run it with the renderer's interpreter -- the environment sdk/setup_render.sh
# built -- because this process renders in-process through serve/render_pool.py.
# That environment pins Pillow to the version the model was calibrated on, which
# the backend's environment deliberately does not.
#
#   PATH=/opt/venv-render/bin:$PATH bash sdk/start_render_score.sh 18500 http://127.0.0.1:18499
#
# Neither argument has a default: pointing this at the wrong engine produces
# scores rather than an error.
set -euo pipefail

PORT="${1:?port required}"
BACKEND="${2:?engine base url required, e.g. http://127.0.0.1:18499}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export JEV_BACKEND_URL="$BACKEND"
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

echo "render+score service on $HOST:$PORT  ->  engine $BACKEND  (render mode ${RM_RENDER_MODE:-persistent})"

cd "$HERE"
exec python3 -m uvicorn app:app --host "$HOST" --port "$PORT" --no-access-log
