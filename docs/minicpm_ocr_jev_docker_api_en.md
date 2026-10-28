# Docker Image API

[中文版](minicpm_ocr_jev_docker_api_zh.md)

[← Back to the deployment guide](./minicpm_ocr_jev_tutorial_en.md)

This is the interface reference for the Docker image of [MiniCPM-OCR Jev Local Deployment](./minicpm_ocr_jev_tutorial_en.md), describing the request and response formats of its four endpoints. The request body is a flat `input_form + items` structure, which is not the OpenAI Chat Completions protocol used by the [cloud API](./minicpm_ocr_jev_api_en.md); the two are not interchangeable.

## Common conventions

### `input_form`

Every scoring request carries `input_form` at the top level of the body. It is currently fixed to `"ternary"` (original image + render image + text). Any other value is rejected with 422. `score_best_batch` needs it once more inside every item; without it the request is rejected with 422.

### `image` / `render_image` / `render_images`

All image fields take the base64 body of the image file (PNG or JPEG) with **no** prefix such as `data:image/png;base64,`. With a prefix, that item returns `encode_error`.

### `category`

The block type, one of `"text"` / `"formula"` / `"table"`. **It must match the real type of the block** — a formula block sent as `text` gets its LaTeX rendered literally instead of typeset as a formula, which distorts the score without reporting anything.

### `verdict` and the values returned when scoring fails

Every result carries a `verdict` field, and **you must read it before using the score**:

| verdict | prob_yes | Meaning |
|---|---|---|
| `scored` | the real score | normal |
| `precheck_reject` | `0.0` | the candidate was judged unusable (broken LaTeX syntax, malformed structure) |
| `render_error` | `0.0` | rendering failed |
| `missing_original_image` | `0.0` | the original image is missing |
| `encode_error` | `-1.0` | the bytes of an input image are not readable |
| `forward_error` | `-1.0` | the backend errored out or is not ready yet |

The two failure values are deliberately kept apart: `0.0` means "judged, and it does not qualify", `-1.0` means "no judgement was produced". Both lose every comparison and clear no threshold. The reason for the failure is in `detail`.

---

## `GET /healthz`

Health check. Returns the service status, the backend model name, the renderer status and the settings.

```bash
curl -s http://127.0.0.1:8030/healthz | jq
```

```json
{
  "status": "ok",
  "backend": {"url": "http://127.0.0.1:8026", "alive": true,
              "served": ["minicpm-ocr-jev"], "model": "minicpm-ocr-jev"},
  "input_forms": {"supported": ["ternary"], "template_md5": "9aab68e8…"},
  "scorer": {"model": "minicpm-ocr-jev", "backend": "vllm-serve-classify",
             "template_md5": "9aab68e8…"},
  "render": {"enabled": true, "mode": "persistent", "browsers": 2, …},
  "settings": {"threshold": 0.5, "max_items": 64, "forward_concurrency": 4}
}
```

`status: ok` means the backend is ready; `loading` means it is still loading the weights, and scoring requests return 503 until it is done. `template_md5` is the fingerprint of the prompt template the engine actually assembles; when it differs from the training template, the scores are not comparable.

---

## `POST /v1/rm/score`

One score per block, one candidate per block. Suited to quality screening, routing to human review, and throughput-rate statistics.

```bash
curl -s http://127.0.0.1:8030/v1/rm/score -H 'Content-Type: application/json' -d '{
  "input_form": "ternary",
  "items": [
    {"case_id": "blk-001", "image": "<base64>",
     "ocr_text": "the OCR text to be scored", "category": "text"},
    {"case_id": "blk-002", "image": "<base64>",
     "ocr_text": "\\frac{1}{2}", "category": "formula"}
  ]
}'
```

Optional fields:

- `items[].render_image`: bring your own render image and skip server-side rendering
- `threshold`: optional, at the top level; overrides the default of 0.5 and affects only `throughput_rate` in the summary, never any single `prob_yes`

```json
{
  "results": [
    {"case_id": "blk-001", "category": "text", "verdict": "scored",
     "prob_yes": 0.99509, "prob_no": 0.00491, "detail": ""},
    {"case_id": "blk-002", "category": "formula", "verdict": "scored",
     "prob_yes": 0.00652, "prob_no": 0.99348, "detail": ""}
  ],
  "summary": {
    "total": 2, "scored": 2, "precheck_reject": 0, "render_error": 0, "forward_error": 0,
    "pass_rate": 1.0, "throughput_rate": 0.5, "threshold_used": 0.5,
    "input_form": "ternary",
    "by_category": {
      "formula": {"total": 1, "scored": 1, …, "mean_prob_yes": 0.00652},
      "text":    {"total": 1, "scored": 1, …, "mean_prob_yes": 0.99509}
    }
  }
}
```

**Fields**:

- `results[i]` corresponds one-to-one with `items[i]` in the request
- `prob_yes`: the probability that the candidate matches the original image, 0–1; **read** `verdict` **before using it**
- `prob_no`: `1 - prob_yes`
- `detail`: the reason for a failure; an empty string when `verdict` is `scored`
- `summary.pass_rate`: the scoring success rate, `scored / total`, independent of any threshold
- `summary.throughput_rate`: the share of scored items at or above the threshold (note it is `>=`, not `>`); only items with `verdict=scored` are counted
- `summary.by_category`: the same statistics grouped by `category`

---

