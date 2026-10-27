#!/usr/bin/env bash
# Start the score service -- bring your own render image. Scores candidates that
# have already been rendered.
#
#   usage: ./start_score.sh <port> <engine base url>
#
# Neither argument has a default. Pointing this at the wrong engine produces
# scores rather than an error, so a missing argument stops the script.
#
# This is the entry point for a deployment that renders elsewhere. It needs no
# browser, no Node and no fonts -- only sdk/requirements-score.txt. If you want
# the service to render for you, start sdk/app.py instead
# (sdk/start_render_score.sh); it imports this layer directly and does not talk
# to this port.
set -euo pipefail

PORT="${1:?port required}"
BACKEND="${2:?engine base url required, e.g. http://127.0.0.1:18499}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export JEV_BACKEND_URL="$BACKEND"
# Optional. With the weights reachable here, the startup gate also compares the
# engine's prompt against the local tokenizer token for token; without them it
# can only check the pooled position. Both are described in jev_score/selfcheck.py.
export JEV_WEIGHTS="${JEV_WEIGHTS:-}"

WORKERS="${JEV_WORKERS:-1}"
HOST="${HOST:-0.0.0.0}"

echo "score service on $HOST:$PORT  ->  engine $BACKEND"

cd "$HERE"
exec python3 -m uvicorn jev_score.server:app \
    --host "$HOST" --port "$PORT" --workers "$WORKERS" --no-access-log
