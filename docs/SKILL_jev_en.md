---
name: minicpm-ocr-jev-deploy
description: Install, deploy and verify the MiniCPM-OCR Jev scoring service by either of two paths — the Docker image, or the SDK local deployment (four inference backends: vLLM / SGLang / llama.cpp / Ollama). Use when the user wants to start a Jev scoring service, deploy the Jev image or SDK, score OCR output for consistency or pick the best of several candidates, or troubleshoot startup and scoring errors.
---

# MiniCPM-OCR Jev local deployment

Jev judges whether a piece of OCR text matches the original image: send the original image and the candidate text, get back a consistency score between 0 and 1.

There are two deployment paths, using the same model and the same scoring logic: the **Docker image** carries the engine, the scoring service and the render environment in one container; the **SDK** installs the renderer and the model service separately on the host — the engine does the forward pass, the service layer does the scoring, and the two must live in different virtual environments.

The commands here come from the same source as `docs/minicpm_ocr_jev_tutorial_en.md`, `docs/minicpm_ocr_jev_docker_api_en.md` and `docs/{vllm,sglang,llamacpp,ollama}_deploy_jev_en.md`, and every section names the section of those documents it mirrors; change one side and the other must follow.

## 1. Determine the plan

### 1.1 First settle which path

| | Docker image (1.2) | SDK (1.3 onwards) |
|---|---|---|
| Render environment | Pinned Chromium and CJK fonts, built into the image | Installed by you (6.2), or the caller provides the render image (6.1) |
| What the scores mean | Same render environment as the cloud API, so they can be compared against the published numbers directly | Ranking is stable; absolute values may differ in the third decimal |
| What to install | Docker + NVIDIA Container Toolkit | Two virtual environments: engine + service layer |
| Inference backend | vLLM, fixed inside the image | One of vLLM / SGLang / llama.cpp / Ollama |
| Platforms | Linux + NVIDIA only | Linux + NVIDIA / macOS (see 1.3) |
| Suited to | Comparing against the published numbers, not installing a render environment yourself | No Docker, macOS, render images already in hand, or a specific backend wanted |

When the machine has Docker and an NVIDIA GPU and the user has no preference, take the Docker image. **The Docker path needs only 1.2 plus 7.3, and section 3 for the weights; sections 2, 4, 5, 6 and 8 are all SDK steps.**

### 1.2 Docker image (mirrors path one in `minicpm_ocr_jev_tutorial_en.md`)

Prerequisites: Docker and the NVIDIA Container Toolkit installed (`docker run --rm --gpus all ubuntu nvidia-smi` printing the GPU is enough), driver ≥535, VRAM ≥12 GB, and the weights `<WEIGHTS>` already fetched as in section 3.

```bash
cd scripts/minicpm-ocr-jev
docker build -f serve/Dockerfile -t minicpm-ocr-jev-1-0:latest .

docker run -d --name minicpm-ocr-jev --gpus '"device=<GPU>"' \
    -p 127.0.0.1:8030:8030 \
    -v <WEIGHTS>:/weights:ro \
    minicpm-ocr-jev-1-0:latest 8030 /weights
```

On a slow network, add `--build-arg PIP_INDEX_URL=<mirror>` and `--build-arg PLAYWRIGHT_DOWNLOAD_HOST=<mirror>` to the build (section 3 has usable values).

Pass criteria: `curl -f http://127.0.0.1:8030/healthz` reports `status` as `ok`. `loading` means the weights are still being loaded and scoring returns 503; wait for it to turn `ok`.

Scoring:

```bash
curl -s http://127.0.0.1:8030/v1/rm/score -H 'Content-Type: application/json' -d '{
  "input_form": "ternary",
  "items": [
    {"case_id": "blk-001", "image": "<base64>",
     "ocr_text": "the OCR text to score", "category": "text"}
  ]
}'
```

Four endpoints: `/healthz`, `/v1/rm/score` (one score per block), `/v1/rm/score_best` (best of N candidates for one block) and `/v1/rm/score_best_batch` (best-of-N for many blocks, which is the one to use when there are many). The full field definitions are in `minicpm_ocr_jev_docker_api_en.md`; the rules to keep to when calling:

