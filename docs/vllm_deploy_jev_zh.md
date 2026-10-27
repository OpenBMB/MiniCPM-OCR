# SDK 本地部署：vLLM 后端

[English](vllm_deploy_jev_en.md)

[← 返回使用教程](./minicpm_ocr_jev_tutorial_zh.md)

本文介绍SDK部署模式下，以 vLLM 作为前向引擎时，**不带渲染器服务**与**内置渲染器服务**的安装、启动、接口与请求格式。

两种服务共用同一个前向引擎，区别只在渲染图从哪里来：

|      | 不带渲染器服务                    | 内置渲染器服务                                     |
| ---- | -------------------------- | ------------------------------------------- |
| 渲染图  | 由你提供                       | 服务默认自己渲染（也可由你提供）                            |
| 渲染环境 | **不需要**，无 Chromium、Node、字体 | 需要                                          |
| 接口   | `/v1/score`，返回 `prob_1`    | `/v1/rm/score*`，返回 `prob_yes`，与 Docker 镜像同构 |
| 功能   | 逐条打分                       | 逐条打分、块内选优、批量选优，带 precheck                   |
| 启动脚本 | `sdk/start_score.sh`       | `sdk/start_render_score.sh`                 |

## 部署流程

1. 装引擎环境，起前向引擎（两种服务都要）
2. 二选一：
   - **不带渲染器服务** → 装服务环境 → 起服务
   - **内置渲染器服务** → 装渲染环境 → 起服务

引擎与服务必须装在两个虚拟环境里，不要合并。以下命令都在 `scripts/minicpm-ocr-jev/` 目录下执行。

## 环境要求

- **GPU**：NVIDIA，显存 ≥12GB
- **驱动**：≥535
- **Python**：≥3.10
- **vLLM**：0.32.0
- **系统包**：`gcc`、`g++`、`python3-dev`（runtime 依赖，装完不要删除）
- **固定版本**：`Pillow` 12.3.0、`playwright` 1.62.0（仅内置渲染器服务）

---

## 一、前向引擎

两种服务都要连一个 vLLM 引擎。

用随附脚本安装并启动，参数依次为 GPU 号、端口、权重路径：

```bash
bash serve/setup_backend.sh /opt/venv-vllm
PATH=/opt/venv-vllm/bin:$PATH bash sdk/start_engine.sh 0 18499 /path/to/weights
```

或手动执行等价命令：

```bash
python3 -m venv /opt/venv-vllm && source /opt/venv-vllm/bin/activate
pip install vllm

vllm serve /path/to/weights \
  --served-model-name minicpm-ocr-jev \
  --runner pooling --convert classify \
  --hf-overrides '{"num_labels": 2}' \
  --limit-mm-per-prompt '{"image": 2}' \
  --chat-template-content-format openai \
  --gpu-memory-utilization 0.80 \
  --host 127.0.0.1 --port 18499
```

- `--hf-overrides '{"num_labels": 2}'`：权重的 `config.json` 没写 `num_labels`，必须显式给出。不要同时覆盖 `architectures`。
- `--chat-template-content-format openai`：必须加。取默认值时图文顺序与训练时不符，而请求照样返回 200、分数照样落在合理区间。
- `--limit-mm-per-prompt '{"image": 2}'`：每个请求固定带原图与渲染图两张图。
- 不要加 `--chat-template`：SDK 发送交错 content list，由模型自带的 `chat_template.jinja` 渲染成训练 prompt。

---

## 二、不带渲染器服务

你已经有渲染图，只要分数。

### 安装

```bash
python3 -m venv /opt/venv-score
source /opt/venv-score/bin/activate
pip install "fastapi>=0.110" "uvicorn>=0.27" "httpx>=0.27" "pydantic>=2.6" "PyYAML>=6.0" "Pillow==12.3.0"
```

**依赖版本参考**

```text
python        3.12.3
fastapi       0.162.0
uvicorn       0.54.0
httpx         0.28.1
pydantic      2.14.1
PyYAML        6.0.3
Pillow        12.3.0
```

### 启动

参数依次为服务端口、引擎地址：

```bash
PATH=/opt/venv-score/bin:$PATH bash sdk/start_score.sh 18501 http://127.0.0.1:18499
```