## `POST /v1/rm/score_best`

Picks the best of N candidates for one block. Suited to single-block tests and low-frequency calls; use `score_best_batch` when there are many blocks.

```bash
curl -s http://127.0.0.1:8030/v1/rm/score_best -H 'Content-Type: application/json' -d '{
  "input_form": "ternary",
  "image": "<base64>",
  "category": "text",
  "candidates": ["candidate A", "candidate B", "candidate C"]
}'
```

Optional fields:

- `case_id`: the service generates a UUID when it is omitted
- `render_images`: a list of render images the same length as `candidates`; bringing your own skips server-side rendering

```json
{
  "best_index": 1,
  "best_text": "candidate B",
  "scores": [0.00589, 0.99509, 0.01234],
  "verdicts": ["scored", "scored", "scored"],
  "stage_sec": {"render_sec": 0.31, "forward_sec": 0.02, "total_sec": 0.34},
  "batch_size": 3
}
```

**Fields**:

- `best_index` / `best_text`: the argmax among the candidates with `verdict=scored`; when every candidate failed it falls back to index 0, which the caller can detect from `verdicts`
- `scores`: `prob_yes` in input order, 0–1; `0.0` or `-1.0` when scoring failed
- `verdicts`: one-to-one with `scores`. **Take the best score as `scores[best_index]`** — do not compute it any other way
- `stage_sec`: per-stage timings in seconds; rendering is usually the bulk of it
- `batch_size`: how many candidates actually went through the forward pass

---

## `POST /v1/rm/score_best_batch`

Several blocks each pick their own best, in a single HTTP request. **Recommended in production**: both rendering and the forward pass are batched server-side, so the more blocks there are, the lower the amortised cost per block; with few blocks it is equivalent to calling `score_best` per block.

```bash
curl -s http://127.0.0.1:8030/v1/rm/score_best_batch -H 'Content-Type: application/json' -d '{
  "input_form": "ternary",
  "items": [
    {"input_form": "ternary", "case_id": "blk-001", "image": "<base64>",
     "category": "text", "candidates": ["text candidate A", "text candidate B"]},
    {"input_form": "ternary", "case_id": "blk-002", "image": "<base64>",
     "category": "formula", "candidates": ["\\frac{1}{2}", "1/2"]}
  ]
}'
```

The fields inside `items[]` are the same as a single-block `score_best` request, `input_form` included — it goes both at the top level and in every item — except that `case_id` is required so the blocks can be told apart. `render_images` is likewise given per block.

```json
{
  "results": [
    {"best_index": 0, "best_text": "text candidate A",
     "scores": [0.97, 0.22], "verdicts": ["scored", "scored"], "stage_sec": {}, "batch_size": 0},
    {"best_index": 1, "best_text": "1/2",
     "scores": [0.31, 0.88], "verdicts": ["scored", "scored"], "stage_sec": {}, "batch_size": 0}
  ],
  "stage_sec": {"render_sec": 0.62, "forward_sec": 0.04, "total_sec": 0.68},
  "batch_size": 4
}
```

**Fields**:

- `results[i]` corresponds one-to-one with `items[i]` in the request; each element is exactly one `score_best` response
- `stage_sec` sits at the top level and covers the whole batch; the **per-block** `stage_sec` is **left empty**, because the wall clock of one batch cannot be split across its blocks without making numbers up
- `batch_size` sits at the top level and counts all the candidates in the batch that went through the forward pass

---

## Limits

- The total number of candidates in one request (`items` count × candidates per block, or the `candidates` count of a single block) is capped by `max_items`, 64 by default; over the limit returns 400
- `category` must match the real type of the block; getting it wrong raises no error but distorts the score
- `input_form` currently supports only `"ternary"`
- The threshold `RM_THRESHOLD` (0.5 by default) affects only the `throughput_rate` summary, never any `prob_yes`

---

## Field reference

| Field | Where it appears | Meaning |
|---|---|---|
| `input_form` | top level of the request; also `items[]` in batch | fixed to `"ternary"` |
| `case_id` | `items[]` | the caller's own block identifier, echoed back unchanged |
| `image` | `items[]` | the original block image, base64 with no `data:` prefix |
| `ocr_text` | `items[]` (score) | the single text to be scored |
| `candidates` | top level (score_best) / `items[]` (batch) | the array of candidate texts |
| `category` | everywhere | `text` / `formula` / `table` |
| `render_image` | `items[]` (score) | optional, bring your own render image |
| `render_images` | top level (score_best) / `items[]` (batch) | optional, same length as `candidates` |
| `threshold` | top level of the request | optional, overrides the default of 0.5, affects the summary only |
| `verdict` | `results[]` | the scoring status; always read it before using a score |
| `prob_yes` | `results[]` | the match probability, 0–1; `0.0` or `-1.0` when scoring failed |
| `prob_no` | `results[]` | `1 - prob_yes` |
| `best_index` | score_best response | the index chosen by argmax |
| `best_text` | score_best response | the text of the best candidate |
| `scores` | score_best response | the list of `prob_yes` in input order |
| `verdicts` | score_best response | one-to-one with `scores` |
| `stage_sec` | score_best response | per-stage timings in seconds |
| `batch_size` | score_best response | how many candidates actually went through the forward pass |
| `pass_rate` | summary | the scoring success rate, independent of any threshold |
| `throughput_rate` | summary | the share of scored items at or above the threshold |
