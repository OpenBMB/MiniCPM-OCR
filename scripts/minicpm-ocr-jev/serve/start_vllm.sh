#!/usr/bin/env bash
# Start the forward-pass backend: a stock `vllm serve` in classification mode.
#
# There is no custom engine code here on purpose. The reward model is an ordinary
# 2-class sequence classifier over a Qwen3.5-VL backbone, so vLLM's own pooling
# runner serves it directly, and its scheduler -- continuous batching, prefix
# caching -- does the work a hand-written engine wrapper would otherwise have to
# reimplement badly.
#
#   usage: ./start_vllm.sh <GPU index> <port> <model path>
#
# The three arguments have no defaults. Picking the wrong GPU means evicting
# whatever already runs on it, so a missing argument stops the script instead of
# quietly falling back to card 0.
set -euo pipefail

GPU="${1:?GPU index required (check nvidia-smi first)}"
PORT="${2:?port required}"
MODEL="${3:?path to the checkpoint directory required}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHAT_TEMPLATE="${CHAT_TEMPLATE:-$HERE/chat_template_passthrough.jinja}"

# Fraction of total GPU memory vLLM may take. The default leaves room for a
# co-tenant on the same card; raise it on a card you own outright.
GPU_MEM_UTIL="${GPU_MEM_UTIL:-0.80}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-16384}"
SERVED_NAME="${SERVED_NAME:-minicpm-ocr-jev}"
HOST="${HOST:-127.0.0.1}"

[ -f "$CHAT_TEMPLATE" ] || { echo "[error] chat template not found: $CHAT_TEMPLATE" >&2; exit 1; }
[ -d "$MODEL" ] || { echo "[error] model directory not found: $MODEL" >&2; exit 1; }

# Triton compiles a small CPython extension on the first forward pass, so a missing
# compiler or missing Python headers do not fail here -- they fail two minutes in,
# after the weights are loaded, as `CalledProcessError: returned non-zero exit
# status 1` with the real cause (`fatal error: Python.h: No such file`) buried sixty
# lines above it. Checking before the load turns that into one actionable line.
command -v gcc >/dev/null 2>&1 || {
    echo "[error] no C compiler on PATH. Triton needs one at run time, on every" >&2
    echo "        cold start.  sudo apt-get install -y gcc g++ python3-dev" >&2
    exit 1; }
python3 -c 'import os,sysconfig; raise SystemExit(0 if os.path.exists(sysconfig.get_paths()["include"] + "/Python.h") else 1)' || {
    echo "[error] Python headers (Python.h) not found; Triton cannot build its" >&2
    echo "        extension.  sudo apt-get install -y python3-dev" >&2
    exit 1; }

echo "model=$MODEL  gpu=$GPU  port=$PORT  util=$GPU_MEM_UTIL"

# --limit-mm-per-prompt image:2 -- ternary input is original + render, always two.
# --chat-template-content-format openai -- keeps message.content as the list of
#   parts, which is what the pass-through template needs; "string" would flatten
#   it and move the image placeholders to the front of the text.
# --hf-overrides num_labels:2 -- the checkpoint's config.json omits num_labels and
#   HF's default happens to be 2, which is the right answer by coincidence rather
#   than by declaration. Saying it out loud means a future 3-class head fails to
#   load instead of loading a wrongly-shaped score layer.
exec env CUDA_VISIBLE_DEVICES="$GPU" \
  vllm serve "$MODEL" \
    --served-model-name "$SERVED_NAME" \
    --runner pooling \
    --convert classify \
    --dtype bfloat16 \
    --max-model-len "$MAX_MODEL_LEN" \
    --limit-mm-per-prompt '{"image":2}' \
    --hf-overrides '{"num_labels":2}' \
    --gpu-memory-utilization "$GPU_MEM_UTIL" \
    --chat-template "$CHAT_TEMPLATE" \
    --chat-template-content-format openai \
    --host "$HOST" \
    --port "$PORT"
