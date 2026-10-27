#!/usr/bin/env bash


set -Eeuo pipefail

SDK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_DIR="${1:-${OCR_MODEL_PATH:-}}"
: "${MODEL_DIR:?Pass a model directory as the first argument or set OCR_MODEL_PATH}"
RUN_NAME="${2:-omnidocbench_v16_$(date +%Y%m%d_%H%M)}"

: "${IMAGES:?Set IMAGES to the OmniDocBench image directory}"
: "${EVAL_REPO:?Set EVAL_REPO to the evaluation repository containing collect_scores.py}"
RUN_ROOT="${RUN_ROOT_BASE:-$SDK_DIR/runs/eval}/$RUN_NAME"


CONFIG="${CONFIG:-$SDK_DIR/minicpmvocr/configs/minicpmvocr.yaml}"

: "${SERVER_IMAGE:?Set SERVER_IMAGE to a compatible OCR vLLM image}"
: "${CLIENT_IMAGE:?Set CLIENT_IMAGE to an image with the SDK layout dependencies}"
: "${SCORE_IMAGE:?Set SCORE_IMAGE to an OmniDocBench scorer image with ground truth}"

GPU_ID=0
PORT=18509
SMOKE_PAGES=8
SCORE_WORKERS=16
EXPECTED_PAGES=1651
SERVER_NAME="minicpmvocr-eval-vllm-${RUN_NAME}"
SERVED_MODEL="${OCR_SERVED_NAME:-minicpm-ocr}"

log() { printf '[%s] %s\n' "$(date -Is)" "$*"; }

stop_server() {
  if docker ps -a --format '{{.Names}}' | grep -Fxq "$SERVER_NAME"; then
    log "stopping vLLM server $SERVER_NAME"
    docker stop --time 30 "$SERVER_NAME" >/dev/null 2>&1 || true
    docker rm -f "$SERVER_NAME" >/dev/null 2>&1 || true
  fi
}
trap stop_server EXIT INT TERM

assert_environment() {
  [[ -f "$MODEL_DIR/config.json" && -f "$MODEL_DIR/model.safetensors" ]] || { echo "Bad MODEL_DIR: $MODEL_DIR" >&2; exit 1; }
  [[ -f "$CONFIG" && -d "$SDK_DIR/minicpmvocr" && -d "$IMAGES" ]] || { echo "Missing config / SDK / images" >&2; exit 1; }
  for image in "$SERVER_IMAGE" "$CLIENT_IMAGE" "$SCORE_IMAGE"; do docker image inspect "$image" >/dev/null; done
  [[ "$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits -i "$GPU_ID")" -lt 1024 ]] || { echo "GPU $GPU_ID is not idle" >&2; exit 1; }
  if curl --noproxy '*' -fsS --max-time 1 "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1; then
    echo "Port $PORT already has a vLLM endpoint" >&2; exit 1
  fi
  mkdir -p "$RUN_ROOT/server_logs"
  cat >"$RUN_ROOT/run_meta.json" <<META
{
  "run_name": "$RUN_NAME",
  "model_dir": "$MODEL_DIR",
  "model_safetensors_sha256": "$(sha256sum "$MODEL_DIR/model.safetensors" | cut -d' ' -f1)",
  "protocol": "omnidocbench-v1.6-full: minicpmvocr run (paddlex layout + crop + infer) from raw images, scored with omnidocbench-eval:v1.6-with-gt",
  "sdk_commit": "$(git -C "$SDK_DIR" rev-parse HEAD 2>/dev/null || echo unknown)",
  "server_image": "$SERVER_IMAGE", "server_image_id": "$(docker image inspect "$SERVER_IMAGE" --format '{{.Id}}')",
  "client_image": "$CLIENT_IMAGE", "client_image_id": "$(docker image inspect "$CLIENT_IMAGE" --format '{{.Id}}')",
  "score_image": "$SCORE_IMAGE", "score_image_id": "$(docker image inspect "$SCORE_IMAGE" --format '{{.Id}}')",
  "vllm": {"max_model_len": 40960, "max_num_batched_tokens": 8192, "gpu_memory_utilization": 0.70, "batch_invariant": 1, "gpu_id": $GPU_ID},
  "sdk_config": "$CONFIG",
  "sdk_pipeline": $(python3 -c "import yaml,json,sys;print(json.dumps(yaml.safe_load(open(sys.argv[1]))['pipeline']))" "$CONFIG"),
  "started_at": "$(date -Is)"
}
META
}

start_server() {
  stop_server
  docker run -d --rm --name "$SERVER_NAME" \
    --gpus "device=$GPU_ID" --ipc host \
    -p "127.0.0.1:$PORT:$PORT" \
    -e VLLM_BATCH_INVARIANT=1 \
    -e "OCR_SERVED_NAME=$SERVED_MODEL" -e "SERVER_PORT=$PORT" -e "SERVER_LOG=/logs/vllm_gpu${GPU_ID}.log" \
    -v "$MODEL_DIR:/models/ocr:ro" \
    -v "$RUN_ROOT/server_logs:/logs" \
    --entrypoint bash "$SERVER_IMAGE" -lc '
      exec python -m vllm.entrypoints.openai.api_server \
        --model /models/ocr --served-model-name "$OCR_SERVED_NAME" --trust-remote-code \
        --host 0.0.0.0 --port "$SERVER_PORT" --tensor-parallel-size 1 \
        --max-model-len 40960 --max-num-batched-tokens 8192 \
        --limit-mm-per-prompt '"'"'{"image": 36}'"'"' \
        --gpu-memory-utilization 0.70 \
        --attention-backend FLASH_ATTN --uvicorn-log-level warning \
        >>"$SERVER_LOG" 2>&1
    ' >/dev/null
  local deadline=$((SECONDS + 1200))
  while ! curl --noproxy '*' -fsS --max-time 5 "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1; do
    if ! docker ps --format '{{.Names}}' | grep -Fxq "$SERVER_NAME"; then
      echo "vLLM server exited" >&2; tail -120 "$RUN_ROOT/server_logs/vllm_gpu${GPU_ID}.log" >&2 || true; exit 1
    fi
    if ((SECONDS >= deadline)); then
      echo "Timed out waiting for vLLM port $PORT" >&2; tail -120 "$RUN_ROOT/server_logs/vllm_gpu${GPU_ID}.log" >&2 || true; exit 1
    fi
    sleep 5
  done
  log "vLLM endpoint $PORT ready"
}


