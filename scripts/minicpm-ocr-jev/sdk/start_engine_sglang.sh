#!/usr/bin/env bash
# Start the forward-pass engine for the SDK path on SGLang.
#
#   usage: ./start_engine_sglang.sh <GPU index> <port> <model path>
#
# The three arguments have no defaults. Picking the wrong GPU means evicting
# whatever already runs on it, so a missing argument stops the script instead of
# quietly falling back to card 0.
#
# How this differs from the vLLM script, and why it matters:
#
#   start_engine.sh          the engine applies the model's chat_template.jinja
#   this script              the engine applies no template at all
#
# SGLang's /classify takes a finished prompt string. The SDK sends one, built by
# `build_prompt()`, whose fingerprint is asserted at import. So the prompt cannot
# be mangled downstream -- and the startup gate checks our side of the wire
# instead of the engine's (`prompt_source: client` in jev_score/selfcheck.py).
#
# What can still go wrong here is the model class, not the prompt. Without
# --json-model-override-args the server loads the generative class and answers
# /classify with a hidden state of a few thousand dimensions instead of two
# logits; the gate catches that on a real forward pass before traffic arrives.
set -euo pipefail

GPU="${1:?GPU index required (check nvidia-smi first)}"
PORT="${2:?port required}"
MODEL="${3:?path to the checkpoint directory required}"

MEM_FRACTION="${MEM_FRACTION:-0.45}"
HOST="${HOST:-127.0.0.1}"

[ -d "$MODEL" ] || { echo "[error] model directory not found: $MODEL" >&2; exit 1; }

echo "model=$MODEL  gpu=$GPU  port=$PORT  mem-fraction=$MEM_FRACTION  (no chat template)"

# --is-embedding -- run the model through the pooling path rather than as a text
#   generator. Without it there is no /classify to call.
# --json-model-override-args -- the checkpoint's config.json lists
#   Qwen3_5ForConditionalGeneration, which is the generative class. Overriding it
#   to the sequence-classification class is what makes the server return the two
#   logits of the value head. This is a load-time override; the checkpoint on
#   disk is not touched.
# --mem-fraction-static -- SGLang otherwise reserves most of the free memory on
#   the card for its cache pools. The model itself needs about 8 GB. Below ~0.25
#   of a 24 GB card the hybrid state cache is too small to serve anything.
exec env CUDA_VISIBLE_DEVICES="$GPU" \
  python -m sglang.launch_server \
    --model-path "$MODEL" \
    --is-embedding \
    --json-model-override-args '{"architectures": ["Qwen3_5VLForSequenceClassification"]}' \
    --mem-fraction-static "$MEM_FRACTION" \
    --host "$HOST" \
    --port "$PORT"
