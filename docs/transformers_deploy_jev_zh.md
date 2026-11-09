# SDK 本地部署：PyTorch Transformers 后端

[English](transformers_deploy_jev_en.md)

[← 返回使用教程](./minicpm_ocr_jev_tutorial_zh.md)

本文介绍SDK部署模式下，以 PyTorch Transformers 作为前向后端时，**不带渲染器服务**与**内置渲染器服务**的安装、启动、接口与请求格式。

两种服务区别只在渲染图从哪里来：

|      | 不带渲染器服务                    | 内置渲染器服务                                     |
| ---- | -------------------------- | ------------------------------------------- |
| 渲染图  | 由你提供                       | 服务默认自己渲染（也可由你提供）                            |
| 渲染环境 | **不需要**，无 Chromium、Node、字体 | 需要                                          |
| 接口   | `/v1/score`，返回 `prob_1`    | `/v1/rm/score*`，返回 `prob_yes`，与 Docker 镜像同构 |
| 功能   | 逐条打分                       | 逐条打分、块内选优、批量选优，带 precheck                   |
| 启动脚本 | `sdk/start_score.sh`       | `sdk/start_render_score.sh`                 |

## 部署流程

1. 装环境（含模型依赖）
2. 二选一：
   - **不带渲染器服务** → 起服务
   - **内置渲染器服务** → 追加渲染依赖 → 起服务

