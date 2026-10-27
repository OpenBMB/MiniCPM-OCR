# SDK Local Deployment: SGLang Backend

[中文版](sglang_deploy_jev_zh.md)

[← Back to the deployment guide](./minicpm_ocr_jev_tutorial_en.md)

This document covers the SDK deployment path with SGLang as the forward engine: how to install, start, and call the **score service** and the **render+score service**.

Both services share one forward engine. The only difference is where the render image comes from:

|      | Score service                          | Render+score service                                 |
| ---- | -------------------------------------- | ---------------------------------------------------- |
| Render image | You provide it                   | The service renders it by default (you may also provide it) |
| Render environment | **Not needed** — no Chromium, Node or fonts | Needed                                      |
| Endpoint | `/v1/score`, returns `prob_1`        | `/v1/rm/score*`, returns `prob_yes`, identical to the Docker image |
| Features | Scoring only                         | Scoring, best-of-N within a block, batched best-of-N, with precheck |
| Start script | `sdk/start_score.sh`             | `sdk/start_render_score.sh`                          |

## Deployment steps

1. Install the engine environment and start the forward engine (both services need it)
2. Pick one:
   - **Score service** → install the service environment → start the service
   - **Render+score service** → install the render environment → start the service

The engine and the service must go into two separate virtual environments; do not merge them. All commands below run from `scripts/minicpm-ocr-jev/`.

## Requirements

- **GPU**: NVIDIA, ≥8GB VRAM
- **Driver**: ≥535
- **Python**: ≥3.10
- **SGLang**: latest stable release
- **Pinned versions**: `Pillow` 12.3.0, `playwright` 1.62.0 (render+score service only)

---

## 1. Forward engine

Both services need an SGLang engine to connect to.

```bash
python3 -m venv /opt/venv-sglang && source /opt/venv-sglang/bin/activate
pip install "sglang[all]"
```

Start it:

```bash
python -m sglang.launch_server \
  --model-path ./models/MiniCPM-OCR-Jev \
  --is-embedding \
  --json-model-override-args '{"architectures": ["Qwen3_5VLForSequenceClassification"]}' \
  --port 18499
```

- `--is-embedding`: routes requests through the pooling path instead of generation. Without it there is no `/classify` to call.
- `--json-model-override-args`: needed while the checkpoint's `config.json` lists the generative class `Qwen3_5ForConditionalGeneration` — overriding it to the classification class is what makes the server return the value head's two logits; without it SGLang loads the generative class and returns a 2048-dim hidden state. This is a load-time override; the checkpoint on disk is not touched. If `config.json` already lists `Qwen3_5VLForSequenceClassification`, the flag can be dropped.
- The number of classes comes from `config.json`: `len(id2label)` if present, otherwise `num_labels`. One of the two must be there.
- Do not add `--chat-template`: SGLang applies no template, and the SDK sends the finished prompt string as it is.

Once it is up, check that the engine is ready:

```bash
curl http://127.0.0.1:18499/health
```

Two limitations: the model has no `lm_head`, so speculative decoding is not supported; and `/v1/classify` does not accept images — use `/classify`.

---

## 2. Score service

You already have the render image and only want the score.

### Install

```bash
python3 -m venv /opt/venv-score
source /opt/venv-score/bin/activate
pip install "fastapi>=0.110" "uvicorn>=0.27" "httpx>=0.27" "pydantic>=2.6" "PyYAML>=6.0" "Pillow==12.3.0"
```

**Reference dependency versions**

```text
python        3.12.3
fastapi       0.162.0
uvicorn       0.54.0
httpx         0.28.1
pydantic      2.14.1
PyYAML        6.0.3
Pillow        12.3.0
```

### Start

`JEV_BACKEND_CONFIG` points at the SGLang backend config; the arguments are the service port and the engine address, in that order:

```bash
JEV_BACKEND_CONFIG=sdk/backends/sglang.yaml \
PATH=/opt/venv-score/bin:$PATH bash sdk/start_score.sh 18501 http://127.0.0.1:18499
```

Without `JEV_BACKEND_CONFIG` the service speaks the vLLM protocol. Pointed at SGLang that raises no error, but the scores are unusable.

