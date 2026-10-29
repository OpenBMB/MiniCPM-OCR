# SDK Local Deployment: llama.cpp Backend

[中文版](llamacpp_deploy_jev_zh.md)

[← Back to the deployment guide](./minicpm_ocr_jev_tutorial_en.md)

This document covers the SDK deployment path with llama.cpp's `llama-server` as the forward engine: how to install, start, and call the **score service** and the **render+score service**.

This backend differs from the others in two ways: the model has to be converted to GGUF first, and the prompt is assembled by the engine from a template baked into the GGUF rather than by the SDK.

Both services share one forward engine. The only difference is where the render image comes from:

|      | Score service                          | Render+score service                                 |
| ---- | -------------------------------------- | ---------------------------------------------------- |
| Render image | You provide it                   | The service renders it by default (you may also provide it) |
| Render environment | **Not needed** — no Chromium, Node or fonts | Needed                                      |
| Endpoint | `/v1/score`, returns `prob_1`        | `/v1/rm/score*`, returns `prob_yes`, identical to the Docker image |
| Features | Scoring only                         | Scoring, best-of-N within a block, batched best-of-N, with precheck |
| Start script | `sdk/start_score.sh`             | `sdk/start_render_score.sh`                          |

## Deployment steps

1. Build the engine → convert to GGUF → start the forward engine (both services need it)
2. Pick one:
   - **Score service** → install the service environment → start the service
   - **Render+score service** → install the render environment → start the service

The engine and the service must go into two separate virtual environments; do not merge them.

## Requirements

|                | Linux + NVIDIA                                             | macOS (Apple Silicon)            |
| -------------- | ---------------------------------------------------------- | -------------------------------- |
| Accelerator    | NVIDIA, ≥8GB VRAM                                          | M-series chip, ≥16GB unified memory |
| Driver         | ≥535                                                       | Not needed; Metal ships with the OS |
| CUDA Toolkit   | ≥12.0                                                      | Not needed                       |
| Build tools    | CMake ≥3.14, GCC ≥9                                        | Xcode Command Line Tools, CMake  |
| Backend switch | `-DGGML_CUDA=ON`                                           | None; Metal is on by default     |
| Python         | ≥3.10                                                      | ≥3.10; the system one is 3.9, install your own |
| llama.cpp      | ≥ v0.8.0, the release support for this model lands in      | Same                             |
| Pinned versions | `Pillow` 12.3.0, `playwright` 1.62.0 (render+score service only) | `Pillow` 12.3.0             |

**CUDA Toolkit** (Linux only): make sure the linker can find its libraries. When it lives outside `/usr/local/cuda`, register it with `ldconfig`:

```bash
echo /path/to/cuda/lib64 | sudo tee /etc/ld.so.conf.d/cuda.conf
sudo ldconfig
```

**System packages**:

```bash
# Linux
sudo apt-get install -y python3 python3-venv python3-pip git curl cmake build-essential

# macOS: the compiler and git come with the Command Line Tools; CMake is separate
xcode-select --install
brew install cmake
```

---

## 1. Forward engine

### Source and conversion dependencies

Two things, both needed: fetch the source (used for the build and for the GGUF conversion), and install the Python dependencies the conversion needs.

```bash
git clone https://github.com/ggml-org/llama.cpp.git && cd llama.cpp

# A virtual environment can live anywhere; the same goes for every /opt/venv-* below.
# macOS: writing to /opt needs sudo, so put it under your home directory, e.g. ~/venv-convert
python3 -m venv /opt/venv-convert
source /opt/venv-convert/bin/activate
pip install -r requirements/requirements-convert_hf_to_gguf.txt
```

The conversion dependencies go into a virtual environment of their own: Debian/Ubuntu and friends refuse installs into the system Python. On a slow network add `-i https://<your-mirror>/simple` (in mainland China, for example `https://mirrors.ustc.edu.cn/pypi/simple`).

### Build

```bash
cd llama.cpp

# Configure; pick the line for your platform
# Linux + NVIDIA
cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
# macOS: the Metal backend is on by default, no extra switch needed
cmake -B build -DCMAKE_BUILD_TYPE=Release

cmake --build build -j --target llama-server
```

If you only need the GGUF conversion and not the engine (for example when Ollama runs the forward pass), skip this step — conversion is pure Python and does not need the build artifacts.

### Convert to GGUF

Convert the language model and the vision encoder (`mmproj`) separately. The converter identifies the model by `architectures` in `config.json`, which has to be `MiniCPMOCRForSequenceClassification`. The original weights directory stays untouched: create a separate conversion directory, symlink every other file into it, put an edited copy of `config.json` there, and run both conversions from it:

```bash
cd llama.cpp
source /opt/venv-convert/bin/activate
mkdir -p ./models/MiniCPM-OCR-Jev-gguf
for f in ./models/MiniCPM-OCR-Jev/*; do
  [ "$(basename "$f")" = config.json ] || ln -sf "$PWD/$f" ./models/MiniCPM-OCR-Jev-gguf/
done
python - <<'EOF'
import json
c = json.load(open("./models/MiniCPM-OCR-Jev/config.json"))
c["architectures"] = ["MiniCPMOCRForSequenceClassification"]
json.dump(c, open("./models/MiniCPM-OCR-Jev-gguf/config.json", "w"), indent=2, ensure_ascii=False)
EOF

python convert_hf_to_gguf.py ./models/MiniCPM-OCR-Jev-gguf \
  --outtype bf16 --outfile ./models/MiniCPM-OCR-Jev-bf16.gguf

python convert_hf_to_gguf.py ./models/MiniCPM-OCR-Jev-gguf --mmproj \
  --outtype bf16 --outfile ./models/mmproj-MiniCPM-OCR-Jev-bf16.gguf
```

