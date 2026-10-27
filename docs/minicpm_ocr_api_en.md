# MiniCPM-OCR 1.0 API Calls

[← Back to README](../README.md#api) · [中文](./minicpm_ocr_api_zh.md) · [MiniCPM-OCR Jev API calls](./minicpm_ocr_jev_api_en.md)

Use the OpenAI-compatible Chat Completions API to send an image and a recognition prompt to an enabled MiniCPM-OCR 1.0 service, then read the recognized content from the response. You only need the service URL, API key, and model name; no model download or inference environment setup is required.

## Endpoint and Authentication

| Setting | Description |
| :--- | :--- |
| `OCR_BASE_URL` | API base URL supplied by the service, including `/v1` but excluding `/chat/completions` |
| `OCR_API_KEY` | API key with OCR service access, sent as `Authorization: Bearer <API_KEY>` |
| `OCR_MODEL` | OCR model ID supplied by the service; it must match the server's model name |

**The official hosted OCR endpoint, access signup page, and model ID are still to be added.** These examples follow the repository's existing OpenAI-compatible recognition interface. Replace all placeholders with the configuration provided by your service before use.

```bash
export OCR_BASE_URL="<API base URL supplied by the service, including /v1>"
export OCR_API_KEY="<your API key>"
export OCR_MODEL="<OCR model ID supplied by the service>"
```

Recognition requests use `POST ${OCR_BASE_URL}/chat/completions` with a JSON body. First, check which models the key can access:

```bash
curl -fsS "${OCR_BASE_URL%/}/models" \
  -H "Authorization: Bearer ${OCR_API_KEY}"
```

Confirm that the returned `data` list contains an `id` matching `OCR_MODEL` before sending a recognition request.

## Python Example

Install the client and save the PNG image to recognize as `sample.png`:

```bash
pip install openai
```

```python
import base64
import os
from pathlib import Path

from openai import OpenAI

client = OpenAI(
    api_key=os.environ["OCR_API_KEY"],
    base_url=os.environ["OCR_BASE_URL"].rstrip("/"),
)
image_base64 = base64.b64encode(Path("sample.png").read_bytes()).decode("utf-8")

response = client.chat.completions.create(
    model=os.environ["OCR_MODEL"],
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image_base64}"},
                },
                {"type": "text", "text": "Text Recognition:"},
            ],
        }
    ],
    temperature=0.01,
    top_p=0.001,
    max_tokens=2048,
    stream=False,
)

print(response.choices[0].message.content)
print("finish_reason:", response.choices[0].finish_reason)
```

The recognized content is in `choices[0].message.content`. If `finish_reason` is `length`, the result may be truncated. Adjust `max_tokens` according to the context and output lengths supported by the service.

## Text, Tables, and Formulas

Replace the example's prompt according to the region type:

| Content | Prompt |
| :--- | :--- |
| Text | `Text Recognition:` |
| Table | `Table Recognition:` |
| Formula | `Formula Recognition:` |

This example recognizes a single image region; the raw table output format depends on the model service you use. For layout analysis, cropping, reading-order reconstruction, and Markdown export from a complete PDF or page, see the [SDK document parsing tutorial](./minicpmvocr_tutorial_en.md#4-parse-documents). To score recognition quality, see the [MiniCPM-OCR Jev API guide](./minicpm_ocr_jev_api_en.md).
