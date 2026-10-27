# MiniCPM-OCR Jev local deployment

A vision-language reward model that judges whether a piece of OCR output actually
matches the document image it came from. Given a document block and several candidate
transcriptions, it scores each one, so you can pick the best, filter the bad, or rank
several OCR engines against each other.

It is a 2-class sequence-classification head (a "value head") on a Qwen3.5-VL 2B
backbone. The output is `prob_yes`: the probability that a candidate is consistent
with the original image.

What makes this model different from a text-similarity metric is that **it does not
read the candidate as text alone**. It looks at two images:

```
    image 1  the original document block
    image 2  the candidate text, rendered back into an image
    + text   the candidate text itself
```

Three inputs, hence *ternary*. Scoring therefore has three stages, and this repo ships
all of them:

```
    precheck  →  render  →  forward
    (Node +      (Chromium +   (vLLM)
     KaTeX)       KaTeX)
```

Rendering is what lets the model catch errors that text comparison misses: a formula
written with different LaTeX but identical meaning should score *high*, while a
transcription that keeps every word but scrambles the layout should score *low*. Both
of those are in [`examples/`](examples/).

The same model appears under three spellings, one per place it has to be named:
weights `openbmb/MiniCPM-OCR-1.0-Jev` on the Hub, the container image
`minicpm-ocr-jev-1-0` this repo builds, and `minicpm-ocr-jev` as the model id the
service serves it under.

---

## Contents

```
infer_vllm.py            end-to-end scoring: precheck → render → forward
rm_render.py             precheck + render only, if you just want the images
requirements.txt
renderer/
  setup_renderer.sh      install Chromium; check Node, fonts and the font pin
  check_renderer.py      compare your renders against the bundled references
  render_triple_rm_labels.py   render driver
  render_module/         HTML generation and page layout
  precheck/              KaTeX parse screen (Node)
  assets/katex-0.16.47/  pinned KaTeX, with its own fonts
serve/
  setup_backend.sh       install vLLM into its own venv, and check it can serve this
  start_vllm.sh          the forward pass, as a stock `vllm serve`
  app.py                 the HTTP service: precheck, render, call the backend
  start_app.sh
  start_all.sh           both halves together, as one container's entrypoint
  render_pool.py         browsers kept open for the life of the process
  chat_template_passthrough.jinja
  requirements-serve.txt
  Dockerfile             both halves in one image, two processes, no weights
  check_server.py        is the backend reproducing our prompt and scores?
  check_service.py       does the service honour its contract?
  check_render_parity.py does the pool render the same bytes as a fresh browser?
  bench_service.py       throughput and the stage breakdown, under load
  bench_backend.py       the forward pass alone — where the GPU flattens out
  bench_render.py        the renderer alone — how it scales with workers
examples/
  01_text_putnam/        layout scrambled but wording preserved
  02_formula_putnam/     same formula, very different LaTeX
  03_table_gb_standard/  unit and character errors inside a table
```

---

## Install

The renderer and the forward pass go into **two separate virtual environments**. That
is deliberate: the renderer pins Pillow to the exact version it was calibrated on,
while vLLM asks only for `pillow>=12.3.0`. Share one environment and a later
`pip install -U vllm` moves Pillow forward and changes every score — silently, with
no error anywhere. Two environments make that impossible instead of merely
discouraged.

### 0. System packages

```bash
sudo apt-get install -y python3 python3-pip python3-venv python3-dev \
                        gcc g++ nodejs fonts-noto-cjk fontconfig ca-certificates curl
```

`gcc` and `python3-dev` are needed **at run time, on every cold start** — not just to
install. Triton compiles a small CPython extension on the first forward pass, so
without them the backend loads the weights, runs for two minutes, and then dies on a
bare `CalledProcessError` whose real cause (`fatal error: Python.h: No such file`) is
sixty lines further up. `nodejs` drives the KaTeX precheck; `fonts-noto-cjk` is what
makes Chinese render as text rather than empty boxes. Both setup scripts below check
for all of this and name what is missing.

If pypi.org is slow from where you are, point pip at a nearer mirror first. This
install pulls vLLM, torch and a dozen CUDA wheels — several gigabytes — and the
difference is minutes versus hours:

```bash
export PIP_INDEX_URL=https://<your-nearest-mirror>/simple
```

Playwright downloads its browser from its own CDN, which `PIP_INDEX_URL` does not
cover, so set that separately or step 1 will sit for an hour on a 180 MB file:

```bash
export PLAYWRIGHT_DOWNLOAD_HOST=https://<your-nearest-mirror>
```

Both are plain mirrors of the same artefacts; neither changes what gets installed.
Measured from one machine in China: pypi.org 19 KB/s against a local mirror's
15 MB/s, and Playwright's CDN 28 KB/s against a local mirror's 11 MB/s.

### 1. The renderer

```bash
git clone <this repo>
cd <this repo>
python3 -m venv .venv-render && . .venv-render/bin/activate
bash renderer/setup_renderer.sh
```

This installs the Python packages, downloads the pinned Chromium through Playwright,
and then **checks** two things it cannot install for you: Node.js (needed by the
precheck stage) and a CJK font (needed to render Chinese at all). It tells you exactly
what to install if either is missing.

The virtualenv is not optional on Debian 12 / Ubuntu 23.04 and newer: their system
Python is marked externally managed (PEP 668) and pip refuses to install into it. The
script stops with that instruction rather than letting pip suggest
`--break-system-packages`, which would push the renderer's Pillow pin onto the system
Python for every other program on the machine.

**Then pin the font environment.** The step above installs Chromium through
Playwright's `--with-deps`, which also drags in several fonts of its own — and
fontconfig prefers some of them over the faces this renderer's CSS actually names.
Rendered text is model input here, so a different face is a different score. Four
commands fix the face set and the rasteriser to the ones the reference deployment
uses:

```bash
sudo apt-get install -y fonts-droid-fallback
sudo apt-get purge -y fonts-wqy-zenhei fonts-unifont fonts-ipafont-gothic
sudo rm -f /etc/fonts/conf.d/10-sub-pixel-rgb.conf
sudo fc-cache -f
```

`fonts-droid-fallback` supplies DroidSansFallbackFull, one of the three faces the CSS
stack names (the other two come from `fonts-noto-cjk` in §0). The three purged
packages are never named by the stack, but they outrank the named faces in
fontconfig's substitution for characters Noto does not cover. The removed config turns
on RGB sub-pixel rendering, which tints glyph edges per channel — same shapes,
different pixels.

Run these **after** `setup_renderer.sh`, never before: `--with-deps` would reinstall
what you just purged. On a distro without these package names the requirement is the
same — the three named faces present, nothing fontconfig prefers over them, sub-pixel
rendering off. "Matching the reference renderer" below measures what skipping this
costs, which is less than you might expect for some uses and not negligible for
others.

Then verify the renderer reproduces the bundled reference images:

```bash
python3 renderer/check_renderer.py
```