**本后端不单独启动前向引擎**，这是它与 vLLM、SGLang、llama.cpp、Ollama 四种后端在部署步骤上唯一的区别，详见[一、没有单独的前向引擎](#一没有单独的前向引擎)。

## 环境要求

|          | Linux                                 | macOS                              |
| -------- | ------------------------------------- | ---------------------------------- |
| 加速器      | NVIDIA GPU，显存 ≥8GB                    | Apple Silicon（M 系列），统一内存 ≥16GB     |
| 驱动       | ≥535                                  | 随系统                                |
| Python   | ≥3.10                                 | ≥3.10                              |
| 计算后端     | CUDA（torch 自带运行时）                     | Metal（MPS，torch 自带）                |

- **transformers**：≥5.19
- **torch**：≥2.13（Linux 实测 2.13.0+cu130，macOS 实测 2.15.0）
- **torchvision**：必装，见[安装](#安装)小节说明
- **CUDA toolkit**：**不需要**，torch 自带 GPU 运行时
- **固定版本**：`Pillow` 12.3.0、`playwright` 1.62.0（仅内置渲染器服务）

模型权重常驻显存约 4.2 GB（bfloat16）。

**系统包**：

```bash
sudo apt-get install -y python3 python3-venv python3-pip curl
```

慢网下先给 pip 指一个就近镜像：

```bash
export PIP_INDEX_URL=https://mirrors.ustc.edu.cn/pypi/simple
```

---

## 一、没有单独的前向引擎

另外四种后端都是独立进程：先起引擎，再起服务，服务通过 HTTP 把图文发给引擎。本后端把权重直接加载进服务进程，没有第二个进程、也没有引擎端口。

由此带来四点，决定了它适合用在什么地方：

- **默认一次只做一次前向**。这是有意的取舍：权重与服务在同一进程、同一张卡上，并发的前向竞争的是显存，超出不是排队等待而是显存耗尽；固定成一次，服务端就不必自己实现攒批与显存预算，起成服务的形态也最简单。并发请求在服务内排队逐个执行。
- **要吞吐就加宽单次前向，而不是加并发**。`max_batch_size` 让一次前向算多个候选。实测 24 个候选（RTX 5090，bfloat16）：批 1 耗时 2.17 秒，批 4 降到 0.94 秒（2.3 倍），批 8 为 0.89 秒、收益已趋平；峰值显存从 4347 MiB 升到 4962 MiB。本后端仍然没有引擎那样的跨请求连续批处理，**单机高吞吐场景请用 vLLM 或 SGLang 后端**。
- **服务进程即模型进程**。显存不足会终止整个服务，而不只是引擎。
- **可在 Apple Silicon 上运行**，`device: auto` 会自动选用 Metal（MPS）。另外四种后端里只有 llama.cpp 与 Ollama 能在 macOS 上运行，且需要 GGUF 格式权重；本后端直接读取原始 bfloat16 权重。

配置文件 `sdk/backends/transformers.yaml` 指向权重目录，而不是引擎地址：

```yaml
engine: transformers
model_path: /path/to/weights
device: auto          # auto 依次尝试 cuda:0、mps、cpu
dtype: auto           # auto 在 cuda 与 mps 上为 bfloat16，cpu 上为 float32
attn_implementation: sdpa
max_in_flight: 1
max_batch_size: 1
```

- `model_path` 必填，且与 `base_url` 互斥：本后端没有可指向的引擎地址，同时给出 `base_url` 会在启动时报错。
- `dtype` 保持 `auto`。在 Apple Silicon 上实测，一次前向 bfloat16 耗时 0.3 秒、float32 耗时 38 秒，而 float32 与参考分数的偏差反而更大。
- `attn_implementation` 保持 `sdpa`。实测 12 个样例，`sdpa` 与参考分数相差在 4.4e-3 以内、`flash_attention_2` 为 7.6e-3，后者超出本权重发布分数所在的 5e-3 区间。
- `max_in_flight` 保持 1，含义是同时进行的前向次数。填大于 1 的值会在启动时降回 1，并在 `/healthz` 的 `prompt.notes` 里留一条说明。
- `max_batch_size` 是**一次前向里的候选数**，默认 1，调大即可提吞吐，上面那组实测就是这一项从 1 改到 8 的结果。一次请求里超出的候选不会被丢弃，排进下一次前向。

---

## 二、不带渲染器服务

你已经有渲染图，只要分数。

### 安装

```bash
cd scripts/minicpm-ocr-jev/
python3 -m venv /opt/venv-transformers
source /opt/venv-transformers/bin/activate
pip install -r sdk/requirements-transformers.txt
```

等价的逐包命令：

```bash
pip install "Pillow==12.3.0" "transformers>=5.19" "torch>=2.13" torchvision \
            "fastapi>=0.110" "uvicorn>=0.27" "httpx>=0.27" "pydantic>=2.6" "PyYAML>=6.0"
```

- `Pillow` 写在最前且为精确版本。它决定了超过 199:1 的长条块图补白后的像素，版本变化会改变分数。`transformers` 与 `torch` 只给下界，装在同一环境时 pip 不会把 `Pillow` 推高。
- `torchvision` 与视频无关：`AutoProcessor` 会按权重目录里的 `processor_config.json` 构建一个视频处理器，该类在构建时导入 torchvision。缺它会在启动阶段报 Torchvision 缺失。
- **不需要** `accelerate`：本后端用 `.to(device)` 放置模型，不做跨卡切分。
- **不需要** `causal_conv1d`、`flash-linear-attention`：缺少这两个可选算子库时，transformers 会在每次启动时提示回落到参考实现（"correct but much slower"）。本文给出的全部分数即在不装它们的环境下测得，装它们是为了提速。

**依赖版本参考**

```text
python        3.12.3
torch         2.13.0+cu130
transformers  5.19.0
torchvision   0.29.2
fastapi       0.162.0
uvicorn       0.54.0
httpx         0.28.1
pydantic      2.14.1
PyYAML        6.0.3
Pillow        12.3.0
```

### 启动

参数只有服务端口，不带引擎地址：

```bash
cd scripts/minicpm-ocr-jev/
PATH=/opt/venv-transformers/bin:$PATH \
JEV_BACKEND_CONFIG=sdk/backends/transformers.yaml \
    bash sdk/start_score.sh 18501
```

必须用装了 torch 的那个解释器启动，权重由本进程加载。服务只起一个 worker：每个 worker 都会各加载一份权重。

服务启动时会自检一遍 prompt，见 [四、启动自检](#四启动自检)。

### 接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/healthz` | 服务状态、所加载的权重目录、prompt 模板指纹与自检结论 |
| POST | `/v1/score` | 给一批已渲染好的候选打分 |

### 请求

```bash
curl -s http://127.0.0.1:18501/v1/score -H 'Content-Type: application/json' -d '{
  "items": [{"original_image": "<base64>", "render_image": "<base64>", "ocr_text": "..."}]
}'
```

```json
{"results": [{"prob_1": 0.00280, "error": null}]}
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

本后端的权重与渲染器在同一个进程里，所以两套依赖要装进**同一个**虚拟环境。在上一节那个环境里追加渲染依赖：

```bash
cd scripts/minicpm-ocr-jev/
source /opt/venv-transformers/bin/activate
pip install "playwright==1.62.0" "Markdown==3.10.3"
playwright install chromium
sudo apt-get install -y nodejs fonts-noto-cjk
```

慢网下 Chromium 走镜像：

```bash
PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright \
    playwright install chromium
```

装完核对一次 `Pillow` 仍是 12.3.0：

```bash
python3 -c "import PIL; print(PIL.__version__)"
```

渲染器与模型共用一个环境时，`Pillow` 的精确版本要由你守住。它决定渲染图的像素，而渲染图是模型的输入之一。

### 启动

参数只有服务端口，不带引擎地址：

```bash
cd scripts/minicpm-ocr-jev/
PATH=/opt/venv-transformers/bin:$PATH \
JEV_BACKEND_CONFIG=sdk/backends/transformers.yaml \
    bash sdk/start_render_score.sh 18500
```

渲染进程数量由 `RM_RENDER_BROWSERS` 控制；服务只起一个 worker，要提吞吐请调这个变量而不是加 worker。

### 接口

端点与字段名与 Docker 镜像完全一致，调用方在镜像与 SDK 之间切换时不必改任何字段：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/healthz` | 同上，另报支持的 `input_form` 与渲染池状态 |
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
{"best_index": 0, "best_text": "候选 A", "scores": [0.99524, 0.00610],
 "verdicts": ["scored", "scored"],
 "stage_sec": {"render_sec": 0.33, "forward_sec": 0.31, "total_sec": 0.65},
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

两种服务在接第一个请求之前都会校一遍送进模型的 prompt。

起服后查 `/healthz`，`status` 为 `ok` 即正常：

```bash
curl -s http://127.0.0.1:18501/healthz
```

```json
{"status": "ok", "served_model": "/path/to/weights",
 "prompt": {"template_md5": "9aab68e8ba8ab4da17ba9752bddb199c",
            "source": "client",
            "last_token": 271, "expected_last_token": 271,
            "token_equality": "equal",
            "forward_shape": "2 logits",
            "notes": ["the prompt we send matches build_prompt() ..."]}}
```

只看 `status`：`ok` 就是自检通过、服务可用，`prompt` 下的其余字段是自检留下的明细，照上面的样子即为正常。`status` 不是 `ok` 时，`prompt.notes` 写明是哪一项没过。

本后端的 `token_equality` 为 `equal`，而以 vLLM、SGLang、llama.cpp、Ollama 为后端时该字段为 `skipped`：逐 token 比对需要本机有 tokenizer，而本后端的运行环境必然装了 transformers，这一项因此可以真正执行。

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
