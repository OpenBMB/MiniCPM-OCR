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

Confirm that the returned `data` list contains an entry whose `id` is `MiniCPM-OCR-Jev` before sending a scoring request. Images must be PNG or JPEG, encoded as `data:image/png;base64,...` or `data:image/jpeg;base64,...`. One request accepts at most 64 scoring items. PDF files, image URLs, and multipart uploads are not accepted directly.

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

The scoring settings belong in the top-level `minicpm_ocr_jev` object, not inside `messages`. The official Python SDK sends that object through `extra_body`. The score payload is a JSON string in `choices[0].message.content` and must be parsed again. `prob_yes` is a model score only when `verdict` is `scored`.

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

For several regions, set `mode` to `score_best_batch`. `results[i]` follows the order of `items[i]`, and `best_index` refers to that region's own `candidates`.

## Score Status

| `verdict` | Score | Meaning |
| :--- | :--- | :--- |
| `scored` | A model score from 0 to 1 | Scoring finished |
| `precheck_reject`, `render_error`, `missing_original_image` | `0.0` | The text or original image never reached the model |
| `encode_error`, `forward_error` | `-1.0` | The image could not be decoded, or model scoring failed |

`0.0` and `-1.0` are fixed values returned on failure. They are not low model scores. In a `score` response, `summary.pass_rate` is the share of items that finished scoring (`scored / total`). `throughput_rate` is the share that met the threshold, not a rate per second. The default threshold is 0.5. It is used only for that summary and does not change the raw scores.

This page describes the hosted Chat Completions API. The Docker image uses a different, flat request body; the two are not interchangeable. See the [Docker image API](./minicpm_ocr_jev_docker_api_en.md). To recognize a region before scoring it, see [MiniCPM-OCR 1.0 API calls](./minicpm_ocr_api_en.md).