- `input_form` is fixed at `"ternary"`, and `score_best_batch` needs it again inside every item — 422 without it.
- `image` takes the base64 body of a PNG or JPEG **without** the `data:image/png;base64,` prefix; with the prefix that item comes back as `encode_error`.
- `category` is one of `text` / `formula` / `table` and **has to match what the block really is**: a formula block sent as `text` is rendered literally, which does not error but does distort the score.
- Check `verdict` before reading a score: `0.0` and `-1.0` are the fixed return values for a failed scoring, not low scores.
- When render images are already in hand, send `items[].render_image` (`render_images` for `score_best*`) and the service skips rendering.
- The number of candidates in one request is capped by `max_items` (64 by default; 400 above that), and `threshold` (0.5 by default) only affects `throughput_rate` in the summary, never any `prob_yes`.

Once it is up, check the scores with the bundled cases as in [7.3](#73-docker-path-score-the-bundled-cases) — `/healthz` returning `ok` only says the service came up.

### 1.3 SDK: picking a backend and a service shape

On the SDK path, settle two more things: **which inference backend**, and **who provides the render image**. If the user has no preference, use vLLM plus the render+score service.

There are two service shapes, split by where the render image comes from; both use the same model and the same scoring code:

| | Score service | Render+score service |
|---|---|---|
| Render image | Provided by the caller | Rendered by the service (the caller may also provide it) |
| Render environment | **Not needed** — no Chromium, Node or fonts | Needed |
| Endpoint | `/v1/score`, returns `prob_1` | `/v1/rm/score*`, returns `prob_yes`, identical to the Docker image |
| Features | Scoring only | Scoring, best-of-N within a block, batched best-of-N, with precheck |
| Start script | `sdk/start_score.sh` | `sdk/start_render_score.sh` |

The four backends differ a lot in what they cost to set up; pick by the user's constraints:

| Backend | System CUDA toolkit | Compiles | Engine environment size | Platforms | Suited to |
|---|---|---|---|---|---|
| vLLM | Not needed | No | 8.4 GB | Linux + NVIDIA only | Default choice, best throughput |
| SGLang | **Needed** | No | 9.5 GB | Linux + NVIDIA only | An existing SGLang stack |
| llama.cpp | **Needed** (Linux only) | **Yes** | 214 MB (build) | Linux + NVIDIA / macOS | Small VRAM, no torch wanted |
| Ollama | Not needed | No | None (the engine ships with Ollama) | Linux + NVIDIA / macOS | Lightest requirements, an existing Ollama |

- llama.cpp and Ollama use GGUF weights, which are **published officially and downloaded directly by default** (see 5.3) — no HF weights and no conversion environment. Convert them yourself only when the user wants different conversion settings or the weights are their own fine-tune; that needs a 4.8 GB conversion environment (CPU torch), which can be deleted afterwards.
- Ollama runs llama.cpp's own runner, so their scores share one source — **do not use one to verify the other**.
- ⭐ **On macOS (Apple Silicon) only llama.cpp and Ollama are available**: vLLM and SGLang depend on the CUDA stack and will not start on a mac, so do not suggest them. Both macOS paths go through Metal; where the commands differ from Linux is covered in 5.3 / 5.4.
- ⭐ **On macOS only run the score service**: the render+score service needs a pinned font environment, and that step depends on apt, which is not available on a mac (see 6.2).

## 2. Pre-installation checks

This section, like sections 4, 5, 6 and 8, applies to the SDK path only; the Docker path's prerequisites are in 1.2.

```bash
# Linux + NVIDIA
nvidia-smi                                                      # driver ≥535
nvidia-smi --query-compute-apps=pid,used_memory --format=csv    # find an idle GPU
df -h .                                                         # leave ≥15 GB for vLLM/SGLang

# macOS
sysctl -n machdep.cpu.brand_string    # must be Apple M series
sysctl -n hw.memsize                  # unified memory ≥16 GB
xcode-select -p                       # Command Line Tools installed
python3 -V                            # the system one is 3.9, too old; install ≥3.10 separately
df -h .
```

The VRAM floor depends on the backend: vLLM ≥12 GB, SGLang ≥16 GB, llama.cpp and Ollama ≥8 GB. On macOS that translates to ≥16 GB of unified memory.

Things the user has to supply (ask when they are not given; do not guess):

| Placeholder | Meaning |
|---|---|
| `<WEIGHTS>` | Absolute path of the Jev weights directory; download it as in section 3 when the user has no copy. **Needed by the Docker path and by SDK vLLM and SGLang** — SDK llama.cpp and Ollama download the GGUF directly by default (5.3) |
| `<GPU>` | Which GPU to use (confirm it is idle with the commands above); not applicable on macOS |

Every command below runs under `scripts/minicpm-ocr-jev/` in the repository, with the virtual environments created in `/opt/venv-*`; on macOS writing to `/opt` needs sudo, so put them under the home directory instead (`~/venv-*`) and adjust the paths that follow.

## 3. Source, weights and system packages

The deployment documents start at `cd scripts/minicpm-ocr-jev/`, which assumes the repository is already on the machine:

```bash
git clone https://github.com/OpenBMB/MiniCPM-OCR.git
cd MiniCPM-OCR/scripts/minicpm-ocr-jev
```

The weights are [MiniCPM-OCR-Jev](https://huggingface.co/openbmb/MiniCPM-OCR-Jev). **vLLM and SGLang need these HF weights**; llama.cpp and Ollama use GGUF, downloaded directly as in 5.3, so they can skip this step. Skip it as well when the user already has a copy, and take its absolute path as `<WEIGHTS>`:

```bash
python3 -m venv /opt/venv-dl && /opt/venv-dl/bin/pip install -U "huggingface_hub[cli]"
HF_ENDPOINT=https://hf-mirror.com /opt/venv-dl/bin/hf download openbmb/MiniCPM-OCR-Jev \
  --local-dir ./models/MiniCPM-OCR-Jev
```

- `<WEIGHTS>` is then `$PWD/models/MiniCPM-OCR-Jev`, and the directory should contain `config.json`, `model.safetensors`, `tokenizer.json`, `preprocessor_config.json` and `chat_template.jinja`.
- If `hf` is already available, use it directly instead of creating `/opt/venv-dl`; installing into the system Python is refused under PEP 668 (see section 9). That venv can be deleted once the download finishes.
- ModelScope: `modelscope download --model OpenBMB/MiniCPM-OCR-Jev --local_dir ./models/MiniCPM-OCR-Jev`.

System packages depend on the backend (this mirrors the "Requirements" section of each document):

```bash
# vLLM / SGLang
sudo apt-get install -y python3 python3-venv python3-pip curl gcc g++ python3-dev
# llama.cpp
sudo apt-get install -y python3 python3-venv python3-pip git curl cmake build-essential
# Ollama
sudo apt-get install -y python3 python3-venv python3-pip curl

# macOS + llama.cpp: the compiler and git come with the Command Line Tools; CMake is separate
xcode-select --install
brew install cmake

# macOS + Ollama: no system packages needed, all it takes is a Python ≥3.10
```

- `gcc`, `g++` and `python3-dev` are **runtime** dependencies: both vLLM and SGLang compile Triton extensions on the first forward pass, so do not remove them after installing.
- On a slow network, point pip at a nearby mirror first, or the 8–9 GB of engine dependencies will stall:

```bash
export PIP_INDEX_URL=https://<your-mirror>/simple
# in mainland China, for example: https://mirrors.ustc.edu.cn/pypi/simple
```

Pass criteria: `python3 -V` is ≥ 3.10 and `gcc -dumpversion` prints something (llama.cpp additionally needs `cmake --version` ≥3.14). On macOS do not check `gcc -dumpversion`; check that `xcode-select -p` prints something instead.

## 4. Probe upstream support (do this before installing anything)

**Support for this model reached upstream only recently in two of the four backends**, so confirm the version at hand has it before installing. The probes are all structural — look in the model registry, in the source, or at the startup self-check:

| Backend | What to probe | When it can be probed |
|---|---|---|
| vLLM | `Qwen3_5ForConditionalGeneration` is in the model registry | Reported automatically once `serve/setup_backend.sh` finishes; no manual probe needed |
| SGLang | `Qwen3_5VLForSequenceClassification` is in the model registry | After `sglang[all]` is installed |
| llama.cpp | `COMMON_DECISION_TYPE_MINICPM_OCR_JEV` is in the source | **After the clone, before the build** |
| Ollama | The startup self-check passes | After installing, converting the GGUF and registering the model |

```bash
# SGLang
/opt/venv-sglang/bin/python -c "
from sglang.srt.models.registry import ModelRegistry
print('Qwen3_5VLForSequenceClassification' in ModelRegistry.models)"

# llama.cpp (inside the cloned source tree)
grep -rq COMMON_DECISION_TYPE_MINICPM_OCR_JEV tools/server/ && echo supported || echo NOT
```

⚠ **Do not judge by version number, and do not trust what the engine reports about its own capabilities**:

- `ollama show` reports `decision, vision` **both green even when the runner has no support at all** — it reads the GGUF metadata, not the runner's capabilities.
- An SGLang version number tells you nothing about whether the architecture is registered.
- When a probe returns `False` / `NOT`, go to [section 8](#8-temporary-path-while-upstream-support-is-missing), and **do not delete the environment you already installed** — the temporary path reuses it.

## 5. Install and start the engine

All four engines use port 18499 (the documents' default). When several backends run on one machine, stagger the ports and change the engine address in the service layer to match.

### 5.1 vLLM (mirrors `vllm_deploy_jev_en.md` §1)

```bash
bash serve/setup_backend.sh /opt/venv-vllm
PATH=/opt/venv-vllm/bin:$PATH bash sdk/start_engine.sh <GPU> 18499 <WEIGHTS>
```

- `setup_backend.sh` checks the system packages itself; if any are missing it prints a ready-to-paste apt command and exits.
- This script is not `serve/start_vllm.sh`: the image path passes a pass-through template and assembles the prompt itself, while the SDK path sends an interleaved content list and lets the model's own template render it. Mixing them is caught by the startup self-check.

Pass criteria: the install prints `Qwen3_5ForConditionalGeneration  registered`; the startup log reaches `Application startup complete.` (the first start goes through torch.compile and CUDA graph capture, about 2 minutes).

### 5.2 SGLang (mirrors `sglang_deploy_jev_en.md` §1)

SGLang needs a full CUDA toolkit installed system-wide, **and it has to be findable** — `deep_gemm` looks for it at import time:

```bash
export CUDA_HOME=/usr/local/cuda          # or the actual path
export PATH=$CUDA_HOME/bin:$PATH

python3 -m venv /opt/venv-sglang && source /opt/venv-sglang/bin/activate
pip install "sglang[all]"
```

The `nvidia-*` packages pip pulls into the virtual environment are no substitute for the system toolkit. Once this finishes, run the SGLang probe from [section 4](#4-probe-upstream-support-do-this-before-installing-anything), then start the engine:

```bash
python -m sglang.launch_server \
  --model-path <WEIGHTS> \
  --is-embedding \
  --json-model-override-args '{"architectures": ["Qwen3_5VLForSequenceClassification"]}' \
  --port 18499
```

- `--is-embedding`: takes the pooling path; without it there is no `/classify` to call.
- `--json-model-override-args`: needed when the weights' `config.json` names a generative class — overriding it to the classification class is what makes the two value-head logits come back. It can be omitted when `config.json` already says `Qwen3_5VLForSequenceClassification`.
- Do not add `--chat-template`: SGLang applies no template, the SDK sends the fully assembled prompt string.

Pass criteria: the log reaches `The server is fired up and ready to roll!`; `curl http://127.0.0.1:18499/get_model_info` shows `architectures` as `["Qwen3_5VLForSequenceClassification"]`.

### 5.3 llama.cpp (mirrors `llamacpp_deploy_jev_en.md` §1)

Fetch the source and build it. Run the grep probe from [section 4](#4-probe-upstream-support-do-this-before-installing-anything) before building:

```bash
git clone https://github.com/ggml-org/llama.cpp.git && cd llama.cpp

# Configure; pick the line for your platform
# Linux + NVIDIA
cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
# macOS: the Metal backend is on by default, no extra switch needed
cmake -B build -DCMAKE_BUILD_TYPE=Release

cmake --build build -j --target llama-server
```

The configure log has to say `Including METAL backend` (mac) or `Including CUDA backend` (Linux); that line is what confirms the intended backend is enabled.

**Linux only**: when the CUDA toolkit lives somewhere other than `/usr/local/cuda`, register its libraries with `ldconfig` first, otherwise linking `llama-server` produces dozens of `undefined reference to cudaXxx@libcudart.so.13`:

```bash
echo /path/to/cuda/lib64 | sudo tee /etc/ld.so.conf.d/cuda.conf && sudo ldconfig
```

**Getting the GGUF — this is the default path**: both files are published officially, one for the language model and one for the `mmproj`:

```bash
HF_ENDPOINT=https://hf-mirror.com hf download openbmb/MiniCPM-OCR-Jev-gguf \
  --include "MiniCPM-OCR-Jev-F16.gguf" "mmproj-model-f16.gguf" \
  --local-dir ./models
```

- `F16` is the unquantized build (3.78 GB). When VRAM or memory is tight, swap the language model for `Q8_0` (2.01 GB) or `Q4_K_M` (1.27 GB) — the model card labels the first near-lossless and the second the smallest recommended build; there is only one `mmproj` build.
- This path needs **no** `<WEIGHTS>` and no conversion environment. The same repository is on ModelScope as `OpenBMB/MiniCPM-OCR-Jev-gguf`.

Converting it yourself is for two cases only: the user wants different conversion settings, or the weights are their own fine-tune. That needs the conversion dependencies installed separately (in their own venv — Debian/Ubuntu and others refuse to install into the system Python under PEP 668), and the language model and the vision encoder converted separately, **both from the directory with the patched `architectures`**:

```bash
python3 -m venv /opt/venv-convert && source /opt/venv-convert/bin/activate
pip install -r requirements/requirements-convert_hf_to_gguf.txt

mkdir -p ./models/MiniCPM-OCR-Jev-gguf
for f in <WEIGHTS>/*; do
  [ "$(basename "$f")" = config.json ] || ln -sf "$f" ./models/MiniCPM-OCR-Jev-gguf/
done
python - <<'EOF'
import json, os
c = json.load(open(os.environ["W"] + "/config.json"))
c["architectures"] = ["MiniCPMOCRForSequenceClassification"]
json.dump(c, open("./models/MiniCPM-OCR-Jev-gguf/config.json", "w"), indent=2, ensure_ascii=False)
EOF

python convert_hf_to_gguf.py ./models/MiniCPM-OCR-Jev-gguf \
  --outtype bf16 --outfile ./models/MiniCPM-OCR-Jev-bf16.gguf
python convert_hf_to_gguf.py ./models/MiniCPM-OCR-Jev-gguf --mmproj \
  --outtype bf16 --outfile ./models/mmproj-MiniCPM-OCR-Jev-bf16.gguf
```

(Run `export W=<WEIGHTS>` before that heredoc.) Converting `mmproj` from the conversion directory is what carries over the image downscale floor the model was trained with; otherwise small images score off. Self-converted files are named differently from the official pair, so change the start command below to match.

```bash
./build/bin/llama-server \
  -m ./models/MiniCPM-OCR-Jev-F16.gguf \
  --mmproj ./models/mmproj-model-f16.gguf \
  -ngl 99 -c 32768 --port 18499
```

Pass criteria: the startup log shows `decision model type: openbmb-minicpm-ocr-jev` and `listening on`; `curl http://127.0.0.1:18499/health` returns `{"status":"ok"}`. Same criteria on both platforms. If that `decision model type` line is **missing**, this build does not know the model — go back to [section 4](#4-probe-upstream-support-do-this-before-installing-anything). When converting yourself, also check one more thing: the conversion produces two GGUF files of 3.6 GB and 641 MB.

### 5.4 Ollama (mirrors `ollama_deploy_jev_en.md` §1)

The lightest of the four: the engine ships inside the Ollama package, there is no CUDA toolkit, nothing to compile, and llama.cpp is not needed at all. **Get the GGUF with the same `hf download` as in 5.3** (or convert it as in 5.3, and then change the two `FROM` lines below to the files you produced).

```bash
# Linux
curl -fsSL https://ollama.com/install.sh | sh
# macOS
brew install ollama

cat > Modelfile <<'EOF'
FROM ./models/MiniCPM-OCR-Jev-F16.gguf
FROM ./models/mmproj-model-f16.gguf
EOF

ollama serve &                       # 11434 by default
ollama create minicpm-ocr-jev -f Modelfile
ollama show minicpm-ocr-jev
```

The model name `minicpm-ocr-jev` has to match `model` in `sdk/backends/ollama.yaml`; rename in one place and you rename in both.

Pass criteria: **only the startup self-check can confirm this backend works** (see [section 7](#7-verification)). `ollama show` reporting `decision, vision` only says the GGUF conversion was right; it says nothing about whether the runner knows the model. Same criteria on both platforms — Ollama on macOS also runs llama.cpp plus Metal.

## 6. Install and start the service layer

Pick one of the two shapes; do not start both. Fill in the engine address with the port actually used in section 5.

### 6.1 Score service (mirrors §2 of each document)

```bash
python3 -m venv /opt/venv-score && source /opt/venv-score/bin/activate
pip install "fastapi>=0.110" "uvicorn>=0.27" "httpx>=0.27" "pydantic>=2.6" "PyYAML>=6.0" "Pillow==12.3.0"
```

```bash
PATH=/opt/venv-score/bin:$PATH bash sdk/start_score.sh 18501 http://127.0.0.1:18499
```

### 6.2 Render+score service (mirrors §3 of each document)

```bash
PIP_INDEX_URL=https://<your-mirror>/simple \
PLAYWRIGHT_DOWNLOAD_HOST=https://<your-playwright-mirror> \
    bash sdk/setup_render.sh /opt/venv-render
# in mainland China, for example:
#   PIP_INDEX_URL=https://mirrors.ustc.edu.cn/pypi/simple
#   PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright
```

It installs Node, CJK fonts, Chromium and the service dependencies, and pins the font environment down (about 2.5 minutes, 205 MB).

⚠ **Do not start this service on macOS**: installing Node and the CJK fonts and pinning the font environment all rely on `apt-get`, and those steps are skipped on a mac. The render image is model input, so a different font stack means different scores, and what you measure cannot be compared against the published values. On a mac use the score service from 6.1 and have the caller provide the render image.

```bash
PATH=/opt/venv-render/bin:$PATH bash sdk/start_render_score.sh 18500 http://127.0.0.1:18499
```

It must be started with the `/opt/venv-render` interpreter — rendering happens inside this process. For more throughput raise `RM_RENDER_BROWSERS`; do not add workers.

### 6.3 Backends other than vLLM need a backend config

```bash
JEV_BACKEND_CONFIG=sdk/backends/sglang.yaml \
PATH=/opt/venv-score/bin:$PATH bash sdk/start_score.sh 18501 http://127.0.0.1:18499
```

Replace `sglang.yaml` with `llamacpp.yaml` / `ollama.yaml`. **Without that variable the service speaks the vLLM protocol**: SGLang will connect but the scores are unusable, while llama.cpp and Ollama expose different endpoints and the service fails to start.

## 7. Verification

7.1 and 7.2 are the SDK path (they call the service layer on 18501); for the Docker path go to [7.3](#73-docker-path-score-the-bundled-cases).

### 7.1 Startup self-check

```bash
curl -s http://127.0.0.1:18501/healthz
```

Look at `status` only; `ok` means it passed. The other fields are details, and what counts as normal differs by backend:

| Backend | `prompt.source` | `forward_shape` | Note |
|---|---|---|---|
| vLLM | `engine` | `2 logits` | The prompt the engine assembled was checked field by field |
| SGLang | `client` | `2 logits` | The SDK assembles the prompt; what is checked is the string about to be sent |
| llama.cpp / Ollama | `server_template` | `2 probabilities` | The template is baked into the GGUF and cannot be read back, so the prompt is not checked |

`token_equality` being `skipped` means skipped, not failed. When `status` is not `ok`, read `prompt.notes` or `error` — it carries the engine's own words.

### 7.2 Score the bundled cases

The self-check only says the service starts; whether the scores are right is settled by the three cases under `examples/`:

```bash
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

Pass criterion: all three scores are within 0.02 of the reference. **This is the only objective test of "it is installed correctly"** — HTTP 200 is not, and neither is `/healthz`.

For the render+score service, switch to `/v1/rm/score_best` and give the body `image` plus `category` plus `candidates`; the service renders on its own. Both candidates get scored, and `best_index` should point at the `ground_truth` one.

Before reading any score, check `verdict` (the Docker-image-shaped endpoints) or `error` (`/v1/score`): `0.0` and `-1.0` are the fixed return values for a failed scoring, not low scores.

### 7.3 Docker path: score the bundled cases

Run this from `scripts/minicpm-ocr-jev/` as well, against the 8030 mapped in 1.2:

```bash
python3 - <<'EOF'
import base64, json, urllib.request
for name in ("01_text_putnam", "02_formula_putnam", "03_table_gb_standard"):
    c = json.load(open(f"examples/{name}/case.json"))
    role = c["reference_render_of"]
    text = next(x["text"] for x in c["candidates"] if x["role"] == role)
    b64 = lambda f: base64.b64encode(open(f"examples/{name}/{f}", "rb").read()).decode()
    body = {"input_form": "ternary",
            "items": [{"case_id": name, "image": b64(c["block_image"]),
                       "render_image": b64(c["reference_render"]),
                       "ocr_text": text, "category": c["category"]}]}
    req = urllib.request.Request("http://127.0.0.1:8030/v1/rm/score",
            data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req))["results"][0]
    print(f"{name:24} {r['verdict']:8} got {r['prob_yes']:.5f}  reference {c['observed_prob_yes'][role]:.5f}")
EOF
```

Pass criteria: all three `verdict`s are `scored` and all three scores are within 0.02 of the reference. This is the same test as 7.2, only the endpoint, the field name and the port differ (`/v1/rm/score`, `prob_yes`, 8030).

The call above sends `reference_render` along with the request, which is the "caller provides the render image" shape. Drop the `render_image` line to let the image render for itself and the scores should still land within 0.02 — the render environment built into the image is the reference one. For best-of-N within a block, call `/v1/rm/score_best` instead with `image` plus `category` plus `candidates`; both candidates get scored and `best_index` should point at the `ground_truth` one.

## 8. Temporary path while upstream support is missing

```
Verified on: 2026-10-28
Upstream state at the time: SGLang PR #45829 not merged into the main repository; the latest Ollama releases v0.40.11/v0.40.12 bundle llama.cpp 0.7.x, which has no support for this model
Expiry condition: once the probes in section 4 pass, this whole section can be deleted
```

⚠ What this section installs is **not the path the deployment documents promise**. Tell the user plainly that a temporary path was taken and that it should be reinstalled the official way once upstream catches up. If today's upstream versions differ from the ones recorded above, verify again before using this section.

### 8.1 SGLang: override with the PR source tree

**Keep everything `sglang[all]` installed** (sgl-kernel, flashinfer and the rest are all still used); replace only the python package:

```bash
source /opt/venv-sglang/bin/activate
pip uninstall -y sglang
cd <sglang PR source tree>/python
SGLANG_BUILD_RUST_EXTS=none pip install -e . --no-build-isolation
```

`SGLANG_BUILD_RUST_EXTS=none` is required: the build backend goes looking for `cargo` and fails outright without a Rust toolchain. Run the probe again afterwards; it should return `True`.

### 8.2 Ollama: swap the runner as a set

An Ollama release is a precompiled bundle carrying its own vendored llama.cpp. Replace the runner with what 5.3 built:

```bash
O=/usr/local/lib/ollama          # install.sh's default location
L=<llama.cpp>/build/bin
cp -a $O/llama-server $O/llama-server.stock      # back it up
ln -sfn $L/llama-server $O/
for f in $L/lib*.so*; do ln -sfn "$f" "$O/$(basename "$f")"; done
ln -sfn $L/libggml-cuda.so $O/cuda_v13/libggml-cuda.so
```

⚠ **Replacing only that binary does nothing**: the stock `llama-server` is just 15 KB, and the model support lives in shared libraries such as `libllama-server-impl.so`. With only the binary replaced it still starts and still raises the same error, which leads to the opposite conclusion — that swapping does not help.

⚠ This swap **steps over Ollama's own compatibility patches**, and why it can be stepped over has not been established; re-verify after any Ollama upgrade. Restart `ollama serve` and the service layer afterwards; the self-check should be `ok`.

## 9. Error handling

### Docker path

| Symptom | What to do |
|---|---|
| `could not select device driver "nvidia"` | The NVIDIA Container Toolkit is missing, or docker was not restarted after installing it; get the `--gpus all` probe in 1.2 to pass first |
| `/healthz` stays at `loading` and scoring returns 503 | The weights are still loading; wait, and read `docker logs minicpm-ocr-jev` for the real exception if it drags on |
| 422 | `input_form` is not `"ternary"`, or `score_best_batch` is missing the copy inside an item |
| `verdict` is `encode_error` | The base64 carries a `data:image/...;base64,` prefix, or the bytes themselves are bad |
| 400 mentioning `max_items` | One request carried more candidates than the default 64; split the batch |

### Installation

| Symptom | What to do |
|---|---|
| `missing system packages: gcc g++ python3-dev` | `setup_backend.sh`'s own check; install with the apt command it printed |
| pip runs for minutes without finishing a single package | No mirror configured, see section 3 |
| `error: externally-managed-environment` | PEP 668; the conversion dependencies go into their own venv (5.3), not into the system Python |
| `RuntimeError: cargo is required to discover the Rust extension modules` | `SGLANG_BUILD_RUST_EXTS=none` was left out when installing the SGLang PR source tree |
| `undefined reference to cudaGetLastError@libcudart.so.13` (about 60 of them) | The CUDA libraries are not registered with ldconfig, see 5.3 |

### Starting the engine

| Symptom | What to do |
|---|---|
| `AssertionError` in `deep_gemm/cuda_helpers.py: find_cuda_home` | SGLang cannot find the system CUDA toolkit; set `CUDA_HOME` (5.2) |
| `RuntimeError: Failed to find C compiler`, **with the weights already loaded** | Triton compiles on the spot; install `gcc g++ python3-dev` (section 3) |
| `ValueError: Cannot find model module. 'Qwen3_5VLForSequenceClassification' is not a registered model` | This SGLang version has no support for the model, go to 8.1 |
| The process is killed after startup, log ends with `EXIT=137` | Scroll up for the real exception; 137 only means SIGKILL |
| `failed to init decision model: unsupported decision model type` | This llama.cpp / Ollama runner does not know the model; go to 8.2 or move to llama.cpp ≥v0.8.0 |
| The llama.cpp log has no `decision model type` line | Same as above |

### Starting the service and scoring

| Symptom | What to do |
|---|---|
| `refusing to start: the engine does not assemble the prompt this checkpoint was trained on` | The self-check stopped it. Read the engine's own words in the same error — usually a wrong engine argument or an unsupported runner |
| `backend HTTP 500: llama-server process has terminated` | The engine side died; look at `ollama serve` / `llama-server`'s own log |
| Startup hangs at `Waiting for application startup.` | The self-check is calling the engine; wait, and check the engine log if it goes past two minutes |
| Every score is `0.0` or `-1.0` | Not low scores — these are the fixed return values for a failed scoring; read `verdict` / `error` |
| Scores come back but are far from the reference | Wrong `category` (a formula block sent as `text` is rendered literally); or `mmproj` was not converted from the directory with the patched `architectures` |
| Scores differ only in the third decimal | Pixel differences between the self-installed renderer and the image's renderer; the ranking is unchanged, this is normal |
| Scores do not line up after switching backends | Comparing absolute scores across backends requires aligning on one set of inputs first; Ollama and llama.cpp share a source and do not count as independent verification |

## 10. Verified versions

| Component | Version |
|---|---|
| vLLM | vLLM 0.32.0, torch 2.13.0+cu130, transformers 5.19.0, venv 8.4 GB |
| SGLang | Stable 0.5.22 has **no support for this model**; the PR #45829 source tree works, venv 9.5 GB |
| llama.cpp | Release **v0.8.0** (includes PR #30980, merged into master on 2026-10-27), build 214 MB |
| Ollama | Stock v0.40.11 has **no support for this model**; works after the runner swap |
| Docker image | Built from `serve/Dockerfile`, with the engine, the scoring service and the render environment all inside it; for the versions actually in the image, read the `scorer` and `render` fields of `/healthz` |
| Service layer | Python 3.12.3, fastapi 0.162.0, uvicorn 0.54.0, httpx 0.28.1, pydantic 2.14.1, Pillow 12.3.0, venv 59 MB |
| Render environment | playwright 1.62.0, KaTeX 0.16.47, render pipeline v8.5, venv 205 MB |
| GGUF | Official `MiniCPM-OCR-Jev-gguf` repository: `MiniCPM-OCR-Jev-F16.gguf` 3.78 GB + `mmproj-model-f16.gguf` 671 MB; equivalent in scoring to a self-converted bf16 pair (three cases, scores within 5e-5, measured on a mac through both llama.cpp and Ollama on 2026-10-29) |
| Hardware | Single RTX 5090, driver 590.48.01, CUDA 13.0.88, Ubuntu 24.04.5 (2026-10-28) |
| macOS | Apple M5 / 16 GB unified memory / macOS 26.x, Command Line Tools 26.6.0, llama.cpp v0.8.0 built from source (Metal), conversion dependencies torch 2.11.0 arm64 + transformers 4.57.6 (2026-10-29) |

## 11. Reporting rules

- Say which path was taken (Docker image or SDK) and on which port. The two paths have different render environments, so their absolute scores are not interchangeable, and only the Docker path's can be compared against the published numbers directly.
- The 5090 and the M5 are only the machines this was verified on; do not say either one is required. The floors are the numbers in section 2 (1.2 for the Docker path).
- Report only the checks that actually ran. Without 7.2 do not say the scores are right; `/healthz` returning `ok` only says the service came up.
- When the temporary path in section 8 was taken, say so explicitly and spell out how it differs from the documented path.
- Do not treat the four backends' scores as independent verification of one another, least of all Ollama and llama.cpp — they run the same binary.
- The scores carry no threshold and no label, and they are not calibrated to an absolute quality scale: comparing them within one set of inputs is what is meaningful, and a single absolute score does not translate into a level of quality. State that boundary alongside the numbers.
