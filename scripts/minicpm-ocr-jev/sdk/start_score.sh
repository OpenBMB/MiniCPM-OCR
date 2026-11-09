#!/usr/bin/env bash
# Start the score service -- bring your own render image. Scores candidates that
# have already been rendered.
#
#   usage: ./start_score.sh <port> [engine base url]
#
# The port has no default. Neither does the engine URL -- for the one backend
# that has no URL to give, it is *omitted* rather than defaulted:
#
#   ./start_score.sh 18501 http://127.0.0.1:18499   vllm, sglang, llamacpp, ollama
#   ./start_score.sh 18501                          transformers (runs in process)
#
# That distinction is the whole of what the original check protected. The danger
# was never a missing argument as such: a *default* URL would silently point a
# service at some other engine and produce scores rather than an error. Omitting
# the argument introduces no default -- it leaves JEV_BACKEND_URL unset, the
# backend config decides, and a config for an HTTP engine that names no base_url
# fails at startup saying exactly that. Neither path can end in a service scoring
# against an engine nobody chose.
#
# ⚠ With the transformers backend this process loads the weights itself, so run
# it with an interpreter that has torch and transformers
# (sdk/requirements-transformers.txt):
#
#   PATH=/opt/venv-transformers/bin:$PATH \
#   JEV_BACKEND_CONFIG=sdk/backends/transformers.yaml bash sdk/start_score.sh 18501
#
# This is the entry point for a deployment that renders elsewhere. It needs no
# browser, no Node and no fonts -- only sdk/requirements-score.txt, plus the model
# stack when the backend is the local one. If you want the service to render for
# you, start sdk/app.py instead (sdk/start_render_score.sh); it imports this layer
# directly and does not talk to this port.
set -euo pipefail

PORT="${1:?port required}"
BACKEND="${2-}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Exported only when given. Exporting it empty would read the same to this script
# and differently to the config loader, which treats a blank base_url as one that
# was asked for and left blank.
if [ -n "$BACKEND" ]; then
    export JEV_BACKEND_URL="$BACKEND"
fi
# Optional. With the weights reachable here, the startup gate also compares the
# engine's prompt against the local tokenizer token for token; without them it
# can only check the pooled position. Both are described in jev_score/selfcheck.py.
export JEV_WEIGHTS="${JEV_WEIGHTS:-}"

WORKERS="${JEV_WORKERS:-1}"
HOST="${HOST:-0.0.0.0}"

echo "score service on $HOST:$PORT  ->  engine ${BACKEND:-from ${JEV_BACKEND_CONFIG:-sdk/backends/vllm.yaml} (no URL given)}"

cd "$HERE"
exec python3 -m uvicorn jev_score.server:app \
    --host "$HOST" --port "$PORT" --workers "$WORKERS" --no-access-log
