# SDK Local Deployment: vLLM Backend

[中文版](vllm_deploy_jev_zh.md)

[← Back to the deployment guide](./minicpm_ocr_jev_tutorial_en.md)

This document covers the SDK deployment path with vLLM as the forward engine: how to install, start, and call the **score service** and the **render+score service**.

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

The engine and the service must go into two separate virtual environments; do not merge them.

## Requirements

- **GPU**: NVIDIA, ≥12GB VRAM
- **Driver**: ≥535
- **Python**: ≥3.10
- **vLLM**: 0.32.0
- **CUDA toolkit**: **not needed** — vLLM ships its own GPU runtime
- **Pinned versions**: `Pillow` 12.3.0, `playwright` 1.62.0 (render+score service only)

**System packages**: `gcc`, `g++` and `python3-dev` are runtime dependencies — do not remove them after installing.

```bash
sudo apt-get install -y python3 python3-venv python3-pip curl gcc g++ python3-dev
```

The engine environment pulls 8–9 GB of dependencies; on a slow network point pip at a nearby mirror first:

```bash
export PIP_INDEX_URL=https://<your-mirror>/simple
# in mainland China, for example: https://mirrors.ustc.edu.cn/pypi/simple
```

---

## 1. Forward engine

Install and start it with the bundled scripts; the arguments are GPU index, port, and weights path, in that order:

```bash
cd scripts/minicpm-ocr-jev/
bash serve/setup_backend.sh /opt/venv-vllm
PATH=/opt/venv-vllm/bin:$PATH bash sdk/start_engine.sh 0 18499 /path/to/weights
```

Or run the equivalent commands by hand:

```bash
python3 -m venv /opt/venv-vllm && source /opt/venv-vllm/bin/activate
pip install vllm

vllm serve /path/to/weights \
  --served-model-name minicpm-ocr-jev \
  --runner pooling --convert classify \
  --hf-overrides '{"num_labels": 2}' \
  --limit-mm-per-prompt '{"image": 2}' \
  --chat-template-content-format openai \
  --gpu-memory-utilization 0.80 \
  --host 127.0.0.1 --port 18499
```

- `--hf-overrides '{"num_labels": 2}'`: the checkpoint's `config.json` omits `num_labels`, so it has to be given explicitly. Do not override `architectures` at the same time.
- `--chat-template-content-format openai`: required. With the default value the image/text order does not match training, while requests still return 200 and scores still land in a plausible range.
- `--limit-mm-per-prompt '{"image": 2}'`: every request carries exactly two images, the original and the render.
- Do not add `--chat-template`: the SDK sends an interleaved content list, which the model's own `chat_template.jinja` renders into the training prompt.

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

The arguments are the service port and the engine address, in that order:

```bash
cd scripts/minicpm-ocr-jev/
PATH=/opt/venv-score/bin:$PATH bash sdk/start_score.sh 18501 http://127.0.0.1:18499
```

The service checks the prompt once at startup; see [4. Startup self-check](#4-startup-self-check).

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | Service status, the model name the engine actually serves, the prompt template fingerprint and the self-check result |
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

All three fields are required: `original_image` is the base64 of the original block image, `render_image` is the base64 of that candidate rendered back into an image, and `ocr_text` is the candidate text itself. The base64 carries **no** `data:image/png;base64,` prefix, the same as the image API.

### Fields and limits

- `ocr_text` goes to the model as-is; nothing is cleaned up.
- `prob_1` is `softmax(logits)[1]` — no threshold, no label, no logits returned.
- At most 64 items per request (`JEV_MAX_ITEMS` to change it); over the limit returns 413, an empty batch returns an empty result. The number is a guard against packing too many images into one request, not a recommended batch size.
- When a base64 image cannot be decoded, the whole batch returns 422 naming the item and the field. A failure during scoring affects only that one item: it carries an `error` in its own slot and `prob_1` is `null`.

---

## 3. Render+score service

You only have candidate text and want the service to render before scoring. Precheck, render and forward all happen in this one process.

### Install

```bash
cd scripts/minicpm-ocr-jev/
bash sdk/setup_render.sh /opt/venv-render
```

It installs Node, CJK fonts, Chromium and the service dependencies. On a slow network, point it at two mirrors:

```bash
cd scripts/minicpm-ocr-jev/
PIP_INDEX_URL=https://<your-mirror>/simple \
PLAYWRIGHT_DOWNLOAD_HOST=https://<your-playwright-mirror> \
    bash sdk/setup_render.sh /opt/venv-render
# in mainland China, for example:
#   PIP_INDEX_URL=https://mirrors.ustc.edu.cn/pypi/simple
#   PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright
```

### Start

The arguments are the service port and the engine address, in that order:

```bash
cd scripts/minicpm-ocr-jev/
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

Both services check the prompt the engine assembles before accepting the first request. If a change to the engine's startup arguments has changed the structure of the prompt, the self-check fails.

Once the service is up, query `/healthz`; `status: ok` means everything is fine:

```bash
curl -s http://127.0.0.1:18501/healthz
```

```json
{"status": "ok", "served_model": "minicpm-ocr-jev",
 "prompt": {"template_md5": "9aab68e8ba8ab4da17ba9752bddb199c",
            "last_token": 271, "expected_last_token": 271,
            "token_equality": "skipped",
            "notes": ["token-for-token comparison skipped: ..."]}}
```

Look at `status` only: `ok` means the self-check passed and the service is ready. The other fields under `prompt` are self-check details, and the shape above is what a healthy one looks like. When `status` is not `ok`, `prompt.notes` says which part failed.

### Verify with the bundled cases

The self-check only confirms the service starts. To confirm the scores are right as well, score the three cases under `examples/` and compare against the reference score `observed_prob_yes` in each `case.json`:

```bash
cd scripts/minicpm-ocr-jev
python3 - <<'EOF'
import base64, json, urllib.request
for name in ("01_text_putnam", "02_formula_putnam", "03_table_gb_standard"):
    c = json.load(open(f"examples/{name}/case.json"))
    role = c["reference_render_of"]
    text = next(x["text"] for x in c["candidates"] if x["role"] == role)
    b64 = lambda f: base64.b64encode(open(f"examples/{name}/{f}", "rb").read()).decode()
    body = {"items": [{"original_image": b64(c["block_image"]),
                       "render_image": b64(c["reference_render"]), "ocr_text": text}]}
    req = urllib.request.Request("http://127.0.0.1:18501/v1/score",
            data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    got = json.load(urllib.request.urlopen(req))["results"][0]["prob_1"]
    print(f"{name:24} got {got:.5f}  reference {c['observed_prob_yes'][role]:.5f}")
EOF
```

All three scores within 0.02 of the reference is normal. For the render+score service, change the endpoint to `/v1/rm/score_best` and the body to `image` plus `candidates` (see [3. Render+score service · Request](#request-1)); the service renders on its own.
