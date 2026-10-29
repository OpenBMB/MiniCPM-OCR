# SDK 本地部署：SGLang 后端

[English](sglang_deploy_jev_en.md)

[← 返回使用教程](./minicpm_ocr_jev_tutorial_zh.md)

本文介绍SDK部署模式下，以 SGLang 作为前向引擎时，**不带渲染器服务**与**内置渲染器服务**的安装、启动、接口与请求格式。

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

引擎与服务必须装在两个虚拟环境里，不要合并。

## 环境要求

- **GPU**：NVIDIA，显存 ≥16GB
- **驱动**：≥535
- **Python**：≥3.10
- **SGLang**：最新稳定版
- **固定版本**：`Pillow` 12.3.0、`playwright` 1.62.0（仅内置渲染器服务）

**CUDA toolkit**：要在系统里装一套完整的，版本与 PyTorch 所用的 CUDA 版本一致（如 PyTorch 为 cu130，则装 CUDA 13.0）。装在 `/usr/local/cuda`，或另设 `CUDA_HOME` 指向它：

```bash
export CUDA_HOME=/path/to/cuda
export PATH=$CUDA_HOME/bin:$PATH
```

虚拟环境里由 pip 装进来的 `nvidia-*` 包不能代替它。

**系统包**：`gcc`、`g++`、`python3-dev` 是 runtime 依赖，装完不要删除。

```bash
sudo apt-get install -y python3 python3-venv python3-pip curl gcc g++ python3-dev
```

引擎环境要装 8–9 GB 依赖，慢网下先给 pip 指一个就近镜像：

```bash
export PIP_INDEX_URL=https://mirrors.ustc.edu.cn/pypi/simple
```

---

## 一、前向引擎

```bash
python3 -m venv /opt/venv-sglang && source /opt/venv-sglang/bin/activate
pip install "sglang[all]"
```

启动：

```bash
cd scripts/minicpm-ocr-jev/
python -m sglang.launch_server \
  --model-path ./models/MiniCPM-OCR-Jev \
  --is-embedding \
  --json-model-override-args '{"architectures": ["Qwen3_5VLForSequenceClassification"]}' \
  --port 18499
```

- `--is-embedding`：走池化路径而不是文本生成。不加则没有 `/classify` 可调。
- `--json-model-override-args`：权重的 `config.json` 写的是生成类 `Qwen3_5ForConditionalGeneration` 时需要它，覆盖成分类类才会返回 value head 的两个 logit；不加则没有 score 头，`--is-embedding` 的池化路径直接返回 2048 维（`hidden_size`）hidden state。这是加载期覆盖，不改动磁盘上的权重文件。`config.json` 本身已写 `Qwen3_5VLForSequenceClassification` 时，这一项可以省略。
- 类别数取自 `config.json`：有 `id2label` 则用 `len(id2label)`，否则用 `num_labels`，两者都没有时按 2 类处理。
- 不要加 `--chat-template`：SGLang 不套模板，SDK 直接把拼好的整串 prompt 发过去。

起服后确认引擎就绪：

```bash
curl http://127.0.0.1:18499/health
```

两项限制：模型没有 `lm_head`，不支持投机解码；`/v1/classify` 不接受图片，要用 `/classify`。

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

`JEV_BACKEND_CONFIG` 指向 SGLang 的后端配置，参数依次为服务端口、引擎地址：

```bash
cd scripts/minicpm-ocr-jev/
JEV_BACKEND_CONFIG=sdk/backends/sglang.yaml \
PATH=/opt/venv-score/bin:$PATH bash sdk/start_score.sh 18501 http://127.0.0.1:18499
```

不设 `JEV_BACKEND_CONFIG` 时服务按 vLLM 协议发请求，连的是 SGLang 也不会报错，但分数不可用。