run_sdk() {
  local tag="$1" limit="$2" expected_pages="$3"
  if [[ -f "$RUN_ROOT/$tag/summary.json" ]]; then log "reuse completed run: $tag"; return; fi
  [[ ! -e "$RUN_ROOT/$tag" ]] || { echo "Refusing to mix with partial run dir: $RUN_ROOT/$tag" >&2; exit 1; }


  docker run --rm --network host --gpus "device=$GPU_ID" --ipc host \
    -e PYTHONPATH=/work/pip -e "RUN_TAG=$tag" -e "LIMIT=$limit" \
    -e OCR_RUN_ROOT=/work/runs -e OCR_LAYOUT_MODEL_DIR=/models/layout_paddlex \
    -e "VLLM_URL=http://127.0.0.1:$PORT" -e "OCR_SERVED_NAME=$SERVED_MODEL" \
    -v "$IMAGES:/work/input:ro" -v "$SDK_DIR:/work/pip:ro" -v "$RUN_ROOT:/work/runs" -v "$CONFIG:/work/config.yaml:ro" \
    --entrypoint bash "$CLIENT_IMAGE" -lc '
      cd /work/pip && python -u -m minicpmvocr run --config /work/config.yaml \
        --set run.run_tag="$RUN_TAG" --set input.limit="$LIMIT" \
        --set input.image_dir=/work/input \
        --set layout.device=cuda:0 \
        --set engine.max_model_len=40960 \
        --set pipeline.overlap_layout=true --set pipeline.max_workers=32 \
        --set logging.progress_log_every=50
    ' 2>&1 | grep -v "Warning\|warnings.warn\|Connectivity check" | tee "$RUN_ROOT/$tag.log"
  local actual; actual="$(find "$RUN_ROOT/$tag/output" -maxdepth 1 -type f -name '*.md' | wc -l)"
  [[ "$actual" -eq "$expected_pages" ]] || { echo "Page count mismatch: $actual != $expected_pages" >&2; exit 1; }
}

score_run() {
  local prediction_dir="$RUN_ROOT/full/output" score_dir="$RUN_ROOT/score/omnidocbench_v16"
  local summary="$score_dir/output_quick_match_run_summary.json"
  if [[ -f "$summary" ]]; then log "reuse completed score"; return; fi
  mkdir -p "$score_dir"
  cat >"$score_dir/eval.yaml" <<YAML
end2end_eval:
  metrics:
    text_block: {metric: [Edit_dist]}
    display_formula: {metric: [Edit_dist, CDM], cdm_workers: $SCORE_WORKERS}
    table: {metric: [TEDS, Edit_dist], teds_workers: $SCORE_WORKERS}
    reading_order: {metric: [Edit_dist]}
  dataset:
    dataset_name: end2end_dataset
    ground_truth: {data_path: /opt/omnidocbench/gt/OmniDocBench_v1.6_full.json}
    prediction: {data_path: /output}
    match_method: quick_match
    match_executor: process
    match_workers: $SCORE_WORKERS
    quick_match_truncated_timeout_sec: 300
    match_timeout_sec: 420
YAML
  docker run --rm -v "$prediction_dir:/output:ro" -v "$score_dir:/score" \
    --entrypoint bash "$SCORE_IMAGE" -lc '
      set -euo pipefail
      test "$(find /output -maxdepth 1 -type f -name "*.md" | wc -l)" -eq 1651
      mkdir -p /tmp/omnidocbench-score && ln -sfn /score /tmp/omnidocbench-score/result
      cd /tmp/omnidocbench-score
      omnidocbench-eval --config /score/eval.yaml 2>&1 | tee /score/eval.log
    '
  [[ -f "$summary" ]] || { echo "Scoring did not produce $summary" >&2; exit 1; }
  python3 "$EVAL_REPO/evaluations/scripts/collect_scores.py" --output-root "$RUN_ROOT/score" --output "$RUN_ROOT/score_summary.json"
}

main() {
  assert_environment
  log "run_root=$RUN_ROOT model=$MODEL_DIR"
  if [[ ! -f "$RUN_ROOT/full/summary.json" ]]; then
    start_server
    run_sdk smoke "$SMOKE_PAGES" "$SMOKE_PAGES"
    log "smoke ok: $(ls "$RUN_ROOT/smoke/output" | head -3 | tr '\n' ' ')"
    run_sdk full 0 "$EXPECTED_PAGES"
    stop_server
  fi
  score_run
  log "DONE: $RUN_ROOT/score_summary.json"
  cat "$RUN_ROOT/score_summary.json"
}

main "$@"
