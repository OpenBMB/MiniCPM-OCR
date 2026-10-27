# Local deployment without our image

`sdk/` is the second way to run this model. The first is the published image,
built from `serve/`, which carries a browser, a font set and a pinned Chromium so
that it reproduces the reference scores byte for byte. This one installs onto a
host you already have.

The trade is explicit: **you get your own renderer, and your own renderer draws
slightly different pixels.** Rendered text is model input here, so different
pixels mean different scores. On the machine this was built on, the three bundled
examples came out one byte-identical, one within 2.3% of pixels, one within
10.2% — and the end-to-end scores landed within 0.009 of the image's, with the
best candidate unchanged in all three blocks. Rankings are what this model is
for; the third decimal place is not promised. Run `renderer/check_renderer.py`
after installing and quote the number it gives you.

Use the image when you need the published numbers. Use this when you need the
model on a host of your own.

## Layers

```
render+score   sdk/app.py       original image + candidate text  -> render -> prob_yes
score          sdk/jev_score/   original + rendered image + text -> prob_1
engine         vllm serve       logits
```

Pick the layer by what you already have:

* **Renders made elsewhere, or no browser on the host** — run the engine and the
  score service. It needs `sdk/requirements-score.txt` and nothing else: no
  Chromium, no Node, no fonts.
* **Text in, score out** — run the engine and the render+score service. It
  imports the score layer in its own process; there is no socket between them,
  and you do not start the score service separately.

The score layer returns `prob_1` and only `prob_1`: no threshold, no label, no
logits. A probability is comparable across runs, a label is a probability plus
somebody's threshold, and a threshold shipped inside a library ends up applied to
runs it was never calibrated on. The render+score service keeps the published
field name `prob_yes` and the same endpoints as the image, so callers move
between the two without edits.

## Install

Two virtual environments, and that is a requirement rather than tidiness: the
renderer pins `Pillow==12.3.0` because that version decides what the rendered
image looks like, while vLLM asks only for `pillow>=12.3.0`. In one shared
environment a later `pip install -U vllm` moves Pillow forward and changes every
score, silently and with no error.

```bash
# 1. the forward pass
bash serve/setup_backend.sh /opt/venv-vllm

# 2. the renderer -- only if you want render+score
bash sdk/setup_render.sh /opt/venv-render
```

Behind a slow link, set both mirrors. `PLAYWRIGHT_DOWNLOAD_HOST` is not covered
by `PIP_INDEX_URL`, and Playwright's own CDN is where this install usually
stalls:

```bash
PIP_INDEX_URL=https://<mirror>/simple \
PLAYWRIGHT_DOWNLOAD_HOST=https://<mirror>/playwright \
    bash sdk/setup_render.sh /opt/venv-render
```

`gcc`, `g++` and `python3-dev` are run-time dependencies, not build-time ones:
Triton compiles a CPython extension on the first forward pass of every fresh
process. Removing them after installing produces a backend that loads the
weights, runs for two minutes and dies on a bare `CalledProcessError`.

## Run

```bash
# the engine -- note there is no --chat-template
PATH=/opt/venv-vllm/bin:$PATH bash sdk/start_engine.sh 0 18499 /path/to/weights

# then one of:
PATH=/opt/venv-render/bin:$PATH bash sdk/start_score.sh 18501 http://127.0.0.1:18499
PATH=/opt/venv-render/bin:$PATH bash sdk/start_render_score.sh 18500 http://127.0.0.1:18499
```

The render+score service renders in its own process, so it must run with the
renderer's interpreter.

### score

```
POST /v1/score   {"items": [{"original_image": <b64>,
                             "render_image":   <b64>,
                             "ocr_text":       "..."}]}
  -> {"results": [{"prob_1": 0.00227, "error": null}]}
```

`ocr_text` goes to the model exactly as given. It is not stripped: whitespace is
in the rendered image too, and the model is being asked to compare the two.

### render+score

`/healthz`, `/v1/rm/score`, `/v1/rm/score_best`, `/v1/rm/score_best_batch` —
same request and response shapes as the image serves, including `stage_sec` and
the `throughput_rate` summary. `RM_THRESHOLD` (default 0.5) affects the summary
only; no item's `prob_yes` is ever rounded or decided for you.

## The startup check, and what it does not cover

Both services refuse to start if the engine does not assemble the prompt this
checkpoint was trained on. This matters more than it sounds, because the failure
has no symptom: a wrong prompt still returns 200, still returns a number in
range, still ranks candidates plausibly, and is on a different scale.

Three request keys are load-bearing, and `sdk/` sends all three explicitly rather
than relying on any default:

```python
"add_generation_prompt": True                        # /classify defaults to False
"chat_template_kwargs": {"enable_thinking": False}   # at top level it is ignored
"use_activation": False                              # we softmax the two logits ourselves
```

Measured on vLLM 0.32.0, `/classify` and `/tokenize` **disagree** about
`add_generation_prompt`: the scoring endpoint defaults it to `False`, the
endpoint the check interrogates defaults it to `True`. That is why the check has
a half that reads the outgoing request rather than the engine's reply.

What the check covers depends on what is installed:

| | needs | catches |
|---|---|---|
| pooled position | engine only | the assistant turn being cut off (last token 198 instead of 271) |
| outgoing request | nothing | the adapter not sending the three keys above |
| token-for-token | `transformers` + the weights on this host | everything else: image/text ordering, a missing newline, any template change |

Without the weights reachable from the service, the third row is skipped and the
check keeps roughly half its discriminating power. Set `JEV_WEIGHTS` to the
checkpoint directory to get all of it.

`JEV_ALLOW_UNVERIFIED=1` starts anyway. It is for bringing up a new engine, where
the check failing is the thing being worked on. Scores produced that way are not
comparable to any published number.

## Backends

`sdk/backends/vllm.yaml` selects the engine and says where to reach it. Only vLLM
is implemented: SGLang and llama.cpp both need upstream work that has not landed,
so their adapters would be untested code shipped as if it worked. The interface
they will implement is `sdk/jev_score/backends/base.py`, and naming either engine
in the config gives you that message rather than a vague failure.

## What is not here

`serve/` is unchanged and stays the image's source. This directory is excluded
from the image build context (`.dockerignore`), so editing it cannot move the
image's digest — the two routes are meant to be independently verifiable, which
they stop being the moment one rebuilds when the other changes.
