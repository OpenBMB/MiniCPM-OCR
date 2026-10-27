#!/usr/bin/env bash
# Start the forward-pass engine for the SDK path: a stock `vllm serve`.
#
#   usage: ./start_engine.sh <GPU index> <port> <model path>
#
# The three arguments have no defaults. Picking the wrong GPU means evicting
# whatever already runs on it, so a missing argument stops the script instead of
# quietly falling back to card 0.
#
# This is NOT serve/start_vllm.sh with a different name. One flag differs, and it
# is the flag that decides whether the model sees the prompt it was trained on:
#
#   serve/start_vllm.sh   --chat-template chat_template_passthrough.jinja
#   this script           (no --chat-template at all)
#
# The image route hands vLLM a pass-through template and assembles the finished
# prompt itself. The SDK route does the opposite: it sends the message as an
# interleaved content list and lets the model's own chat_template.jinja render
# it. Both arrive at the same 86 tokens. Mixing them does not -- a pass-through
# template applied to an interleaved list, or the model's template applied to a
# pre-assembled prompt, both produce a plausible prompt that is not this one.
#
# `sdk/jev_score/selfcheck.py` is what catches that, and it runs before either
# service accepts traffic.
set -euo pipefail

GPU="${1:?GPU index required (check nvidia-smi first)}"
PORT="${2:?port required}"
MODEL="${3:?path to the checkpoint directory required}"

GPU_MEM_UTIL="${GPU_MEM_UTIL:-0.80}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-16384}"
SERVED_NAME="${SERVED_NAME:-minicpm-ocr-jev}"
HOST="${HOST:-127.0.0.1}"

[ -d "$MODEL" ] || { echo "[error] model directory not found: $MODEL" >&2; exit 1; }

# Triton compiles a small CPython extension on the first forward pass, so a
# missing compiler fails two minutes in, after the weights load, as a bare
# CalledProcessError. Checking here turns that into one actionable line.
command -v gcc >/dev/null 2>&1 || {
    echo "[error] no C compiler on PATH. Triton needs one at run time, on every" >&2
    echo "        cold start.  sudo apt-get install -y gcc g++ python3-dev" >&2
    exit 1; }
python3 -c 'import os,sysconfig; raise SystemExit(0 if os.path.exists(sysconfig.get_paths()["include"] + "/Python.h") else 1)' || {
    echo "[error] Python headers (Python.h) not found; Triton cannot build its" >&2
    echo "        extension.  sudo apt-get install -y python3-dev" >&2
    exit 1; }

echo "model=$MODEL  gpu=$GPU  port=$PORT  util=$GPU_MEM_UTIL  (model's own chat template)"

# --chat-template-content-format openai -- keep message.content as the list of
#   parts. This one is not optional and its failure is silent: with "string",
#   vLLM flattens the list and hoists both image placeholders to the front of the
#   text, so the model gets original+render+text instead of the interleaving it
#   was trained on, and still answers 200 with a number in range.
# --limit-mm-per-prompt image:2 -- ternary input is original + render, always two.
# --hf-overrides num_labels:2 -- the checkpoint's config.json omits num_labels and
#   HF's default happens to be 2, which is right by coincidence rather than by
#   declaration. Saying it out loud means a future 3-class head fails to load
#   instead of loading a wrongly-shaped score layer.
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
    --chat-template-content-format openai \
    --host "$HOST" \
    --port "$PORT"
