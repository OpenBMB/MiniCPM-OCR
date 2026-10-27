# MiniCPM-OCR 1.0 API 调用

[← 返回首页](../README_zh.md#api) · [English](./minicpm_ocr_api_en.md) · [MiniCPM-OCR Jev API 调用](./minicpm_ocr_jev_api_zh.md)

通过 OpenAI 兼容的 Chat Completions 接口，将图片和识别提示词发送给已开通的 MiniCPM-OCR 1.0 服务，读取返回的识别结果。调用方只需准备服务地址、API Key 和模型名，无需下载模型或配置推理环境。

## 接口与鉴权

| 配置 | 说明 |
| :--- | :--- |
| `OCR_BASE_URL` | 服务提供的 API 基础地址，包含 `/v1`，不包含 `/chat/completions` |
| `OCR_API_KEY` | 已开通 OCR 服务的 API Key，通过 `Authorization: Bearer <API_KEY>` 发送 |
| `OCR_MODEL` | 服务提供的 OCR 模型 ID，需与服务端名称一致 |

**在线 OCR 服务的正式地址、开通入口和模型 ID 待补充。** 以下示例依据仓库现有的 OpenAI 兼容识别接口整理；使用前请将占位值替换为服务方提供的配置。

```bash
export OCR_BASE_URL="<服务提供的 API 基础地址，含 /v1>"
export OCR_API_KEY="<你的 API Key>"
export OCR_MODEL="<服务提供的 OCR 模型 ID>"
```

识别请求使用 `POST ${OCR_BASE_URL}/chat/completions`，请求体为 JSON。可先检查当前 Key 能访问的模型：

```bash
curl -fsS "${OCR_BASE_URL%/}/models" \
  -H "Authorization: Bearer ${OCR_API_KEY}"
```

确认返回的 `data` 列表中包含 `OCR_MODEL` 对应的 `id`，再发送识别请求。

## Python 调用示例

安装客户端，将需要识别的 PNG 图片保存为 `sample.png`：

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

识别内容位于 `choices[0].message.content`。如果 `finish_reason` 为 `length`，结果可能被截断，应结合服务允许的上下文和输出长度调整 `max_tokens`。

## 文本、表格与公式

按区域类型替换示例中的提示词：

| 识别内容 | 提示词 |
| :--- | :--- |
| 文本 | `Text Recognition:` |
| 表格 | `Table Recognition:` |
| 公式 | `Formula Recognition:` |

此示例用于单个图像块的识别；表格原始返回格式以所接入的模型服务为准。完整 PDF 或整页文档的版面分析、切块、阅读顺序恢复与 Markdown 导出，见 [SDK 文档解析教程](./minicpmvocr_tutorial.md#4-解析文档)。识别结果的质量评分见 [MiniCPM-OCR Jev API 调用说明](./minicpm_ocr_jev_api_zh.md)。