The service checks the prompt once at startup; see [4. Startup self-check](#4-startup-self-check).

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | Service status, the model the engine actually serves, the prompt template fingerprint and the self-check result |
| POST | `/v1/score` | Score a batch of already rendered candidates |

### Request

```bash
curl -s http://127.0.0.1:18501/v1/score -H 'Content-Type: application/json' -d '{
  "items": [{"original_image": "<base64>", "render_image": "<base64>", "ocr_text": "..."}]
}'
```

```json
{"results": [{"prob_1": 0.00227, "error": null}]}
```

All three fields are required: `original_image` is the base64 of the original block image, `render_image` is the base64 of that candidate rendered back into an image, and `ocr_text` is the candidate text itself. The base64 carries **no** `data:image/png;base64,` prefix, unlike the image API.

### Fields and limits

- `ocr_text` goes to the model as-is; nothing is cleaned up.
- `prob_1` is `softmax(logits)[1]` — no threshold, no label, no logits returned.
- At most 64 items per request (`JEV_MAX_ITEMS` to change it); over the limit returns 413, an empty batch returns an empty result. The number is a guard against packing too many images into one request, not a recommended batch size.
- When a base64 image cannot be decoded, the whole batch returns 422 naming the item and the field. A failure during scoring affects only that one item: it carries an `error` in its own slot and `prob_1` is `null`.

---

## 3. Render+score service

You only have candidate text and want the service to render before scoring. Precheck, render and forward all happen in this one process.

This service calls the scoring layer in-process: it does **not** need a separate score service running, and does not need a port reserved for one.

### Install

```bash
bash sdk/setup_render.sh /opt/venv-render
```

It installs Node, CJK fonts, Chromium and the service dependencies. On a slow network, point it at two mirrors:

```bash
PIP_INDEX_URL=https://<mirror>/simple \
PLAYWRIGHT_DOWNLOAD_HOST=https://<mirror>/playwright \
    bash sdk/setup_render.sh /opt/venv-render
```

### Start

The arguments are the service port and the engine address, in that order:

```bash
JEV_BACKEND_CONFIG=sdk/backends/sglang.yaml \
PATH=/opt/venv-render/bin:$PATH bash sdk/start_render_score.sh 18500 http://127.0.0.1:18499
```

It must be started with the `/opt/venv-render` interpreter, because it renders in its own process. The number of render processes is set by `RM_RENDER_BROWSERS`; the service runs a single worker, so raise that variable rather than adding workers when you need more throughput.

### Endpoints

Paths and field names are identical to the Docker image, so a caller switching between the image and the SDK does not have to change a single field:

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | As above, plus the supported `input_form` |
| POST | `/v1/rm/score` | Score a batch of "original image + candidate text" pairs, one score each, with a summary |
| POST | `/v1/rm/score_best` | Several candidates for one block; returns the best |
| POST | `/v1/rm/score_best_batch` | Several blocks, each picking its own best, in one request |

For the full field definitions see the [Docker image API reference](./minicpm_ocr_jev_docker_api_en.md) — that document describes the very same endpoints this service exposes.

### Request

Best-of-N within a block:

```bash
curl -s http://127.0.0.1:18500/v1/rm/score_best -H 'Content-Type: application/json' -d '{
  "input_form": "ternary",
  "case_id": "block_01",
  "image": "<base64 of the original block image>",
  "category": "text",
  "candidates": ["candidate A", "candidate B"]
}'
```

```json
{"best_index": 1, "best_text": "candidate B", "scores": [0.00589, 0.99509],
 "verdicts": ["scored", "scored"],
 "stage_sec": {"render_sec": 0.31, "forward_sec": 0.02, "total_sec": 0.34},
 "batch_size": 2}
```

- `input_form` currently takes only `ternary`, and must be sent explicitly.
- `category` must match the real type of the block (`text` / `formula` / `table`). Getting it wrong raises no error but skews the score.
- Passing `render_images` skips server-side rendering; its length must match `candidates`.
- At most 64 candidates per request (`RM_MAX_ITEMS` to change it) — again a guard, not a recommended batch size. All three endpoints count **candidates**, not blocks: `score_best_batch` counts the candidates of all blocks added up, so with 3 candidates per block, 64 only covers 21 blocks.

### The two rates in the summary

`pass_rate` and `throughput_rate` are two different things: the first is the scoring success rate (`scored / total`, independent of any threshold), the second is the pass-threshold rate (items with `prob_yes >= RM_THRESHOLD`, divided by total; the threshold defaults to 0.5 and is configurable). The threshold only enters this one rate — every `prob_yes` is returned as it is.

---

## 4. Startup self-check

SGLang applies no template: the whole prompt string is assembled on the SDK side and sent as it is. What the self-check verifies therefore moves with it — it compares **the exact string about to be sent** against the output of `build_prompt()`, character for character, and confirms that exactly two images ride along. It also runs one real forward pass on a 1×1 image to confirm the engine answers with 2 logits rather than a hidden state.

Once the service is up, query `/healthz`; `status: ok` means everything is fine:

```bash
curl -s http://127.0.0.1:18501/healthz
```

```json
{"status": "ok", "served_model": "/path/to/weights",
 "prompt": {"template_md5": "9aab68e8ba8ab4da17ba9752bddb199c",
            "source": "client",
            "last_token": 271, "expected_last_token": 271,
            "token_equality": "equal", "forward_shape": "2 logits",
            "notes": ["the prompt we send matches build_prompt() character for character ..."]}}
```

Look at `status` only: `ok` means the self-check passed and the service is ready. The other fields under `prompt` are self-check details, and the shape above is what a healthy one looks like. When `status` is not `ok`, `prompt.notes` says which part failed.

`served_model` is the weights path the engine was started with (SGLang identifies a model by path and serves one model per process). When the weights directory is not on this host, or `transformers` is not installed, `token_equality` reads `skipped` — a skip, not a failure, and `notes` says why.