服务启动时会自检一遍 prompt，见 [四、启动自检](#四启动自检)。

### 接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/healthz` | 服务状态、引擎实际服务的模型、prompt 模板指纹与自检结论 |
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

三个字段都是必填：`original_image` 是原始块图的 base64，`render_image` 是该候选渲染回图片后的 base64，`ocr_text` 是候选文本本身。base64 **不带** `data:image/png;base64,` 前缀，与镜像接口一致。

### 字段与限额

- `ocr_text` 原样送进模型，不做任何清洗。
- `prob_1` 是 `softmax(logits)[1]`，不带阈值、不带标签、不回 logits。
- 一次最多 64 条（`JEV_MAX_ITEMS` 可调），超限返回 413；空批返回空结果。这个数是防止单请求塞进过多图片的保护上限，不是推荐批大小。
- 图片 base64 解不开时整批返回 422，并指出是第几条的哪个字段；打分阶段的失败只影响那一条，它在自己那一格里带上 `error`、`prob_1` 为 `null`。

---

## 三、内置渲染器服务

你只有候选文本，让服务渲染完再打分。precheck、render、forward 三个阶段都在这个进程里完成。

### 安装

```bash
cd scripts/minicpm-ocr-jev/
bash sdk/setup_render.sh /opt/venv-render
```

它装 Node、CJK 字体、Chromium 与服务依赖。慢网下设两个镜像源：

```bash
cd scripts/minicpm-ocr-jev/
PIP_INDEX_URL=https://mirrors.ustc.edu.cn/pypi/simple \
PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright \
    bash sdk/setup_render.sh /opt/venv-render
```

### 启动

参数依次为服务端口、引擎地址：

```bash
cd scripts/minicpm-ocr-jev/
JEV_BACKEND_CONFIG=sdk/backends/sglang.yaml \
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

SGLang 不套模板，整串 prompt 由 SDK 这一侧拼好后发出。因此自检校的是**即将发出的那个字符串**：它必须与 `build_prompt()` 的输出逐字符相同，随行的图片恰为两张。自检还会用一张 1×1 的图真打一次前向，确认引擎返回的是 2 个 logit 而不是 hidden state。

起服后查 `/healthz`，`status` 为 `ok` 即正常：

```bash
curl -s http://127.0.0.1:18501/healthz
```

```json
{"status": "ok", "served_model": "/path/to/weights",
 "prompt": {"template_md5": "9aab68e8ba8ab4da17ba9752bddb199c",
            "source": "client",
            "last_token": 271, "expected_last_token": 271,
            "token_equality": "equal", "forward_shape": "2 logits",
            "notes": ["the prompt we send matches build_prompt() character for character ..."]}}
```

只看 `status`：`ok` 就是自检通过、服务可用，`prompt` 下的其余字段是自检留下的明细，照上面的样子即为正常。`status` 不是 `ok` 时，`prompt.notes` 写明是哪一项没过。

`served_model` 是引擎启动时的权重路径（SGLang 按路径标识模型，一个进程只服务一个模型）。本机没有权重目录或没装 `transformers` 时，`token_equality` 为 `skipped`，这是跳过不是失败，`notes` 会说明原因。

### 用自带用例验证

自检只确认服务起得来。要确认分数也对，用 `examples/` 下三个用例打一遍，与 `case.json` 里的参考分数 `observed_prob_yes` 对照：

```bash
cd scripts/minicpm-ocr-jev
python3 - <<'EOF'
import base64, json, urllib.request
for name in ("01_text_putnam", "02_formula_putnam", "03_table_gb_standard"):
    c = json.load(open(f"examples/{name}/case.json"))
    role = c["reference_render_of"]
    text = next(x["text"] for x in c["candidates"] if x["role"] == role)
    b64 = lambda f: base64.b64encode(open(f"examples/{name}/{f}", "rb").read()).decode()
    body = {"items": [{"original_image": b64(c["block_image"]),
                       "render_image": b64(c["reference_render"]), "ocr_text": text}]}
    req = urllib.request.Request("http://127.0.0.1:18501/v1/score",
            data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    got = json.load(urllib.request.urlopen(req))["results"][0]["prob_1"]
    print(f"{name:24} got {got:.5f}  reference {c['observed_prob_yes'][role]:.5f}")
EOF
```

三行分数与参考值相差都在 0.02 以内即为正常。内置渲染器服务把端点换成 `/v1/rm/score_best`、请求体换成 `image` ＋ `candidates`（见[三、内置渲染器服务 · 请求](#请求-1)），服务会自己渲染。
