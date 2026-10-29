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

确认返回的 `data` 列表中包含 `id` 为 `MiniCPM-OCR-Jev` 的模型，再发送评分请求。图片使用 PNG 或 JPEG，编码为 `data:image/png;base64,...` 或 `data:image/jpeg;base64,...`。单次请求最多 64 条评分项；`score` 按 `items` 数量计，选优按所有块的候选总数计。不支持直接传入 PDF、图片 URL、`file_id` 或 multipart 文件。批量请求的 `messages` 不能为空，且需包含本次评分的图片和文本，否则可能返回 HTTP 400，错误码为 `moderation_invalid_input`。

## 请求参数

本接口做分类评分，无需设置 `temperature`、`top_p`、`max_tokens` 或提示词。

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `model` | string | 是 | 模型 ID：`MiniCPM-OCR-Jev` |
| `messages` | array | 是 | 至少一条 `user` 消息。批量时也要放入实际图片和待评分文本 |
| `minicpm_ocr_jev` | object | 建议显式传入 | 评分配置。省略时按 `score` 处理。必须是 JSON 对象，不能是数组、字符串或 `null` |
| `stream` | boolean | 否 | 使用 `false`。不提供 SSE 流式输出 |

以下字段位于 `minicpm_ocr_jev` 内：

| 参数 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `mode` | string | `score` | `score`：单候选评分，可批量；`score_best`：单块多候选选优；`score_best_batch`：多块多候选选优 |
| `category` | string | `text` | 单块类别：`text` / `formula` / `table`。批量时在每个 item 内分别指定 |
| `input_form` | string | `ternary` | 可省略。固定为 `ternary`：原图 + 文本 + 文本渲染图 |
| `image` | string | 从 `messages` 提取 | 单块原图。显式传入时优先于消息中的图片 |
| `ocr_text` | string | 从 `messages` 提取 | 仅单块 `score` 使用。显式传入时优先于消息文本 |
| `case_id` | string | 按模式生成 | 单块 `score` 默认 `"0"`。`score_best` 省略时生成标识，但不会在选优响应中返回 |
| `threshold` | number | `0.5` | 仅 `score` 使用。达标条件为 `prob_yes >= threshold`。建议取 0～1，不改变原始分数 |
| `candidates` | string[] | 建议显式传入 | `score_best` 的候选文本，至少 1 条，返回顺序与输入一致。省略时把消息文本当作单候选 |
| `items` | object[] | 无 | 批量条目，数组不能为空 |
| `render_image` | string | 服务端生成 | 高级选项。单条 `score` 的文本渲染图 |
| `render_images` | string[] | 服务端生成 | 高级选项。`score_best` 的候选渲染图，数量和顺序必须与 `candidates` 相同 |

`score` 的 `items[]` 每条必填 `case_id`、`image`、`ocr_text`，可选 `category`、`render_image`。同一批内的 `case_id` 必须唯一。`score_best_batch` 的 `items[]` 每条必填 `image`、`candidates`，可选 `case_id`、`category`、`render_images`；结果按输入顺序对应，不返回 `case_id`。使用 `items` 时，外层同名字段不会作为各 item 的默认值。批量选优时，所有 item 的候选数量之和不得超过 64。

单块模式使用 `messages` 中的第一张图片，并把文本片段用换行连接。多块评分请在 `items` 里分别指定每个块的图片和文本。

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

评分配置放在请求体顶层的 `minicpm_ocr_jev`，不要写进 `messages`。官方 Python SDK 用 `extra_body` 传入该对象。评分 JSON 在 `choices[0].message.content` 中，需要再解析一次。只有 `verdict` 为 `scored` 时，`prob_yes` 才是模型分数。响应里的 `model` 可能是小写的 `minicpm-ocr-jev`，请求时仍使用 `MiniCPM-OCR-Jev`。

成功时，评分对象同时出现在顶层和 `choices[0].message.content` 的 JSON 字符串里。下面的分数和用量只说明格式。为兼容不同 SDK，从 `content` 解析评分结果，从顶层 `usage` 读取用量。

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
      "message": {"role": "assistant", "content": "<results 与 summary 的 JSON 字符串>"}
    }
  ],
  "usage": {"prompt_tokens": 296, "completion_tokens": 0, "total_tokens": 296}
}
```

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

选优结果同样放在 `choices[0].message.content` 的 JSON 字符串里。下面省略通用响应字段：

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

| 字段 | 说明 |
| :--- | :--- |
| `best_index` | 从 0 开始，对应原始 `candidates` 的下标 |
| `best_text` | 被选中的输入原文，不是重新识别或纠正后的文本 |
| `scores[i]` | 第 i 条候选的 `prob_yes`。必须结合 `verdicts[i]` 判断是否为有效分数 |
| `verdicts[i]` | 第 i 条候选的评分状态 |
| `stage_sec` | 处理耗时。`*_sec` 单位为秒，`forward_rows` 是进入模型的候选数 |
| `batch_size` | 进入模型的候选条数，可能少于输入条数。是否成功以 `verdicts` 为准 |

### 多块多候选选优

`mode` 设为 `score_best_batch`。每个 item 自带原图、类别和 `candidates`；`messages` 按同样顺序放上每张原图和该块的全部候选文本，候选之间用空行隔开。`results[i]` 与 `items[i]` 顺序一致，`best_index` 对应该块自己的 `candidates`。使用前逐块检查 `verdicts[best_index]`。各块里的 `stage_sec` 为 `{}`、`batch_size` 为 `0`；整批耗时和进入模型的候选数在响应顶层。

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
        raise RuntimeError("该块所有候选均未完成评分，返回文本只是回退值")
    print(block["best_text"], block["scores"][index])
```