服务启动时会自检一遍 prompt，见 [四、启动自检](#四启动自检)。

### 接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/healthz` | 服务状态、引擎实际服务的模型名、prompt 模板指纹与自检结论 |
| POST | `/v1/score` | 给一批已渲染好的候选打分 |

### 请求

```bash
curl -s http://127.0.0.1:18501/v1/score -H 'Content-Type: application/json' -d '{
  "items": [{"original_image": "<base64>", "render_image": "<base64>", "ocr_text": "..."}]
}'
```

```json
{"results": [{"prob_1": 0.00227, "error": null}]}
```

三个字段都是必填：`original_image` 是原始块图的 base64，`render_image` 是该候选渲染回图片后的 base64，`ocr_text` 是候选文本本身。base64 **不带** `data:image/png;base64,` 前缀，与镜像接口不同。

### 字段与限额

- `ocr_text` 原样送进模型，不做任何清洗。
- `prob_1` 是 `softmax(logits)[1]`，不带阈值、不带标签、不回 logits。
- 一次最多 64 条（`JEV_MAX_ITEMS` 可调），超限返回 413；空批返回空结果。这个数是防止单请求塞进过多图片的保护上限，不是推荐批大小。
- 图片 base64 解不开时整批返回 422，并指出是第几条的哪个字段；打分阶段的失败只影响那一条，它在自己那一格里带上 `error`、`prob_1` 为 `null`。

---

## 三、内置渲染器服务

你只有候选文本，让服务渲染完再打分。precheck、render、forward 三个阶段都在这个进程里完成。

本服务在进程内直接调用打分层，**不需要另外起一个不带渲染器服务**，也不需要给它留端口。

### 安装

```bash
bash sdk/setup_render.sh /opt/venv-render
```

它装 Node、CJK 字体、Chromium 与服务依赖。慢网下设两个镜像源：

```bash
PIP_INDEX_URL=https://<mirror>/simple \
PLAYWRIGHT_DOWNLOAD_HOST=https://<mirror>/playwright \
    bash sdk/setup_render.sh /opt/venv-render
```

### 启动

参数依次为服务端口、引擎地址：

```bash
PATH=/opt/venv-render/bin:$PATH bash sdk/start_render_score.sh 18500 http://127.0.0.1:18499
```

必须用 `/opt/venv-render` 这个解释器启动，本进程在自己进程里渲染。渲染进程数量由 `RM_RENDER_BROWSERS` 控制；服务只起一个 worker，要提吞吐请调这个变量而不是加 worker。

### 接口

端点与字段名与 Docker 镜像完全一致，调用方在镜像与 SDK 之间切换时不必改任何字段：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/healthz` | 同上，另报支持的 `input_form` |
| POST | `/v1/rm/score` | 给一批「原图 + 候选文本」逐条打分，返回分数与汇总 |
| POST | `/v1/rm/score_best` | 一个块内多个候选，选出最优 |
| POST | `/v1/rm/score_best_batch` | 多个块各自选优，一次提交 |

完整字段定义见 [Docker 镜像 API 参考](./minicpm_ocr_jev_docker_api_zh.md)，那份文档描述的就是本服务的同名端点。

### 请求

块内选优：

```bash
curl -s http://127.0.0.1:18500/v1/rm/score_best -H 'Content-Type: application/json' -d '{
  "input_form": "ternary",
  "case_id": "block_01",
  "image": "<base64 原始块图>",
  "category": "text",
  "candidates": ["候选 A", "候选 B"]
}'
```

```json
{"best_index": 1, "best_text": "候选 B", "scores": [0.00589, 0.99509],
 "verdicts": ["scored", "scored"],
 "stage_sec": {"render_sec": 0.31, "forward_sec": 0.02, "total_sec": 0.34},
 "batch_size": 2}
```

- `input_form` 目前只有 `ternary` 一个取值，必须显式传。
- `category` 必须与块真实类型一致（`text` / `formula` / `table`），填错不报错但分数会偏。
- 传 `render_images` 则跳过服务端渲染，其长度必须与 `candidates` 一致。
- 一次最多 64 个候选（`RM_MAX_ITEMS` 可调），同样是保护上限而非推荐批大小。三个端点都按**候选数**算、不按块数：`score_best_batch` 数的是所有块的候选总和，每块 3 个候选时 64 只够 21 个块。

### 汇总里的两个比率

`pass_rate` 与 `throughput_rate` 是两件事：前者是打分成功率（`scored / total`，与阈值无关），后者是过阈率（`prob_yes >= RM_THRESHOLD` 的条数 / total，阈值默认 0.5，可配）。阈值只参与这个比率的计算，任何一条的 `prob_yes` 都按原值返回。

---

## 四、启动自检

两种服务在接第一个请求之前都会校一遍引擎拼出的 prompt，如果引擎启动参数被改动导致prompt结构发生变化，会导致自检失败。

起服后查 `/healthz`，`status` 为 `ok` 即正常：

```bash
curl -s http://127.0.0.1:18501/healthz
```

```json
{"status": "ok", "served_model": "minicpm-ocr-jev",
 "prompt": {"template_md5": "9aab68e8ba8ab4da17ba9752bddb199c",
            "last_token": 271, "expected_last_token": 271,
            "token_equality": "skipped",
            "notes": ["token-for-token comparison skipped: ..."]}}
```

只看 `status`：`ok` 就是自检通过、服务可用，`prompt` 下的其余字段是自检留下的明细，照上面的样子即为正常。`status` 不是 `ok` 时，`prompt.notes` 写明是哪一项没过。
