# SDK 本地部署：llama.cpp 后端

[English](llamacpp_deploy_jev_en.md)

[← 返回使用教程](./minicpm_ocr_jev_tutorial_zh.md)

本文介绍SDK部署模式下，以 llama.cpp 的 `llama-server` 作为前向引擎时，**不带渲染器服务**与**内置渲染器服务**的安装、启动、接口与请求格式。

llama.cpp 是 C++ 实现的轻量推理后端。与其他后端的两点不同：模型要先转成 GGUF 格式；prompt 由引擎按烘在 GGUF 里的模板自己拼，不由 SDK 拼。

两种服务共用同一个前向引擎，区别只在渲染图从哪里来：

|      | 不带渲染器服务                    | 内置渲染器服务                                     |
| ---- | -------------------------- | ------------------------------------------- |
| 渲染图  | 由你提供                       | 服务默认自己渲染（也可由你提供）                            |
| 渲染环境 | **不需要**，无 Chromium、Node、字体 | 需要                                          |
| 接口   | `/v1/score`，返回 `prob_1`    | `/v1/rm/score*`，返回 `prob_yes`，与 Docker 镜像同构 |
| 功能   | 逐条打分                       | 逐条打分、块内选优、批量选优，带 precheck                   |
| 启动脚本 | `sdk/start_score.sh`       | `sdk/start_render_score.sh`                 |

## 部署流程

1. 编引擎 → 转 GGUF → 起前向引擎（两种服务都要）
2. 二选一：
   - **不带渲染器服务** → 装服务环境 → 起服务
   - **内置渲染器服务** → 装渲染环境 → 起服务

引擎与服务必须装在两个虚拟环境里，不要合并。以下命令都在 `scripts/minicpm-ocr-jev/` 目录下执行。

## 环境要求

- **GPU**：NVIDIA，显存 ≥8GB
- **驱动**：≥535
- **CUDA Toolkit**：≥12.0
- **CMake**：≥3.14
- **C++ 编译器**：支持 C++17（GCC ≥9）
- **Python**：≥3.10
- **llama.cpp**：最新稳定版
- **固定版本**：`Pillow` 12.3.0、`playwright` 1.62.0（仅内置渲染器服务）

---

## 一、前向引擎

### 编译

```bash
git clone https://github.com/ggml-org/llama.cpp.git && cd llama.cpp
cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build -j --target llama-server
pip install -r requirements/requirements-convert_hf_to_gguf.txt
```

最后一行装的是转 GGUF 要用的 Python 依赖，清单随 llama.cpp 仓库一起下来，装进来的是：

```text
torch           2.11.0   （取自 download.pytorch.org/whl/cpu，转换不用 GPU）
transformers    4.57.6
numpy           ~=2.2.6
sentencepiece   >=0.1.98,<0.3.0
gguf            >=0.1.0
protobuf        >=4.21.0,<5.0.0
```

这些只在转换时用到，与下面两个服务的虚拟环境互不相干，装在哪个环境里都可以。

### 转 GGUF

语言模型与视觉编码器（`mmproj`）各转一份。权重目录里必须有 `minicpm_ocr_jev.json`，转换器靠它认出这是 MiniCPM-OCR Jev：

```bash
echo '{}' > ./models/MiniCPM-OCR-Jev/minicpm_ocr_jev.json

python convert_hf_to_gguf.py ./models/MiniCPM-OCR-Jev \
  --outtype bf16 --outfile ./models/MiniCPM-OCR-Jev-bf16.gguf

python convert_hf_to_gguf.py ./models/MiniCPM-OCR-Jev --mmproj \
  --outtype bf16 --outfile ./models/mmproj-MiniCPM-OCR-Jev-bf16.gguf
```

### 启动

```bash
./build/bin/llama-server \
  -m ./models/MiniCPM-OCR-Jev-bf16.gguf \
  --mmproj ./models/mmproj-MiniCPM-OCR-Jev-bf16.gguf \
  -ngl 99 \
  -c 32768 \
  --port 18499
```

- `--mmproj`：视觉编码器那份 GGUF，不给就只有文本通路，两张图进不去。
- `-ngl 99`：把全部层放到 GPU 上。
- `-c 32768`：上下文长度，由并行槽位共享。
- `-np N`：并行处理 N 个请求。

每个请求是一次前向，不生成任何 token。每个请求固定两张图：先原图、后渲染图；模型没有 LM head，文本生成类端点不可用。

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

`JEV_BACKEND_CONFIG` 指向 llama.cpp 的后端配置，参数依次为服务端口、引擎地址：

```bash
JEV_BACKEND_CONFIG=sdk/backends/llamacpp.yaml \
PATH=/opt/venv-score/bin:$PATH bash sdk/start_score.sh 18501 http://127.0.0.1:18499
```

不设 `JEV_BACKEND_CONFIG` 时服务按 vLLM 协议发请求，端点对不上，起服即失败。

服务启动时会自检一遍，见 [四、启动自检](#四启动自检)。

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

三个字段都是必填：`original_image` 是原始块图的 base64，`render_image` 是该候选渲染回图片后的 base64，`ocr_text` 是候选文本本身。base64 **不带** `data:image/png;base64,` 前缀，与镜像接口不同。

### 字段与限额

- `ocr_text` 原样送进模型，不做任何清洗。
- `prob_1` 是该候选与原图一致的概率，不带阈值、不带标签。
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
JEV_BACKEND_CONFIG=sdk/backends/llamacpp.yaml \
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

prompt 由引擎按烘在 GGUF 里的模板拼，从服务这一侧读不到，所以 prompt 这一项**自检不作校验、如实报告**，服务照常启动。能校的是另一项：用一张 1×1 的图真打一次前向，确认引擎按分类模型返回了 2 个数而不是一串隐藏层输出。

起服后查 `/healthz`，`status` 为 `ok` 即正常：

```bash
curl -s http://127.0.0.1:18501/healthz
```

```json
{"status": "ok", "served_model": "MiniCPM-OCR-Jev-bf16",
 "prompt": {"template_md5": "9aab68e8ba8ab4da17ba9752bddb199c",
            "source": "server_template",
            "last_token": null, "expected_last_token": 271,
            "token_equality": "skipped", "forward_shape": "2 probabilities",
            "notes": ["this engine builds the prompt from a template of its own that cannot be read from here ..."]}}
```

只看 `status`：`ok` 就是自检通过、服务可用，`prompt` 下的其余字段是自检留下的明细，照上面的样子即为正常。`status` 不是 `ok` 时，`prompt.notes` 写明是哪一项没过。

`source` 为 `server_template`、`last_token` 为 `null`、`token_equality` 为 `skipped`，这三项在本后端下就是正常值，不是故障。由此带来的一个口径后果：这条腿分数的尺度，只能靠与已知后端对同一批输入比对来确立。