## 评分状态

HTTP 200 表示请求已处理。条目状态在 `verdict` 或 `verdicts` 里，只有 `scored` 的分数才是模型评分。

| 状态 | 含义 | 分数 |
| :--- | :--- | :--- |
| `scored` | 已完成模型评分 | `prob_yes` / `scores[i]` 为 0–1 的有效分数 |
| `precheck_reject` | 文本未通过格式预检 | 占位值 `0.0` |
| `render_error` | 文本渲染失败 | 占位值 `0.0` |
| `missing_original_image` | 缺少可用原图 | 占位值 `0.0` |
| `encode_error` | 原图或渲染图无法解码 | 占位值 `-1.0` |
| `forward_error` | 模型评分失败 | 占位值 `-1.0` |
| 其他非 `scored` 值 | 评分未完成 | 对应分数无效 |

`0.0` 表示判过但未进入模型，`-1.0` 表示没判出来。两者都不能当成模型低分。`score` 的 `results[].detail` 给出条目级说明，成功时通常为空字符串。成功时 `prob_no` 为 `1 - prob_yes`，失败时可能为 `null`。选优响应只有分数和状态列表，没有逐候选 `detail`。单块请求若没给图片，接口可能返回使用说明而不是评分结果；先确认响应里有 `results` 或 `scores`。

### 汇总字段

`summary` 只用于 `score`。`by_category` 对实际出现的类别给出同样的统计，并多一个 `mean_prob_yes`。

| 字段 | 含义 |
| :--- | :--- |
| `total` / `scored` | 输入条数 / 状态为 `scored` 的条数 |
| `precheck_reject` | 预检拒绝条数 |
| `render_error` | `render_error` 与 `missing_original_image` 条数之和 |
| `forward_error` | `forward_error` 与 `encode_error` 条数之和 |
| `pass_rate` | 评分成功率：`scored / total`，与质量阈值无关 |
| `throughput_rate` | 质量达标比例：`verdict` 为 `scored` 且 `prob_yes >= threshold_used` 的条数 / `total`。不是每秒吞吐量 |
| `threshold_used` | 本次统计实际使用的阈值，默认 0.5 |
| `input_form` | 当前为 `ternary` |
| `by_category.*.mean_prob_yes` | 该类别成功评分条目的平均分。没有成功条目时为 `null` |

质量分数用于筛选和候选排序，不是字符准确率、CER、WER 或逐字符置信度。

## Token 用量

用量表在响应顶层的 `usage`，不在 `content` 的评分对象里。

```json
{"usage": {"prompt_tokens": 600, "completion_tokens": 0, "total_tokens": 600}}
```

`prompt_tokens` 是本次已取得用量的各条模型评分所消耗的输入 token，包含图片、文本和文本渲染图。`completion_tokens` 固定为 0：模型只做分类，不生成文本，评分 JSON 和 `best_text` 不计生成 token。`total_tokens` 等于 `prompt_tokens`。同一张原图的多条候选会分别计数，不按共享图片去重。格式预检或渲染失败、因而没有进入模型的条目不计 token。评分异常且拿不到用量的条目也不计入本次统计。如果拿不到有效用量，接口可能返回 HTTP 502；响应里没有 `usage` 不代表用量为零。价格、额度和计费以平台为准。

## 自定义渲染图

默认由服务端把 OCR 文本渲染成图片再评分，不必传 `render_image` 或 `render_images`。

需要自定义渲染图时，在单块或批量 `score` 的 item 里传 `render_image`，在单块或批量 `score_best` 的 item 里传 `render_images`。每条候选对应一张渲染图，使用 Base64 或 data URI。传入后，服务端直接使用该图片，不再做文本格式预检和自动渲染。渲染图必须由对应候选文本生成。渲染方式不同会影响分数；没有自定义需求时用默认方式。

## 错误处理

结合 HTTP 状态码和响应里的 `error` 处理。`error` 可能是对象、字符串，或参数校验错误数组。

| HTTP | 处理 |
| :--- | :--- |
| `400` | 检查 JSON、评分配置、`mode`、批次内容、候选数量和 `messages` 后重试 |
| `401` / `403` | 检查 API Key 是否有效，以及项目是否有该模型的调用权限 |
| `402` | 平台额度或计费状态异常，按平台返回的说明处理 |
| `404` | 检查接口路径和模型 ID |
| `413` | 请求体过大，缩小图片或拆分批次 |
| `422` | 检查类别、字段类型、必填项、非空候选、`input_form` 和渲染图数量 |
| `429` | 按响应提示退避，降低并发或批量大小 |
| `5xx` | 服务暂时不可用或评分异常。有限次退避重试；联系支持时附上响应和 `X-Request-Id`（如有） |

平台审核错误：

```json
{
  "error": {
    "code": "moderation_invalid_input",
    "message": "请求内容无法完成安全审核",
    "type": "invalid_request_error"
  }
}
```

参数不是 JSON 对象时：

```json
{"error": "minicpm_ocr_jev must be a JSON object"}
```

批量请求只有部分条目失败时，只重试失败条目。每次重试都是新的调用，可能产生额外用量。不要在日志里记录 API Key 或完整图片编码。更多说明见 [错误码](https://platform.modelbest.cn/console/docs/errors) 和 [限速与重试](https://platform.modelbest.cn/console/docs/rate-limits)。

本页描述云端 Chat Completions 接口。Docker 镜像使用另一套扁平请求体，两者不能互换，见 [Docker 镜像 API](./minicpm_ocr_jev_docker_api_zh.md)。先识别再评分时，见 [MiniCPM-OCR 1.0 API 调用](./minicpm_ocr_api_zh.md)。
