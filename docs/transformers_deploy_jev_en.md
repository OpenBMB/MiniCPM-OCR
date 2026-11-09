# SDK Local Deployment: PyTorch Transformers Backend

[中文版](transformers_deploy_jev_zh.md)

[← Back to the deployment guide](./minicpm_ocr_jev_tutorial_en.md)

This document covers the SDK deployment path with PyTorch Transformers as the forward backend: how to install, start, and call the **score service** and the **render+score service**.

The only difference between the two services is where the render image comes from:

|      | Score service                          | Render+score service                                 |
| ---- | -------------------------------------- | ---------------------------------------------------- |
| Render image | You provide it                   | The service renders it by default (you may also provide it) |
| Render environment | **Not needed** — no Chromium, Node or fonts | Needed                                      |
| Endpoint | `/v1/score`, returns `prob_1`        | `/v1/rm/score*`, returns `prob_yes`, identical to the Docker image |
| Features | Scoring only                         | Scoring, best-of-N within a block, batched best-of-N, with precheck |
| Start script | `sdk/start_score.sh`             | `sdk/start_render_score.sh`                          |

## Deployment steps

1. Install the environment (model dependencies included)
2. Pick one:
   - **Score service** → start the service
   - **Render+score service** → add the render dependencies → start the service

**This backend does not start a separate forward engine.** That is the only difference in deployment steps between it and the vLLM, SGLang, llama.cpp and Ollama backends — see [1. No separate forward engine](#1-no-separate-forward-engine).

## Requirements

|              | Linux                                 | macOS                                       |
| ------------ | ------------------------------------- | ------------------------------------------- |
| Accelerator  | NVIDIA GPU, ≥8GB VRAM                 | Apple Silicon (M series), ≥16GB unified memory |
| Driver       | ≥535                                  | Ships with the OS                           |
| Python       | ≥3.10                                 | ≥3.10                                       |
| Compute backend | CUDA (torch ships its own runtime) | Metal (MPS, ships with torch)               |

- **transformers**: ≥5.19
- **torch**: ≥2.13 (verified with 2.13.0+cu130 on Linux and 2.15.0 on macOS)
- **torchvision**: required — see the note under [Install](#install)
- **CUDA toolkit**: **not needed** — torch ships its own GPU runtime
- **Pinned versions**: `Pillow` 12.3.0, `playwright` 1.62.0 (render+score service only)

The weights occupy about 4.2 GB of accelerator memory (bfloat16) for the life of the process.

**System packages**:

```bash
sudo apt-get install -y python3 python3-venv python3-pip curl
```

On a slow network point pip at a nearby mirror first:

```bash
export PIP_INDEX_URL=https://<your-mirror>/simple
# in mainland China, for example: https://mirrors.ustc.edu.cn/pypi/simple
```

---

## 1. No separate forward engine

The other four backends are separate processes: you start an engine, then start a service, and the service sends images and text to the engine over HTTP. This backend loads the weights directly into the service process. There is no second process and no engine port.

Four consequences follow, and together they decide where this backend fits:

- **One forward pass at a time, by default.** This is a deliberate trade: the weights and the service share one process and one card, so concurrent forward passes compete for memory rather than queueing, and going over means running out of it. Fixing the number at one also means the service never has to implement its own batching or memory budget, which is what keeps it simple to run as a service. Concurrent requests queue inside the service and are executed in turn.
- **For throughput, widen the pass rather than add concurrency.** `max_batch_size` scores several candidates in one forward pass. Measured on 24 candidates (RTX 5090, bfloat16): 2.17 s at batch 1, 0.94 s at batch 4 (2.3x), 0.89 s at batch 8 where the gain has flattened; peak memory rises from 4347 MiB to 4962 MiB. This backend still has no cross-request continuous batching the way an engine does, so **for single-host throughput, use the vLLM or SGLang backend**.
- **The service process is the model process.** Running out of accelerator memory ends the whole service, not just an engine.
- **It runs on Apple Silicon**, where `device: auto` selects Metal (MPS). Of the other four backends only llama.cpp and Ollama run on macOS, and both need GGUF weights; this backend reads the original bfloat16 weights directly.

The config file `sdk/backends/transformers.yaml` points at a weights directory rather than at an engine address:

```yaml
engine: transformers
model_path: /path/to/weights
device: auto          # auto tries cuda:0, then mps, then cpu
dtype: auto           # auto is bfloat16 on cuda and mps, float32 on cpu
attn_implementation: sdpa
max_in_flight: 1
max_batch_size: 1
```

- `model_path` is required, and mutually exclusive with `base_url`: this backend has no engine address to point at, so supplying `base_url` as well fails at startup.
- Keep `dtype` at `auto`. Measured on Apple Silicon, one forward pass takes 0.3 s in bfloat16 and 38 s in float32 — and float32 also lands further from the reference scores, not closer.
- Keep `attn_implementation` at `sdpa`. Measured on 12 samples, `sdpa` lands within 4.4e-3 of the reference scores and `flash_attention_2` within 7.6e-3, the latter outside the 5e-3 band these published scores were measured in.
- Keep `max_in_flight` at 1. It means concurrent forward passes. A larger value is lowered back to 1 at startup, with a note in `prompt.notes` under `/healthz`.
- `max_batch_size` It defaults to 1; raise it for throughput — the measurements above are this setting going from 1 to 8. Candidates beyond it in a request are not dropped, they go in the next pass.

---

## 2. Score service

You already have the render images and only need scores.

### Install

```bash
cd scripts/minicpm-ocr-jev/
python3 -m venv /opt/venv-transformers
source /opt/venv-transformers/bin/activate
pip install -r sdk/requirements-transformers.txt
```

The equivalent package-by-package command:

```bash
pip install "Pillow==12.3.0" "transformers>=5.19" "torch>=2.13" torchvision \
            "fastapi>=0.110" "uvicorn>=0.27" "httpx>=0.27" "pydantic>=2.6" "PyYAML>=6.0"
```

- `Pillow` comes first and is pinned exactly. It decides the pixels of the white padding added to block crops longer than 199:1, so a different version changes the scores. `transformers` and `torch` are given lower bounds only; installed together in one environment, pip does not move `Pillow` forward.
- `torchvision` has nothing to do with video here: `AutoProcessor` builds a video processor from the `processor_config.json` in the weights directory, and that class imports torchvision when constructed. Without it the service fails at startup reporting Torchvision as missing.
- `accelerate` is **not needed**: this backend places the model with `.to(device)` and never shards across devices.
- `causal_conv1d` and `flash-linear-attention` are **not needed**: without these two optional kernel libraries, transformers reports at every start that it is falling back to its reference implementation ("correct but much slower"). Every score in this document was measured without them; install them for speed.

**Reference dependency versions**

```text
python        3.12.3
torch         2.13.0+cu130
transformers  5.19.0
torchvision   0.29.2
fastapi       0.162.0
uvicorn       0.54.0
httpx         0.28.1
pydantic      2.14.1
PyYAML        6.0.3
Pillow        12.3.0
```

### Start

The only argument is the service port; there is no engine address:

```bash
cd scripts/minicpm-ocr-jev/
PATH=/opt/venv-transformers/bin:$PATH \
JEV_BACKEND_CONFIG=sdk/backends/transformers.yaml \
    bash sdk/start_score.sh 18501
```

Start it with the interpreter that has torch, since this process loads the weights. The service runs a single worker: each worker would load its own copy of the weights.

The service runs a prompt self-check at startup — see [4. Startup self-check](#4-startup-self-check).

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | Service status, the loaded weights directory, the prompt template fingerprint and the self-check result |
| POST | `/v1/score` | Score a batch of already-rendered candidates |

### Request

```bash
curl -s http://127.0.0.1:18501/v1/score -H 'Content-Type: application/json' -d '{
  "items": [{"original_image": "<base64>", "render_image": "<base64>", "ocr_text": "..."}]
}'
```

```json
{"results": [{"prob_1": 0.00280, "error": null}]}
```

All three fields are required: `original_image` is the base64 of the original block crop, `render_image` is the base64 of that candidate rendered back into an image, and `ocr_text` is the candidate text itself. The base64 carries **no** `data:image/png;base64,` prefix, matching the image API.

### Fields and limits

- `ocr_text` goes into the model as given, with no cleanup.
- `prob_1` is `softmax(logits)[1]`: no threshold, no label, and the logits are not returned.
- Up to 64 items per request (`JEV_MAX_ITEMS` adjusts it); above that the service returns 413, and an empty batch returns an empty result. This number is an upper guard against one request carrying too many images, not a recommended batch size.
- If a base64 payload cannot be decoded the whole batch returns 422, naming the item index and the field. A failure during scoring affects only that item, which carries its own `error` with `prob_1` set to `null`.

---

## 3. Render+score service

You only have candidate text and want the service to render it before scoring. Precheck, render and forward all happen in this one process.

### Install

With this backend the weights and the renderer live in the same process, so both sets of dependencies go into the **same** virtual environment. Add the render dependencies to the environment from the previous section:

```bash
cd scripts/minicpm-ocr-jev/
source /opt/venv-transformers/bin/activate
pip install "playwright==1.62.0" "Markdown==3.10.3"
playwright install chromium
sudo apt-get install -y nodejs fonts-noto-cjk
```

On a slow network, fetch Chromium from a mirror:

```bash
PLAYWRIGHT_DOWNLOAD_HOST=https://<your-mirror>/playwright \
    playwright install chromium
# in mainland China, for example:
#   PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright
```

Afterwards, confirm `Pillow` is still 12.3.0:

```bash
python3 -c "import PIL; print(PIL.__version__)"
```

When the renderer and the model share one environment, that exact version is yours to keep. It decides the pixels of the render image, and the render image is one of the model's inputs.

### Start

The only argument is the service port; there is no engine address:

```bash
cd scripts/minicpm-ocr-jev/
PATH=/opt/venv-transformers/bin:$PATH \
JEV_BACKEND_CONFIG=sdk/backends/transformers.yaml \
    bash sdk/start_render_score.sh 18500
```

`RM_RENDER_BROWSERS` controls how many render processes run. The service runs a single worker; raise that variable rather than adding workers.

### Endpoints

The paths and field names are identical to the Docker image, so callers moving between the image and the SDK change nothing:

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | As above, plus the supported `input_form` and the render pool status |
| POST | `/v1/rm/score` | Score a batch of "original image + candidate text" pairs, with a summary |
| POST | `/v1/rm/score_best` | Several candidates for one block; pick the best |
| POST | `/v1/rm/score_best_batch` | Several blocks, each picking its own best, in one request |

Full field definitions are in the [Docker image API reference](./minicpm_ocr_jev_docker_api_en.md), which describes the same endpoints this service exposes.

### Request

Best-of-N within one block:

```bash
curl -s http://127.0.0.1:18500/v1/rm/score_best -H 'Content-Type: application/json' -d '{
  "input_form": "ternary",
  "case_id": "block_01",
  "image": "<base64 of the original block crop>",
  "category": "text",
  "candidates": ["candidate A", "candidate B"]
}'
```

```json
{"best_index": 0, "best_text": "candidate A", "scores": [0.99524, 0.00610],
 "verdicts": ["scored", "scored"],
 "stage_sec": {"render_sec": 0.33, "forward_sec": 0.31, "total_sec": 0.65},
 "batch_size": 2}
```

- `input_form` currently takes one value, `ternary`, and must be sent explicitly.
- `category` must match the block's real type (`text` / `formula` / `table`). A wrong value is not an error, but the score will be off.
- Sending `render_images` skips server-side rendering; its length must equal that of `candidates`.
- Up to 64 candidates per request (`RM_MAX_ITEMS` adjusts it), again an upper guard rather than a recommended batch size. All three endpoints count **candidates**, not blocks: `score_best_batch` counts the candidates of every block together, so at 3 candidates per block, 64 covers 21 blocks.

### The two rates in the summary

`pass_rate` and `throughput_rate` are different things. The first is the scoring success rate (`scored / total`, independent of any threshold); the second is the pass-threshold rate (items with `prob_yes >= RM_THRESHOLD` over total, threshold 0.5 by default and configurable). The threshold only enters that second rate; every item's `prob_yes` is returned as produced.

---

## 4. Startup self-check

Both services verify the prompt going into the model before accepting the first request.

After starting, query `/healthz`; `status` of `ok` means everything is in order:

```bash
curl -s http://127.0.0.1:18501/healthz
```

```json
{"status": "ok", "served_model": "/path/to/weights",
 "prompt": {"template_md5": "9aab68e8ba8ab4da17ba9752bddb199c",
            "source": "client",
            "last_token": 271, "expected_last_token": 271,
            "token_equality": "equal",
            "forward_shape": "2 logits",
            "notes": ["the prompt we send matches build_prompt() ..."]}}
```

Read `status` alone: `ok` means the self-check passed and the service is usable, and the remaining fields under `prompt` are the detail it left behind — matching the shape above is normal. When `status` is not `ok`, `prompt.notes` says which check did not pass.

`token_equality` reads `equal` on this backend, where it reads `skipped` on the vLLM, SGLang, llama.cpp and Ollama backends: the token-for-token comparison needs a local tokenizer, and this backend's environment necessarily has transformers installed, so that check can actually run.

### Verify with the bundled cases

The self-check only confirms the service starts. To confirm the scores as well, run the three cases under `examples/` and compare against the reference scores in `observed_prob_yes` in each `case.json`:

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

All three scores within 0.02 of the reference is normal. For the render+score service, change the endpoint to `/v1/rm/score_best` and the body to `image` plus `candidates` (see [3. Render+score service · Request](#request-1)); the service renders for you.
