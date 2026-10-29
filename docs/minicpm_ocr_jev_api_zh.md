# MiniCPM-OCR Jev API 调用

[← 返回首页](../README_zh.md#api) · [English](./minicpm_ocr_jev_api_en.md) · [MiniCPM-OCR 1.0 API 调用](./minicpm_ocr_api_zh.md)

通过 OpenAI 兼容的 Chat Completions 接口，对已有 OCR 候选结果给出 0–1 质量分，或从同一图像块的多个候选中选出分数最高的一条。接口不重新识别，也不改写文本。调用方准备服务地址、API Key、模型名、区域原图和候选文本即可；文本渲染图由服务端生成。

## 接口与鉴权

| 配置 | 说明 |
| :--- | :--- |
| `JEV_BASE_URL` | `https://api.modelbest.cn/v1`，包含 `/v1`，不包含 `/chat/completions` |
| `JEV_API_KEY` | 在 [ModelBest 平台](https://platform.modelbest.cn) 创建的 API Key，通过 `Authorization: Bearer <API_KEY>` 发送 |
| `JEV_MODEL` | `MiniCPM-OCR-Jev`，区分大小写 |

```bash
export JEV_BASE_URL="https://api.modelbest.cn/v1"
export JEV_API_KEY="<你的 API Key>"
export JEV_MODEL="MiniCPM-OCR-Jev"
```

评分请求使用 `POST ${JEV_BASE_URL}/chat/completions`，请求体为 JSON，并设置 `stream: false`。可先检查当前 Key 能访问的模型：

```bash
curl -fsS "${JEV_BASE_URL%/}/models" \
  -H "Authorization: Bearer ${JEV_API_KEY}"
```

确认返回的 `data` 列表中包含 `id` 为 `MiniCPM-OCR-Jev` 的模型，再发送评分请求。图片使用 PNG 或 JPEG，编码为 `data:image/png;base64,...` 或 `data:image/jpeg;base64,...`。单次请求最多 64 条评分项；不支持直接传入 PDF、图片 URL 或 multipart 文件。

## Python 单候选评分

安装客户端。将区域原图保存为 `block.png`，对应的 UTF-8 候选文本保存为 `ocr.txt`：

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

评分配置放在请求体顶层的 `minicpm_ocr_jev`，不要写进 `messages`。官方 Python SDK 用 `extra_body` 传入该对象。评分 JSON 在 `choices[0].message.content` 中，需要再解析一次。只有 `verdict` 为 `scored` 时，`prob_yes` 才是模型分数。

## 模式与内容类别

| `mode` | 用途 |
| :--- | :--- |
| `score` | 每个候选单独评分。多块时把每块放进 `items`，每条包含 `case_id`、`image`、`ocr_text` 和 `category` |
| `score_best` | 同一张原图的多条候选中选最高分，候选放在 `candidates` |
| `score_best_batch` | 多个块各自选优。每个 item 自带 `image`、`category` 和 `candidates` |

| `category` | 候选文本 |
| :--- | :--- |
| `text` | 正文或 Markdown；其中的公式保留 LaTeX |
| `formula` | 公式 LaTeX。JSON 字符串中的反斜杠需要转义，例如 `"$$\\frac{1}{2}$$"` |
| `table` | HTML 表格。OTSL 或 Markdown 表格需先转成 HTML |

`category` 必须与块的真实类型一致，填错不会报错，但分数会偏。

### 多块单候选评分

`mode` 仍为 `score`。每个块放进 `items`，并在 `messages` 里按同样顺序放上原图和候选文本；每条的对应关系以 `items` 为准。`text_image_base64` 和 `formula_image_base64` 的编码方式与上面的 `image_base64` 相同。返回结构与单候选评分相同，`results[i]` 对应 `items[i]`。

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

### 单块多候选选优

`messages` 里的文本与 `candidates` 保持一致，候选之间用空行隔开。只在 `verdicts[i]` 为 `scored` 的候选里取最高分；`best_text` 是被选中的输入原文，不是重新识别或纠正后的文本。选优不看 `threshold`。若全部候选都未完成评分，接口仍返回 `best_index: 0` 和第一条文本，使用前要检查 `verdicts[best_index]`。

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
    raise RuntimeError("所有候选均未完成评分，返回文本只是回退值")
print(picked["best_text"], picked["scores"][index])
```

多块选优把 `mode` 设为 `score_best_batch`。`results[i]` 与请求 `items[i]` 的顺序一致，`best_index` 对应该块自己的 `candidates`。

## 评分状态

| `verdict` | 分数 | 含义 |
| :--- | :--- | :--- |
| `scored` | 0–1 的模型分数 | 已完成评分 |
| `precheck_reject`、`render_error`、`missing_original_image` | `0.0` | 文本或原图没有进入模型 |
| `encode_error`、`forward_error` | `-1.0` | 图片无法解码，或模型评分失败 |

`0.0` 和 `-1.0` 都是失败时的固定返回值，不能当成模型给出的低分。`score` 响应里的 `summary.pass_rate` 是评分成功率（`scored / total`），`throughput_rate` 是达到阈值的条目比例，不是每秒吞吐量。默认阈值为 0.5，只用于达标统计，不改变原始分数。

本页描述云端 Chat Completions 接口。Docker 镜像使用另一套扁平请求体，两者不能互换，见 [Docker 镜像 API](./minicpm_ocr_jev_docker_api_zh.md)。先识别再评分时，见 [MiniCPM-OCR 1.0 API 调用](./minicpm_ocr_api_zh.md)。
