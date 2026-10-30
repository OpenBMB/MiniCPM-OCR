# Docker 镜像 API

[English](minicpm_ocr_jev_docker_api_en.md)

[← 返回使用教程](./minicpm_ocr_jev_tutorial_zh.md)

本文是 [MiniCPM-OCR Jev 本地部署](./minicpm_ocr_jev_tutorial_zh.md) 的 Docker 镜像接口参考，描述四个端点的请求与响应格式。请求体是扁平的 `input_form + items` 结构，与 [云端 API](https://platform.modelbest.cn/console/docs/api/ocr-jev) 的 OpenAI Chat Completions 协议不同，两者不能互换。

## 通用约定

### `input_form`

所有打分端点的请求体顶层都带 `input_form`，目前固定为 `"ternary"`（原图 + 渲染图 + 文本三元输入）。其他值会被 422 拒绝。`score_best_batch` 的每个 item 里还要再带一次，缺了返回 422。

### `image` / `render_image` / `render_images`

图片字段都传图片文件（PNG 或 JPEG）的 base64 正文，**不带** `data:image/png;base64,` 这类前缀；带了前缀，该条返回 `encode_error`。

### `category`

块类型，三选一：`"text"` / `"formula"` / `"table"`。**必须与块真实类型一致**——公式块送成 `text` 会按字面 LaTeX 渲染而不是排版成公式，分数失真且不报错。

### `verdict` 与打分失败时的取值

每条结果都带 `verdict` 字段，**用分数前必须先看它**：

| verdict | prob_yes | 含义 |
|---|---|---|
| `scored` | 真实分数 | 正常 |
| `precheck_reject` | `0.0` | 候选被判为不可用（LaTeX 语法坏、结构异常） |
| `render_error` | `0.0` | 渲染失败 |
| `missing_original_image` | `0.0` | 缺原图 |
| `encode_error` | `-1.0` | 输入图片字节有问题 |
| `forward_error` | `-1.0` | 后端报错或尚未就绪 |

两个失败取值是有意分开的：`0.0` 表示"判过了，不合格"，`-1.0` 表示"没判出来"。两者都会输掉任何比较、过不了任何阈值。失败原因在 `detail` 字段。

---

## `GET /healthz`

健康检查。返回服务状态、后端模型名、渲染器状态与设置。

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

`status` 为 `ok` 表示后端已就绪；`loading` 表示还在加载权重，此时打分会返回 503。`template_md5` 是引擎实际拼出的 prompt 模板指纹，与训练模板不一致时分数不可比。

---

## `POST /v1/rm/score`

多个块各打一分，每块一条候选。适合质量筛查、人工复核分流、直通率统计。

```bash
curl -s http://127.0.0.1:8030/v1/rm/score -H 'Content-Type: application/json' -d '{
  "input_form": "ternary",
  "items": [
    {"case_id": "blk-001", "image": "<base64>",
     "ocr_text": "待评分的 OCR 文本", "category": "text"},
    {"case_id": "blk-002", "image": "<base64>",
     "ocr_text": "\\frac{1}{2}", "category": "formula"}
  ]
}'
```

可选字段：

- `items[].render_image`：自带渲染图，跳过服务端渲染
- `threshold`：顶层可选，覆盖默认 0.5，只影响汇总里的 `throughput_rate`，不影响任何一条的 `prob_yes`

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

**字段说明**：

- `results[i]` 与请求的 `items[i]` 一一对应
- `prob_yes`：候选与原图一致的概率，0–1；**用前必须先看** `verdict`
- `prob_no`：`1 - prob_yes`
- `detail`：失败原因，`verdict` 为 `scored` 时为空串
- `summary.pass_rate`：打分成功率 = `scored / total`，与阈值无关
- `summary.throughput_rate`：`>=` 阈值的 scored 条目占比（注意是 `>=` 不是 `>`），只统计 `verdict=scored` 的项
- `summary.by_category`：按 `category` 分组的同样统计

---

## `POST /v1/rm/score_best`

一个块的 N 条候选里选最优。适合单块测试、低频调用；块多请用 `score_best_batch`。

```bash
curl -s http://127.0.0.1:8030/v1/rm/score_best -H 'Content-Type: application/json' -d '{
  "input_form": "ternary",
  "image": "<base64>",
  "category": "text",
  "candidates": ["候选 A", "候选 B", "候选 C"]
}'
```

可选字段：

- `case_id`：缺省时服务自动生成 UUID
- `render_images`：与 `candidates` 等长的渲染图列表，自带渲染图跳过服务端渲染

```json
{
  "best_index": 1,
  "best_text": "候选 B",
  "scores": [0.00589, 0.99509, 0.01234],
  "verdicts": ["scored", "scored", "scored"],
  "stage_sec": {"render_sec": 0.31, "forward_sec": 0.02, "total_sec": 0.34},
  "batch_size": 3
}
```

**字段说明**：

- `best_index` / `best_text`：在 `verdict=scored` 的候选中 argmax 选出；全部失败时回退到 index 0，调用方可从 `verdicts` 检测这种情况
- `scores`：按输入顺序的 `prob_yes`，取值 0–1；打分失败时为 `0.0` 或 `-1.0`
- `verdicts`：与 `scores` 一一对应，**最优分取** `scores[best_index]`，不要自己另算
- `stage_sec`：分阶段耗时（秒），渲染通常占大头
- `batch_size`：实际进入前向的候选数

---

## `POST /v1/rm/score_best_batch`

多个块各自选最优，一次 HTTP 完成。**生产场景推荐**：渲染与前向都在服务端合批，块数越多单块均摊成本越低；块少时与逐块调 `score_best` 等价。

```bash
curl -s http://127.0.0.1:8030/v1/rm/score_best_batch -H 'Content-Type: application/json' -d '{
  "input_form": "ternary",
  "items": [
    {"input_form": "ternary", "case_id": "blk-001", "image": "<base64>",
     "category": "text", "candidates": ["文本候选 A", "文本候选 B"]},
    {"input_form": "ternary", "case_id": "blk-002", "image": "<base64>",
     "category": "formula", "candidates": ["\\frac{1}{2}", "1/2"]}
  ]
}'
```

`items[]` 的字段与 `score_best` 单块请求一致，`input_form` 也在其中，顶层与每个 item 都要带；`case_id` 必填以区分块。`render_images` 同样按块各自提供。

```json
{
  "results": [
    {"best_index": 0, "best_text": "文本候选 A",
     "scores": [0.97, 0.22], "verdicts": ["scored", "scored"], "stage_sec": {}, "batch_size": 0},
    {"best_index": 1, "best_text": "1/2",
     "scores": [0.31, 0.88], "verdicts": ["scored", "scored"], "stage_sec": {}, "batch_size": 0}
  ],
  "stage_sec": {"render_sec": 0.62, "forward_sec": 0.04, "total_sec": 0.68},
  "batch_size": 4
}
```

**字段说明**：

- `results[i]` 与请求的 `items[i]` 一一对应，每个元素就是一份 `score_best` 的响应
- `stage_sec` 在顶层，是整批的合计耗时；**单个块的** `stage_sec` **留空**，因为一批的墙钟无法在不编数的情况下分摊到各块
- `batch_size` 在顶层，是整批进入前向的总候选数

---

## 限制

- 单次请求候选总数（`items` 数 × 每块候选数，或单块 `candidates` 数）受 `max_items` 限制，默认 64，超出返回 400
- 服务端 `category` 必须与块真实类型一致；填错不报错但分数失真
- `input_form` 目前只支持 `"ternary"`
- 阈值 `RM_THRESHOLD`（默认 0.5）只影响 `throughput_rate` 汇总，不影响任何 `prob_yes`

---

## 字段速查

| 字段 | 出现位置 | 含义 |
|---|---|---|
| `input_form` | 请求顶层；batch 的 `items[]` 也要 | 固定 `"ternary"` |
| `case_id` | `items[]` | 调用方自己的块标识，原样回传 |
| `image` | `items[]` | 块原图，base64，不带 `data:` 前缀 |
| `ocr_text` | `items[]`（score） | 待评分的单条文本 |
| `candidates` | 顶层（score_best）/ `items[]`（batch） | 候选文本数组 |
| `category` | 各处 | `text` / `formula` / `table` |
| `render_image` | `items[]`（score） | 可选，自带渲染图 |
| `render_images` | 顶层（score_best）/ `items[]`（batch） | 可选，与 `candidates` 等长 |
| `threshold` | 请求顶层 | 可选，覆盖默认 0.5，只影响汇总 |
| `verdict` | `results[]` | 打分状态，用分数前必查 |
| `prob_yes` | `results[]` | 一致性概率，0–1；打分失败时为 `0.0` 或 `-1.0` |
| `prob_no` | `results[]` | `1 - prob_yes` |
| `best_index` | score_best 响应 | argmax 选出的下标 |
| `best_text` | score_best 响应 | 最优候选原文 |
| `scores` | score_best 响应 | 按输入顺序的 `prob_yes` 列表 |
| `verdicts` | score_best 响应 | 与 `scores` 一一对应 |
| `stage_sec` | score_best 响应 | 分阶段耗时（秒） |
| `batch_size` | score_best 响应 | 实际前向的候选数 |
| `pass_rate` | summary | 打分成功率，与阈值无关 |
| `throughput_rate` | summary | `>=` 阈值的 scored 占比 |