See [Matching the reference renderer](#matching-the-reference-renderer) for how to
read the result.

### 2. vLLM

```bash
bash serve/setup_backend.sh .venv-vllm
```

That creates a second virtualenv, installs vLLM from PyPI, and then checks the thing
that actually matters: that this build registers `Qwen3_5ForConditionalGeneration` and
can therefore serve the model.

**A second environment, not the renderer's.** This is a requirement, not tidiness.
vLLM requires only `pillow>=12.3.0`, while the renderer pins the exact version —
because Pillow decides the pixels the model is scored on. Install both into one
environment and a single later `pip install -U vllm` moves Pillow to the next major
version, changes every score, and reports no error at all. Two environments make that
impossible rather than unlikely. If you then start the service from this environment,
tell it where the renderer lives with `RM_RENDER_PYTHON` (see "Tuning").

vLLM itself is **not pinned** — the reward model is an
ordinary 2-class sequence classifier on a Qwen3.5-VL backbone, so any build with that
architecture and vLLM's `runner="pooling"` + `convert="classify"` path will serve it.

Verified combinations:

| | built from upstream (earlier) | plain `pip install vllm` (what we now run) |
|---|---|---|
| vLLM | `0.1.dev21951+g5ff3bbfb0` | **`0.32.0`** (PyPI wheel) |
| torch | `2.13.0+cu130` | `2.13.0+cu130` |
| transformers | `5.17.0` | `5.19.0` |

Scored against each other on identical images and identical prompt bytes, the six
bundled candidates agree to within 6e-4, except the table ground-truth candidate
(4.7e-3) — which is the one example whose absolute score is already known to be
unreliable, see [Reading the scores](#reading-the-scores). Candidate ordering is
identical. Earlier revisions of this document told you to build from commit
`5ff3bbfb0`; that is no longer necessary and the release is the better choice.

### 3. Weights

```bash
huggingface-cli download openbmb/MiniCPM-OCR-1.0-Jev --local-dir ./weights
```

Then pass `--model ./weights`.

<https://huggingface.co/openbmb/MiniCPM-OCR-1.0-Jev>

Any other checkpoint works too, as long as it is a 2-class sequence-classification
model on a Qwen3.5-VL backbone: point `--model` at a directory holding
`config.json` and the safetensors shards. Note that the scores a different
checkpoint produces are its own — the prompt below is part of *this* model, and
the reference scores in `examples/` are too.

---

## Quickstart

Score the bundled examples:

```bash
python3 infer_vllm.py --model ./weights --examples
```

Score your own block:

```bash
python3 infer_vllm.py --model ./weights \
    --image my_block.png --category text \
    --candidate "first transcription" \
    --candidate "second transcription"
```

Score a batch — one block per line, several candidates each:

```bash
python3 infer_vllm.py --model ./weights --input-jsonl blocks.jsonl
```

```json
{"case_id": "p1_b3", "image_path": "crops/p1_b3.png", "category": "table", "candidates": ["<table>…</table>", "<table>…</table>"]}
```

From Python:

```python
from rm_render import Candidate
from infer_vllm import RMScorer

scorer = RMScorer("./weights")          # loads once, reuse it
results = scorer.score([
    Candidate(case_id="b1#0", image_path="crops/b1.png", text="…", category="text"),
    Candidate(case_id="b1#1", image_path="crops/b1.png", text="…", category="text"),
])
for r in results:
    print(r.case_id, r.prob_yes, r.verdict)
```

Loading the engine takes a few minutes (weights, graph capture, multi-modal warmup),
so build one `RMScorer` and keep it alive. `vllm.LLM` batches internally: hand it all
your prompts at once rather than calling it in a loop.

If you only want the rendered images, skip the model entirely:

```bash
python3 rm_render.py --image my_block.png --candidate "…" --out-dir ./renders
```

---

## Running it as a service

Everything above loads the model into your own process. To serve it over HTTP
instead, run the two halves separately:

```
    your client ──> serve/app.py ────HTTP────> vllm serve
                      precheck                  forward pass
                      render
```

The split is not ceremony. Scoring one candidate costs about 0.2s of precheck,
0.9s of rendering and 0.1s of forward pass — measured, like every figure in this
document, on the machine named under "Where the ceiling is" — so nine tenths of
the work is a browser and one tenth is the GPU. In one process they compete for one
interpreter, and the only way to add rendering capacity is to add GPUs. Apart,
`app.py` is stateless and you can run several against one backend, while vLLM's
own scheduler — continuous batching, prefix caching — handles the GPU side
without any engine code in this repo.

A second consequence: because the backend batches across HTTP requests,
candidates from unrelated requests end up in the same GPU batch on their own.

### Start the backend

```bash
bash serve/start_vllm.sh 0 8026 ./weights      # GPU index, port, checkpoint
```

Three environment variables adjust it, and none of them are arguments: `GPU_MEM_UTIL`
(default 0.80 — the fraction of VRAM vLLM reserves; lower it to share the card),
`MAX_MODEL_LEN` (16384) and `SERVED_NAME` (`minicpm-ocr-jev`, the id the backend
answers to). The service asks the backend for that last one rather than assuming it,
so changing it needs no matching change in `app.py`.

This is a stock `vllm serve` in classification mode. The one non-obvious flag is
`--chat-template serve/chat_template_passthrough.jinja`: the `/classify` endpoint
accepts images only in the chat form, and the chat form always runs a template,
so the template here is one that hands our prompt back unchanged rather than
assembling one. The prompt bytes stay where they belong, in `build_prompt()`
under its fingerprint check. See [The prompt is part of the
model](#the-prompt-is-part-of-the-model).

### Start the service

```bash
python3 -m pip install -r serve/requirements-serve.txt
bash serve/start_app.sh 8030 http://127.0.0.1:8026
```

It answers 503 until the backend is up, so either half can be restarted without
the other.

### Or both at once

```bash
bash serve/start_all.sh 8030 ./weights         # app port, checkpoint
```

This starts the backend, waits for it to answer — loading weights and capturing
CUDA graphs takes a few minutes, so it asks rather than sleeps — then starts the
service, and exits if either half dies afterwards. That last part is the point: a
container whose backend has died but whose HTTP layer still answers, correctly,
with 503 forever, looks alive to every probe except a caller reading the response
body. It is also the entrypoint of the image described in "As images".

Two environments need naming here, and `start_all.sh` reads them from
`VLLM_PYTHON_BIN` and `RENDER_PYTHON_BIN`; the defaults are the paths the
container uses. Running it outside a container, set both.

### Endpoints

| | |
|---|---|
| `GET /healthz` | readiness, plus the identity of everything that decides a score: backend model, prompt fingerprint, renderer version |
| `POST /v1/rm/score` | score a batch of candidates; returns per-item scores and a summary with the throughput rate |
| `POST /v1/rm/score_best` | N candidates for one block; returns the best one |
| `POST /v1/rm/score_best_batch` | several blocks in one request |

```bash
curl -s localhost:8030/v1/rm/score_best -H 'Content-Type: application/json' -d '{
  "input_form": "ternary",
  "image": "'"$(base64 -w0 examples/01_text_putnam/block.png)"'",
  "candidates": ["first transcription", "second transcription"],
  "category": "text"
}'
```

Supply `render_image` (or `render_images`) if you have already rendered the
candidates; the service then skips precheck and rendering entirely.

Read `verdict` before `prob_yes`. Items that never reached the model carry a
sentinel score — `0.0` when the candidate was judged unusable, `-1.0` when we
could not find out — so a caller that ignores `verdict` degrades safely, but
reads a number that is not a probability.

### Checking it

```bash
python3 serve/check_server.py  --base-url http://127.0.0.1:8026   # backend: prompt and scores
python3 serve/check_service.py --base-url http://127.0.0.1:8030   # service: the contract
python3 serve/check_render_parity.py                              # pool renders == fresh browser
python3 serve/bench_service.py --base-url http://127.0.0.1:8030   # throughput and stage split
```

### Tuning

The service keeps Chromium open rather than starting one per batch, which
removes 1.2s from every request on that same machine. The defaults are already the fast
configuration; this section is for when they are not right for your machine.

| variable | default | what it changes |
|---|---|---|
| `RM_WORKERS` | cores ÷ 8, capped at 16 | uvicorn worker processes. **The throughput knob** — see below. Set it explicitly inside a CPU-limited container, where `nproc` reports the host's cores rather than your share. |
| `RM_RENDER_BROWSERS` | 2 | Chromiums per worker. Keep it small and add workers instead. |
| `RM_BROWSER_CONCURRENCY` | 8 | pages rendering at once inside one browser. The per-request latency knob: a request with twenty candidates renders them this many at a time. |
| `RM_FORWARD_CONCURRENCY` | 32 | in-flight requests to the backend. Rarely the limit; the GPU side saturates around 16 and queues past it. |
| `RM_RENDER_MODE` | `persistent` | `subprocess` starts a fresh browser per batch. A fallback for environments where the pool will not start, not a tuning choice. |
| `RM_VLLM_MODEL` | unset — ask the backend | the model id sent to the backend. Unset, the service reads it from the backend's `/v1/models`, so the two halves cannot disagree. Set it only when the backend serves more than one model. |
| `RM_RENDER_PYTHON` | unset — use `app.py`'s own interpreter | which interpreter runs the render subprocess. Needed when the renderer and vLLM are installed in *different* environments — see below. |

**On `RM_RENDER_PYTHON`.** The renderer draws each candidate in a subprocess, and by
default that subprocess is started with the same interpreter that runs `app.py`. That
is right only when the renderer's packages are installed there. Two common cases
where they are not:

- **Two environments on purpose.** §1 and §2 install the renderer and vLLM
  separately, and §2 explains why that separation is load-bearing rather than tidy:
  vLLM requires only `pillow>=12.3.0` while the renderer pins the exact version that
  decides its pixels, so one `pip install -U vllm` in a shared environment moves
  Pillow and silently changes every score. If you start `app.py` from the vLLM
  environment, point `RM_RENDER_PYTHON` at the renderer's
  (`/path/to/.venv-render/bin/python`). The container built by `serve/Dockerfile`
  handles this through `PATH` instead — see `start_all.sh`.
- **A wrapper script.** Where you cannot install system libraries, the same variable
  takes an interpreter wrapper that sets `LD_LIBRARY_PATH` for the render subprocess
  alone — see Troubleshooting.

The command-line tools take the same thing as `--render-python`
(`infer_vllm.py`, `rm_render.py`, `renderer/check_renderer.py`). Get it wrong and the
failure is loud and immediate — the subprocess dies on `ModuleNotFoundError` for
`playwright` — so this is not a silent-wrong-answer risk, unlike the Pillow version
it exists to protect.

Workers rather than browsers, because every browser a process owns is driven
over one Playwright connection by one asyncio loop, and rendered screenshots
come back through it. That pipe saturates well before the browsers do. Measured
on 128 cores, four candidates per request, 32-way concurrency:

```
    1 worker  x 8 browsers     11.5 candidates/s   p50 5.5s
    8 workers x 2 browsers     45.5 candidates/s   p50 2.5s
```

Sixteen Chromiums in the second row against eight in the first, and it is four
times the throughput at half the latency. Add workers first.

### Where the ceiling is

Both halves were measured separately, because a single end-to-end number cannot
tell you which one to spend money on. On one RTX 5090 and 128 cores, four
candidates per request:

```
    backend  (bench_backend.py)    52 candidates/s, flat from ~32-way concurrency
    renderer (bench_render.py)     35 candidates/s at  4 workers
                                   80 candidates/s at  8 workers
                                  142 candidates/s at 16 workers, still linear
    end to end (bench_service.py)  56 candidates/s at the defaults, 64-way, p50 3.2s
                                   32 candidates/s at the defaults, 16-way, p50 1.8s
                                  2.7 candidates/s for a lone request,   p50 1.4s
```

The renderer scales with cores and had not bent at 32 Chromiums; the GPU is flat
by 32-way concurrency and stays flat to 128. **So the ceiling is the GPU, and the
renderer's job is to stay ahead of it** — which at the default 16 workers it
does, the whole chain landing at or above what the backend measured alone.

That is what the defaults aim at, and it also says what to do when it is too
slow. More renderer capacity — workers, or another machine running `app.py`
against the same backend — helps only while the renderer is behind the GPU, and
`stage_sec` on any `score_best` response says whether it is. Past that, another
GPU is the only thing that moves the number.

Two cautions about these figures. The backend's 52 is a floor, not a ceiling:
`bench_backend.py` makes every image unique, so nothing is ever cached, while
real traffic sends one original image with several candidates and the backend
caches its encoding — end to end at 96-way the chain reached 60 candidates/s,
above the "ceiling", for exactly that reason. And throughput past 64-way buys
little while costing a lot of latency (p50 3.6s to 5.7s), so the useful operating
range is narrower than the peak suggests.

### As images

`serve/Dockerfile` builds **one image holding both halves** — `vllm serve` for the
forward pass, and the renderer, precheck and HTTP layer in front of it. It carries
CUDA wheels, Chromium and CJK fonts, so it is not small (about 24 GB). What it does
not carry is the weights: the checkpoint is a run-time argument, so one image serves
any compatible checkpoint and the build context stays small.

```bash
docker build -f serve/Dockerfile -t minicpm-ocr-jev-1-0:latest .

docker run -d --name minicpm-ocr-jev --gpus '"device=0"' \
    -p 127.0.0.1:8030:8030 \
    -v /path/to/weights:/weights:ro \
    minicpm-ocr-jev-1-0:latest 8030 /weights
```

Behind a slow link, pass `--build-arg PIP_INDEX_URL=…` and
`--build-arg PLAYWRIGHT_DOWNLOAD_HOST=…` — see §0 above; without them the build
takes hours rather than minutes.

Two things about this image are deliberate, and both are worth knowing before you
modify it.

**It starts from a bare `ubuntu:24.04` and installs through this material's own
scripts** — the same commands §0 through §2 give a reader with a fresh machine. So
if the image builds, the documented install works; there is no second, image-only
path that can drift out of step with these instructions.

**The two halves stay two processes.** `start_all.sh` runs them side by side and
exits if either dies. One container is about giving callers one address, not about
merging the two workloads: a browser pool and a vLLM engine in one Python process
share one asyncio loop, and that loop saturates at roughly a quarter of the
throughput — measured on one machine, four candidates per request, same GPU and
checkpoint, 13.0 candidates/s against 54.3. So: one container if you need one
address, never one process.

If you do want the renderer to scale on its own, you do not need a second image for
it — run `start_app.sh` on another machine against this one's backend, as
"Where the ceiling is" describes.

---

## Input requirements

**Category.** Every block is `text`, `formula`, or `table`. The category selects the
render mode, and getting it wrong quietly ruins the score — a formula sent as `text`
renders as literal LaTeX source rather than typeset math, and will not match the
original image.

**Tables must be HTML.** The renderer accepts `<table>…</table>`. If your OCR engine
emits some other table markup, convert it before scoring; anything unrecognised is
rendered as literal text.

**The original image must be a readable file on disk.** The renderer derives the
render width from the original image's width, so it reads the file, not just its
pixels-in-memory.

**Formula blocks render at a higher device scale factor** (3.0, versus 1.0 for text
and tables). This is why a formula's rendered image comes out much larger than its
source crop — that is expected, not a bug.

---

## The prompt is part of the model

The checkpoint was trained with one exact prompt. The wording, the whitespace, and the
order of the two images are all fixed:

```
<|im_start|>user
{image}
OCR文本：
{candidate text}
{image}
第一张图是原图，第二张图是上述 OCR 文本渲染得到的图片。
请判断该 OCR 文本及其对应渲染图是否与原图内容一致。
这是一个二分类任务：一致标为 1，不一致标为 0。<|im_end|>
<|im_start|>assistant
<think>

</think>

```

The first image is the original, the second is the render. Swapping them, translating
the instruction, or adding a system message changes what the scores mean.

Two parts of that look like padding and are not:

**The newline after each image placeholder.** Dropping it is the easiest way to get
this wrong, because assembling the prompt through a chat template's content list
renders the placeholder without one.

**The empty assistant turn at the end**, including the empty `<think>` block. The
model was trained as a sequence classifier, where the training framework appends that
turn; vLLM's classify path pools the **last** token, so the value head reads the hidden
state of the final newline inside it. Cut the turn off and you are pooling a position
the model never saw pooled during training. It still returns plausible-looking
probabilities, which is exactly what makes this mistake hard to catch.

`infer_vllm.py` fingerprints the template at import time and refuses to run if it has
been edited (`PROMPT_TEMPLATE_MD5`). That guard exists because a modified prompt does
not fail — it silently produces numbers that look fine and are comparable to nothing.

---

## Reading the scores

`prob_yes` is `softmax(logits)[1]`, between 0 and 1. Higher means more consistent with
the original image. Each candidate's score is computed independently, so candidates
within a block do not compete and scores do not sum to 1.

Every result also carries a `verdict`:

| verdict | `prob_yes` | meaning |
|---|---|---|
| `scored` | model output | reached the model normally |
| `precheck_reject` | `0.0` | KaTeX could not parse the candidate's LaTeX |
| `render_error` | `0.0` | the candidate could not be rendered |
| `missing_original_image` | `0.0` | the block image was unreadable |

Rejected candidates are assigned `0.0` rather than dropped: a transcription whose LaTeX
does not even parse is not a plausible reading of the page, so treating it as "wrong"
is the useful behaviour. If you would rather see those cases scored anyway, run with
`--no-precheck` (which also removes the Node dependency).

A `scored` result can still carry `katex_errors`. That means the page rendered, but
with an error message where the formula should be — the model sees that error text and
will score it as wrong. The field is there so you can tell this apart from a genuine
low score.

**Scores are not bitwise reproducible.** vLLM batches requests continuously, so the
same candidate may be computed alongside different neighbours from one run to the next
and differ in the last few decimal places. Practically:

- compare rankings within a block, not absolute values across runs
- keep one engine instance for a whole experiment
- do not hard-code a threshold calibrated on a single run

---

## Matching the reference renderer

The model learned what "correct" looks like from images produced by one specific
renderer. The closer your renders are to that renderer, the closer your scores are to
the ones the model was trained to produce.

Three things are pinned in this repo and need no attention from you:

| | | |
|---|---|---|
| KaTeX | 0.16.47 | bundled in `renderer/assets/`, ships its own math fonts |
| Chromium | pinned by `playwright==1.62.0` | pinning Playwright is how the browser gets pinned |
| Render pipeline | v8.5 | the code in `renderer/`, including the per-category scale factor |

A fourth thing is pinned, but not by the repo — by you, in §1: **body-text fonts come
from your operating system**. KaTeX bundles its own fonts, so formulas are reproducible
anywhere. Latin and especially CJK body text is drawn with whatever faces your OS
provides, and different font builds produce different pixels. §1's four font commands
are what hold that fixed on Debian and Ubuntu; skip them, or run a distro where those
package names do not exist, and this is the part of the pipeline that drifts.

`renderer/check_renderer.py` measures this for you. It renders the bundled examples and
compares against the reference PNGs shipped beside them:

- `identical` — byte-for-byte equal.
- `close` — a few percent of pixels differ. Normal: anti-aliasing and hinting differ
  between builds of the same font.
- `drifted` — noticeably different, layout still intact. Expected when your fonts or
  browser build differ from the reference environment.
- `different` — large differences at nearly the same size. Almost always a missing
  font: text is falling back to another face, or drawing as empty boxes.
- `mismatched` — the geometry does not match. Something structural: check that KaTeX
  under `renderer/assets/` is intact and that Playwright is pinned.

Only the last two are failures. Some drift is unavoidable, and the bundled references
make that concrete. They were produced by this same pipeline version, but earlier and
on another machine, with an older Chromium build. Re-rendering them under the pinned
environment gives:

| example | result |
|---|---|
| formula | `identical`, byte for byte |
| table | `close` — 2.3% of pixels differ |
| text | `drifted` — 10px narrower, which shifts the line and surfaces as 10% of pixels |

Two things are worth knowing about those numbers, because both were measured rather
than assumed.

**The text drift is not local to one machine.** The same 10px narrower render came out
of two unrelated environments — a purpose-built image and a bare Ubuntu container that
installed everything from scratch. Two independent environments agreeing on the same
output points at the references, not at the local setup: they predate the pinned
Chromium. So this particular drift is the pin doing its job, and you should expect to
reproduce it too.

**The font set changes which candidate wins; it does not change how well the model
separates good from bad.** These are two different questions and they have two
different answers, so both are worth stating. Pixel-wise the effect is small: swapping
the font set entirely — from whatever Playwright's `--with-deps` pulls in, to the face
set §1 pins — moved the Chinese table example by less than half a percent of pixels.
Score-wise it is small but not nothing: across 200 blocks with four candidates each,
the same swap moved `prob_yes` by a mean of 0.017 and changed the **top-ranked
candidate on 16.5% of blocks**, against a 1% floor from re-running one identical
container. And yet ranking quality is untouched: on a held-out set of 2,267 blocks,
AUROC ×100 came out 93.7 with the pinned fonts and 93.8 without — a paired difference
of +0.08 points with a bootstrap interval of [−0.07, +0.23] points (computed before
rounding), i.e. indistinguishable,
and measured tightly enough to mean "no difference" rather than "no power".

The practical reading: if you are **measuring** the model, the font set is not what
decides your number and you can skip §1's font step. If you are using the model to
**pick** the best of several OCR outputs and want the same picks as the reference
deployment, pin it — a sixth of close blocks go the other way otherwise. With *no* CJK
font at all it is a different story again: text renders as empty boxes and the score is
meaningless.

Formulas are the exception to all of this: they came out byte-identical in every
environment tested, because KaTeX carries its own fonts. If a *formula* example reports
worse than `close`, suspect your KaTeX or browser pin rather than your fonts.

If `fc-list :lang=zh | wc -l` reports 0, install a CJK font before anything else —
any of them will do:

```bash
sudo apt-get install fonts-noto-cjk      # Debian/Ubuntu
sudo dnf install google-noto-sans-cjk-fonts   # Fedora
```

Two stages run as subprocesses rather than in-process, on purpose: that is what keeps
the rendered bytes identical to the pipeline the model was trained against.
Reimplementing either stage would change the pixels, and therefore the scores.

---

## Examples

Each directory in [`examples/`](examples/) holds a document block, two candidate
transcriptions with their labels, and the reference render of one of them.

Running `python3 infer_vllm.py --model ./weights --examples` on the reference setup
produced these scores, which your run should land near:

| | reference transcription | OCR output | what it shows |
|---|---|---|---|
| `01_text_putnam` | 0.995 | 0.007 | The OCR output keeps nearly every token but merges list items (a) and (b) and re-emits the content out of order. Order-insensitive text metrics score this highly; the rendered image makes it obvious. |
| `02_formula_putnam` | 0.968 | 0.966 | Both candidates are labelled consistent despite very different LaTeX — `$$…$$` vs `\[…\]`, `'` vs `\prime`, extra spacing. Rendering collapses the difference; string comparison would not. |
| `03_table_gb_standard` | **0.041** | 0.001 | Three real OCR errors in one table: the unit `s` read as `a` in three cells, 电压切断 read as 电压倒落, and a rebuilt row structure. |

The third row is the one worth sitting with. Its reference transcription is faithful —
it matches the block — and still scores 0.04. The *ranking* is right, by a factor of 35,
but the absolute number does not mean "this transcription is wrong". If you were
filtering on `prob_yes > 0.5`, you would throw away a correct transcription here.

We have not established why. The renderer lays tables out at a fixed width, so a small
source crop and its render differ considerably in scale, which is a plausible cause
but not a demonstrated one. Either way it is the concrete reason for the advice above:
**compare candidates against each other, not against a threshold.**

Only the OCR candidate in each example carries a label from the source dataset. The
reference transcription is the dataset's ground-truth text, which that dataset does
not itself label or score — so do not read it as "the answer the model should return
1.0 for".

The document blocks come from [OmniDocBench](https://github.com/opendatalab/OmniDocBench)
v1.6 — specifically pages from the Putnam Competition archive and from a published
Chinese national standard. They are included to make the examples runnable; the
identity of the OCR engine that produced each erroneous candidate is withheld, since
the point is the error pattern, not the engine.

---

## Troubleshooting

**`libgbm.so.1: cannot open shared object file`** (or another missing library at
browser launch). Chromium downloaded, but its system libraries did not. This is the
most common first-run failure:

```bash
python3 -m playwright install --with-deps chromium
```

If you cannot install system packages — a shared cluster, no root — put the missing
libraries somewhere you control and pass an interpreter wrapper that sets
`LD_LIBRARY_PATH` for the render subprocess only:

```bash
python3 infer_vllm.py --render-python /path/to/wrapper.sh ...
```

Under the service, the same wrapper goes in `RM_RENDER_PYTHON` instead — see
"Tuning", which also covers the other reason to set it: a renderer and a vLLM
installed in two different environments.

Setting `LD_LIBRARY_PATH` globally instead is a bad idea: it also lands in front of
the loader path for the inference process.

**Rendered images are blank or full of boxes.** Missing fonts. Run
`renderer/check_renderer.py`; if it reports `different` or `mismatched`, start with
`fc-list :lang=zh | wc -l`.

**`node not found`.** The precheck stage needs Node; it has been tested on Node 12,
18 and 22, so your distribution's default is almost certainly fine. Install it, or
run with `--no-precheck` and accept that unparsable candidates get scored instead of
rejected.

**Engine fails to load with an out-of-memory error.** Lower `GPU_MEM_UTIL`, which
`start_vllm.sh` passes to vLLM as `--gpu-memory-utilization` and defaults to **0.80**.
The engine reserves that fraction of VRAM at startup, so another process on the same
GPU will collide with it: `GPU_MEM_UTIL=0.6 bash serve/start_vllm.sh 0 8026 ./weights`.

**`expected 2 class logits from the value head`.** The checkpoint is not a 2-class
sequence-classification model, or vLLM loaded it in a different mode. Check that your
build supports `runner="pooling"` with `convert="classify"`.

**Every candidate scores near 0.** Check the category first — a formula or table scored
as `text` renders as literal markup and will not match anything.
