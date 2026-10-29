# MiniCPM-OCR Jev API Calls

[← Back to README](../README.md#api) · [中文](./minicpm_ocr_jev_api_zh.md) · [MiniCPM-OCR 1.0 API calls](./minicpm_ocr_api_en.md)

Use the OpenAI-compatible Chat Completions API to assign a quality score from 0 to 1 to an existing OCR candidate, or to pick the highest-scoring candidate for one image region. The API does not recognize the image again and does not rewrite the text. You provide the service URL, API key, model name, original region image, and candidate text; the service renders the text.

## Endpoint and Authentication

| Setting | Description |
| :--- | :--- |
| `JEV_BASE_URL` | `https://api.modelbest.cn/v1`, including `/v1` but excluding `/chat/completions` |
| `JEV_API_KEY` | API key created on the [ModelBest platform](https://platform.modelbest.cn), sent as `Authorization: Bearer <API_KEY>` |
| `JEV_MODEL` | `MiniCPM-OCR-Jev`, case-sensitive |

```bash
export JEV_BASE_URL="https://api.modelbest.cn/v1"
export JEV_API_KEY="<your API key>"
export JEV_MODEL="MiniCPM-OCR-Jev"
```

Scoring requests use `POST ${JEV_BASE_URL}/chat/completions` with a JSON body and `stream: false`. First, check which models the key can access:

```bash
curl -fsS "${JEV_BASE_URL%/}/models" \
  -H "Authorization: Bearer ${JEV_API_KEY}"
```

Confirm that the returned `data` list contains an entry whose `id` is `MiniCPM-OCR-Jev` before sending a scoring request. Images must be PNG or JPEG, encoded as `data:image/png;base64,...` or `data:image/jpeg;base64,...`. One request accepts at most 64 scoring items. For `score`, count the `items`; for selection, count every candidate across regions. PDF files, image URLs, `file_id`, and multipart uploads are not accepted directly. A batch request must include a non-empty `messages` array with the images and texts being scored. Otherwise the API may return HTTP 400 with error code `moderation_invalid_input`.

## Request Fields

This endpoint classifies candidates. Do not set `temperature`, `top_p`, `max_tokens`, or a prompt.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `model` | string | yes | Model ID: `MiniCPM-OCR-Jev` |
| `messages` | array | yes | At least one `user` message. A batch must also include the actual images and texts |
| `minicpm_ocr_jev` | object | recommended | Scoring settings. Omitted requests are treated as `score`. It must be a JSON object, not an array, string, or `null` |
| `stream` | boolean | no | Use `false`. Server-sent events are not supported |

These fields belong inside `minicpm_ocr_jev`:

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `mode` | string | `score` | `score`: score one candidate, including batches. `score_best`: pick the best candidate for one region. `score_best_batch`: pick the best candidate for each of several regions |
| `category` | string | `text` | Region type for a single region: `text`, `formula`, or `table`. In a batch, set it on each item |
| `input_form` | string | `ternary` | Optional. Fixed at `ternary`: original image, text, and a rendering of that text |
| `image` | string | taken from `messages` | Original image for one region. An explicit value takes priority over the image in the message |
| `ocr_text` | string | taken from `messages` | Used only by a single `score`. An explicit value takes priority over the message text |
| `case_id` | string | generated | A single `score` defaults to `"0"`. An omitted `score_best` id is generated but is not returned |
| `threshold` | number | `0.5` | Used only by `score`. An item passes when `prob_yes >= threshold`. Use a value from 0 to 1. It does not change the raw score |
| `candidates` | string[] | recommended | Candidate texts for `score_best`, at least one, returned in input order. If omitted, the message text is the only candidate |
| `items` | object[] | none | Batch entries. The array must not be empty |
| `render_image` | string | rendered by the service | Advanced. Rendering for one `score` candidate |
| `render_images` | string[] | rendered by the service | Advanced. Renderings for `score_best`. The count and order must match `candidates` |

Each `score` item requires `case_id`, `image`, and `ocr_text`, and may include `category` and `render_image`. `case_id` must be unique within the batch. Each `score_best_batch` item requires `image` and `candidates`, and may include `case_id`, `category`, and `render_images`. Results follow the input order and do not return `case_id`. Fields set outside `items` are not copied onto each item. For batched selection, the total number of candidates across items must not exceed 64.

A single-region request uses the first image in `messages` and joins text parts with newlines. For several regions, set each region's image and text in `items`.

## Python Example: Score One Candidate

Install the client. Save the original region image as `block.png` and the corresponding UTF-8 candidate text as `ocr.txt`:

```bash
pip install openai
```

```python
import base64
import json
import os
from pathlib import Path

from openai import OpenAI

client = OpenAI(
    api_key=os.environ["JEV_API_KEY"],
    base_url=os.environ["JEV_BASE_URL"].rstrip("/"),
)
image_base64 = base64.b64encode(Path("block.png").read_bytes()).decode("utf-8")
ocr_text = Path("ocr.txt").read_text(encoding="utf-8")

response = client.chat.completions.create(
    model=os.environ["JEV_MODEL"],
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image_base64}"},
                },
                {"type": "text", "text": ocr_text},
            ],
        }
    ],
    extra_body={
        "minicpm_ocr_jev": {"mode": "score", "category": "text"},
    },
    stream=False,
)

result = json.loads(response.choices[0].message.content)
item = result["results"][0]
if item["verdict"] != "scored":
    raise RuntimeError(f"{item['verdict']}: {item.get('detail', '')}")
print(item["prob_yes"])
```

The scoring settings belong in the top-level `minicpm_ocr_jev` object, not inside `messages`. The official Python SDK sends that object through `extra_body`. The score payload is a JSON string in `choices[0].message.content` and must be parsed again. `prob_yes` is a model score only when `verdict` is `scored`. The `model` field in the response may be the lowercase `minicpm-ocr-jev`. Requests must still use `MiniCPM-OCR-Jev`.

On success, the score object appears both at the top level and as a JSON string in `choices[0].message.content`. The numbers below only show the shape. For compatibility across SDKs, parse the score from `content` and read usage from the top-level `usage`.

```json
{
  "id": "chatcmpl-example",
  "object": "chat.completion",
  "model": "minicpm-ocr-jev",
  "results": [
    {
      "case_id": "0",
      "category": "text",
      "verdict": "scored",
      "prob_yes": 0.93,
      "prob_no": 0.07,
      "detail": ""
    }
  ],
  "summary": {
    "total": 1,
    "scored": 1,
    "precheck_reject": 0,
    "render_error": 0,
    "forward_error": 0,
    "pass_rate": 1.0,
    "throughput_rate": 1.0,
    "threshold_used": 0.5,
    "input_form": "ternary",
    "by_category": {
      "text": {"total": 1, "scored": 1, "pass_rate": 1.0, "throughput_rate": 1.0, "mean_prob_yes": 0.93}
    }
  },
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "message": {"role": "assistant", "content": "<JSON string of results and summary>"}
    }
  ],
  "usage": {"prompt_tokens": 296, "completion_tokens": 0, "total_tokens": 296}
}
```

## Modes and Content Categories

| `mode` | Use |
| :--- | :--- |
| `score` | Score each candidate on its own. For several regions, put each one in `items` with `case_id`, `image`, `ocr_text`, and `category` |
| `score_best` | Pick the highest score among candidates for one original image. Put the candidates in `candidates` |
| `score_best_batch` | Pick the best candidate for each of several regions. Each item has its own `image`, `category`, and `candidates` |

| `category` | Candidate text |
| :--- | :--- |
| `text` | Prose or Markdown, with formulas kept as LaTeX |
| `formula` | Formula LaTeX. Escape backslashes in JSON, for example `"$$\\frac{1}{2}$$"` |
| `table` | An HTML table. Convert OTSL or Markdown tables to HTML first |

`category` must match the real type of the region. A mismatch raises no error, but the score is off.

### Scoring One Candidate for Each of Several Regions

`mode` stays `score`. Put each region in `items`, and place the original images and candidate texts in `messages` in the same order. The pairing is defined by `items`. Encode `text_image_base64` and `formula_image_base64` the same way as `image_base64` above. The response has the same shape as a single-candidate score, and `results[i]` matches `items[i]`.

```python
response = client.chat.completions.create(
    model=os.environ["JEV_MODEL"],
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{text_image_base64}"},
                },
                {"type": "text", "text": "正文识别结果"},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{formula_image_base64}"},
                },
                {"type": "text", "text": "$$\\frac{1}{2}$$"},
            ],
        }
    ],
    extra_body={
        "minicpm_ocr_jev": {
            "mode": "score",
            "threshold": 0.5,
            "items": [
                {
                    "case_id": "block-001",
                    "image": f"data:image/png;base64,{text_image_base64}",
                    "ocr_text": "正文识别结果",
                    "category": "text",
                },
                {
                    "case_id": "block-002",
                    "image": f"data:image/png;base64,{formula_image_base64}",
                    "ocr_text": "$$\\frac{1}{2}$$",
                    "category": "formula",
                },
            ],
        },
    },
    stream=False,
)
result = json.loads(response.choices[0].message.content)
for item in result["results"]:
    if item["verdict"] != "scored":
        raise RuntimeError(f"{item['case_id']}: {item['verdict']}: {item.get('detail', '')}")
    print(item["case_id"], item["prob_yes"])
```

### Selecting among Candidates for One Region

Keep the text in `messages` aligned with `candidates`, and separate the candidates with a blank line. Choose the highest score only among candidates whose `verdicts[i]` is `scored`. `best_text` is the selected input text, not a new or corrected transcription. Selection does not use `threshold`. If every candidate fails to score, the API still returns `best_index: 0` and the first candidate text; check `verdicts[best_index]` before using it.

```python
response = client.chat.completions.create(
    model=os.environ["JEV_MODEL"],
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image_base64}"},
                },
                {"type": "text", "text": "合计金额：128.00 元\n\n合计金额：123.00 元"},
            ],
        }
    ],
    extra_body={
        "minicpm_ocr_jev": {
            "mode": "score_best",
            "category": "text",
            "candidates": ["合计金额：128.00 元", "合计金额：123.00 元"],
        },
    },
    stream=False,
)
picked = json.loads(response.choices[0].message.content)
index = picked["best_index"]
if picked["verdicts"][index] != "scored":
    raise RuntimeError("No candidate was scored; the returned text is only a fallback")
print(picked["best_text"], picked["scores"][index])
```

The selection result is also a JSON string in `choices[0].message.content`. The common response fields are omitted below:

```json
{
  "best_index": 0,
  "best_text": "合计金额：128.00 元",
  "scores": [0.98, 0.31],
  "verdicts": ["scored", "scored"],
  "stage_sec": {
    "decode_sec": 0.001,
    "render_sec": 0.58,
    "forward_sec": 0.04,
    "forward_rows": 2,
    "total_sec": 0.621
  },
  "batch_size": 2
}
```

| Field | Description |
| :--- | :--- |
| `best_index` | Zero-based index into the original `candidates` |
| `best_text` | The selected input text, not a new or corrected transcription |
| `scores[i]` | `prob_yes` for candidate i. Use it only together with `verdicts[i]` |
| `verdicts[i]` | Scoring status of candidate i |
| `stage_sec` | Timing. Fields ending in `_sec` are seconds. `forward_rows` is the number of candidates that reached the model |
| `batch_size` | Number of candidates that reached the model. It can be smaller than the input. Success is determined by `verdicts` |

### Selecting among Candidates for Several Regions

Set `mode` to `score_best_batch`. Each item has its own original image, category, and `candidates`. In `messages`, place each original image and all of that region's candidate texts in the same order, with a blank line between candidates. `results[i]` follows `items[i]`, and `best_index` refers to that region's own `candidates`. Check `verdicts[best_index]` for each region before using the result. Inside each region, `stage_sec` is `{}` and `batch_size` is `0`; the timing and the number of candidates that reached the model are on the top level of the response.

```python
response = client.chat.completions.create(
    model=os.environ["JEV_MODEL"],
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{text_image_base64}"},
                },
                {"type": "text", "text": "正文候选 A\n\n正文候选 B"},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{formula_image_base64}"},
                },
                {"type": "text", "text": "$$x^2$$\n\n$$x^3$$"},
            ],
        }
    ],
    extra_body={
        "minicpm_ocr_jev": {
            "mode": "score_best_batch",
            "items": [
                {
                    "case_id": "block-001",
                    "image": f"data:image/png;base64,{text_image_base64}",
                    "category": "text",
                    "candidates": ["正文候选 A", "正文候选 B"],
                },
                {
                    "case_id": "block-002",
                    "image": f"data:image/png;base64,{formula_image_base64}",
                    "category": "formula",
                    "candidates": ["$$x^2$$", "$$x^3$$"],
                },
            ],
        },
    },
    stream=False,
)
picked = json.loads(response.choices[0].message.content)
for block in picked["results"]:
    index = block["best_index"]
    if block["verdicts"][index] != "scored":
        raise RuntimeError("No candidate in this region was scored; the returned text is only a fallback")
    print(block["best_text"], block["scores"][index])
```

## Score Status

HTTP 200 means the request was processed. Item status is in `verdict` or `verdicts`. A score is a model score only when the status is `scored`.

| Status | Meaning | Score |
| :--- | :--- | :--- |
| `scored` | Model scoring finished | `prob_yes` / `scores[i]` is a valid score from 0 to 1 |
| `precheck_reject` | The text failed the format check | Placeholder `0.0` |
| `render_error` | Text rendering failed | Placeholder `0.0` |
| `missing_original_image` | No usable original image | Placeholder `0.0` |
| `encode_error` | The original or rendered image could not be decoded | Placeholder `-1.0` |
| `forward_error` | Model scoring failed | Placeholder `-1.0` |
| Any other non-`scored` value | Scoring did not finish | The corresponding score is invalid |

`0.0` means the item was checked but never reached the model. `-1.0` means it was not judged. Neither is a low model score. For `score`, `results[].detail` explains an item-level failure and is usually an empty string on success. On success, `prob_no` is `1 - prob_yes`; on failure it may be `null`. A selection response has scores and statuses only, with no per-candidate `detail`. A single-region request without an image may return usage instructions instead of a score. Check that the response contains `results` or `scores`.

### Summary Fields

`summary` is only present for `score`. `by_category` repeats the same counts for each category that appears, and adds `mean_prob_yes`.

| Field | Meaning |
| :--- | :--- |
| `total` / `scored` | Number of inputs / number of items whose status is `scored` |
| `precheck_reject` | Number of items rejected by the format check |
| `render_error` | Count of `render_error` plus `missing_original_image` |
| `forward_error` | Count of `forward_error` plus `encode_error` |
| `pass_rate` | Share of items that finished scoring: `scored / total`. Independent of the quality threshold |
| `throughput_rate` | Share of items with `verdict` `scored` and `prob_yes >= threshold_used`, divided by `total`. Not a rate per second |
| `threshold_used` | Threshold used for this summary. The default is 0.5 |
| `input_form` | Currently `ternary` |
| `by_category.*.mean_prob_yes` | Mean score of successfully scored items in that category. `null` when none succeeded |

A quality score is for filtering and ranking candidates. It is not character accuracy, CER, WER, or a per-character confidence.

## Token Usage

Usage is the top-level `usage` object. It is not inside the score object in `content`.

```json
{"usage": {"prompt_tokens": 600, "completion_tokens": 0, "total_tokens": 600}}
```

`prompt_tokens` is the input tokens consumed by the model scores in this request for which usage was available, including the image, text, and rendered text. `completion_tokens` is always 0: the model classifies and does not generate text, so the score JSON and `best_text` are not counted as generated tokens. `total_tokens` equals `prompt_tokens`. Several candidates for the same original image are counted separately; the shared image is not deduplicated. Items that never reach the model, such as those rejected by the format check or by rendering, are not counted. Items that fail scoring and have no usage figure are also left out of this response. If no valid usage can be obtained, the API may return HTTP 502. A missing `usage` object does not mean the usage was zero. Prices, quotas, and billing follow the platform.

## Custom Renderings

By default the service renders the OCR text and then scores it. Do not send `render_image` or `render_images` unless you need a custom rendering.

To supply one, set `render_image` on a single `score` or on a `score` item, and set `render_images` on a single `score_best` or on a `score_best` item. Each candidate needs one rendering, as Base64 or a data URI. Once a rendering is provided, the service uses that image and skips the text format check and automatic rendering. The rendering must be produced from the matching candidate text. A different renderer can change the score. Use the default when you do not need a custom rendering.

## Errors

Use the HTTP status together with the `error` field. `error` may be an object, a string, or an array of validation errors.

| HTTP | What to do |
| :--- | :--- |
| `400` | Check the JSON, scoring settings, `mode`, batch contents, candidate count, and `messages`, then retry |
| `401` / `403` | Check that the API key is valid and that the project may call this model |
| `402` | The platform quota or billing state is not usable. Follow the platform's error message |
| `404` | Check the path and the model ID |
| `413` | The body is too large. Use smaller images or split the batch |
| `422` | Check categories, field types, required fields, non-empty candidate lists, `input_form`, and the number of renderings |
| `429` | Back off as the response indicates, and lower the concurrency or batch size |
| `5xx` | The service is temporarily unavailable or scoring failed. Retry a limited number of times with backoff. Include the response and `X-Request-Id`, if present, when contacting support |

Platform moderation error:

```json
{
  "error": {
    "code": "moderation_invalid_input",
    "message": "请求内容无法完成安全审核",
    "type": "invalid_request_error"
  }
}
```

When the settings are not a JSON object:

```json
{"error": "minicpm_ocr_jev must be a JSON object"}
```

If only some items in a batch fail, retry just those items. Every retry is a new call and may add usage. Do not write the API key or the full image encoding into logs. See the platform docs for [error codes](https://platform.modelbest.cn/console/docs/errors) and [rate limits and retries](https://platform.modelbest.cn/console/docs/rate-limits).

This page describes the hosted Chat Completions API. The Docker image uses a different, flat request body; the two are not interchangeable. See the [Docker image API](./minicpm_ocr_jev_docker_api_en.md). To recognize a region before scoring it, see [MiniCPM-OCR 1.0 API calls](./minicpm_ocr_api_en.md).