Convert the `mmproj` from the conversion directory too: that is what gives it the same lower bound on image size as in training, so a block image below it is upscaled before encoding. Without it, small images score off.

### Start

```bash
cd llama.cpp
./build/bin/llama-server \
  -m ./models/MiniCPM-OCR-Jev-bf16.gguf \
  --mmproj ./models/mmproj-MiniCPM-OCR-Jev-bf16.gguf \
  -ngl 99 \
  -c 32768 \
  --port 18499
```

- `--mmproj`: the vision encoder GGUF. Without it there is only the text path and the two images cannot get in.
- `-ngl 99`: put every layer on the GPU — the same flag on macOS, where it maps to Metal.
- `-c 32768`: context length, shared by the parallel slots.
- `-np N`: serve N requests in parallel.

Each request is a single forward pass and generates no tokens. Every request carries exactly two images — the original first, then the render. The model has no LM head, so the text-generation endpoints are unavailable.

---

## 2. Score service

You already have the render image and only want the score.

### Install

```bash
# Same on macOS, except that /opt needs sudo — use ~/venv-score instead
python3 -m venv /opt/venv-score
source /opt/venv-score/bin/activate
pip install "fastapi>=0.110" "uvicorn>=0.27" "httpx>=0.27" "pydantic>=2.6" "PyYAML>=6.0" "Pillow==12.3.0"
```

**Reference dependency versions** (the same set on Linux and macOS)

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

`JEV_BACKEND_CONFIG` points at the llama.cpp backend config; the arguments are the service port and the engine address, in that order:

```bash
cd scripts/minicpm-ocr-jev/
JEV_BACKEND_CONFIG=sdk/backends/llamacpp.yaml \
PATH=/opt/venv-score/bin:$PATH bash sdk/start_score.sh 18501 http://127.0.0.1:18499
```

Without `JEV_BACKEND_CONFIG` the service speaks the vLLM protocol, the endpoints do not match, and startup fails.

The service runs a self-check at startup; see [4. Startup self-check](#4-startup-self-check).

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

All three fields are required: `original_image` is the base64 of the original block image, `render_image` is the base64 of that candidate rendered back into an image, and `ocr_text` is the candidate text itself. The base64 carries **no** `data:image/png;base64,` prefix, the same as the image API.

### Fields and limits

- `ocr_text` goes to the model as-is; nothing is cleaned up.
- `prob_1` is the probability that the candidate is consistent with the original image — no threshold, no label.
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

It installs Node, CJK fonts, Chromium and the service dependencies.

> **This section is Linux only.** The script relies on `apt-get` to install Node and the CJK fonts and to pin the font environment to the one the reference deployment uses; on macOS those steps are skipped. Rendered text is model input, and a different font stack means different scores, so **scores produced by this service on macOS cannot be compared against the published numbers**. On macOS use the score service from the previous section (you provide the render image), or switch to the Docker image.

On a slow network, point it at two mirrors:

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
JEV_BACKEND_CONFIG=sdk/backends/llamacpp.yaml \
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

The prompt is assembled by the engine from a template baked into the GGUF, and cannot be read from the service side. So the prompt is **reported rather than verified**, and the service starts regardless. What can be checked is the other half: one real forward pass on a 1×1 image, confirming the engine answers as a classification model with 2 numbers rather than a hidden state.

Once the service is up, query `/healthz`; `status: ok` means everything is fine:

```bash
curl -s http://127.0.0.1:18501/healthz
```

```json
{"status": "ok", "served_model": "./models/MiniCPM-OCR-Jev-bf16.gguf",
 "prompt": {"template_md5": "9aab68e8ba8ab4da17ba9752bddb199c",
            "source": "server_template",
            "last_token": null, "expected_last_token": 271,
            "token_equality": "skipped", "forward_shape": "2 probabilities",
            "notes": ["this engine builds the prompt from a template of its own that cannot be read from here ..."]}}
```

Look at `status` only: `ok` means the self-check passed and the service is ready. The other fields under `prompt` are self-check details, and the shape above is what a healthy one looks like. When `status` is not `ok`, `prompt.notes` says which part failed.

`source` reading `server_template`, `last_token` reading `null` and `token_equality` reading `skipped` are the normal values for this backend, not a fault. One consequence for how the numbers may be read: the scale of this backend's scores can only be established by comparing it against a known backend on the same inputs.

### Verify with the bundled cases

This backend's self-check does not verify the prompt (see above), so this step must not be skipped: score the three cases under `examples/` and compare against the reference score `observed_prob_yes` in each `case.json`:

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

All three scores within 0.02 of the reference is normal, on Linux and macOS alike. For the render+score service, change the endpoint to `/v1/rm/score_best` and the body to `image` plus `candidates` (see [3. Render+score service · Request](#request-1)); the service renders on its own — that variant is only compared against the reference scores on Linux, for the reason given at the top of that section.
