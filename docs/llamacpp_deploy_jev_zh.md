# SDK 本地部署：llama.cpp 后端

[English](llamacpp_deploy_jev_en.md)

[← 返回使用教程](./minicpm_ocr_jev_tutorial_zh.md)

本文介绍SDK部署模式下，以 llama.cpp 的 `llama-server` 作为前向引擎时，**不带渲染器服务**与**内置渲染器服务**的安装、启动、接口与请求格式。

本后端与其他后端有两点不同：模型用 GGUF 格式，官方已发布，直接下载即可；prompt 由引擎按 GGUF 内置的模板自己拼，不由 SDK 拼。

两种服务共用同一个前向引擎，区别只在渲染图从哪里来：

|      | 不带渲染器服务                    | 内置渲染器服务                                     |
| ---- | -------------------------- | ------------------------------------------- |
| 渲染图  | 由你提供                       | 服务默认自己渲染（也可由你提供）                            |
| 渲染环境 | **不需要**，无 Chromium、Node、字体 | 需要                                          |
| 接口   | `/v1/score`，返回 `prob_1`    | `/v1/rm/score*`，返回 `prob_yes`，与 Docker 镜像同构 |
| 功能   | 逐条打分                       | 逐条打分、块内选优、批量选优，带 precheck                   |
| 启动脚本 | `sdk/start_score.sh`       | `sdk/start_render_score.sh`                 |

## 部署流程

1. 编引擎 → 取 GGUF → 起前向引擎（两种服务都要）
2. 二选一：
   - **不带渲染器服务** → 装服务环境 → 起服务
   - **内置渲染器服务** → 装渲染环境 → 起服务

引擎与服务必须装在两个虚拟环境里，不要合并。

## 环境要求

|              | Linux ＋ NVIDIA                                | macOS（Apple Silicon）           |
| ------------ | --------------------------------------------- | ------------------------------ |
| 加速器          | NVIDIA，显存 ≥8GB                                | M 系列芯片，统一内存 ≥16GB              |
| 驱动           | ≥535                                          | 不需要，Metal 由系统提供                |
| CUDA Toolkit | ≥12.0                                         | 不需要                            |
| 编译工具         | CMake ≥3.14、GCC ≥9                            | Xcode Command Line Tools、CMake |
| 后端开关         | `-DGGML_CUDA=ON`                              | 无，Metal 默认启用                   |
| Python       | ≥3.10                                         | ≥3.10，系统自带的是 3.9，须另装           |
| llama.cpp    | ≥ v0.8.0，该版本起含本模型支持                           | 同左                             |
| 固定版本         | `Pillow` 12.3.0、`playwright` 1.62.0（仅内置渲染器服务） | `Pillow` 12.3.0                |

**CUDA Toolkit**（仅 Linux）：确保链接器能找到它的库。装在 `/usr/local/cuda` 之外的路径时，把它注册进 `ldconfig`：

```bash
echo /path/to/cuda/lib64 | sudo tee /etc/ld.so.conf.d/cuda.conf
sudo ldconfig
```

**系统包**：

```bash
# Linux
sudo apt-get install -y python3 python3-venv python3-pip git curl cmake build-essential

# macOS：编译器与 git 来自 Command Line Tools，CMake 另装
xcode-select --install
brew install cmake
```

---

## 一、前向引擎

### 准备源码

编译需要源码树：

```bash
git clone https://github.com/ggml-org/llama.cpp.git && cd llama.cpp
```

### 编译

```bash
cd llama.cpp

# 配置，按平台二选一
# Linux ＋ NVIDIA
cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
# macOS：Metal 后端默认启用，不需要任何额外开关
cmake -B build -DCMAKE_BUILD_TYPE=Release

cmake --build build -j --target llama-server
```

配置日志里要出现 `Including CUDA backend`（Linux）或 `Including METAL backend`（macOS），这一行说明目标后端已启用。

### 取 GGUF

两份都要：语言模型一份，视觉编码器（`mmproj`）一份。官方仓库 [MiniCPM-OCR-Jev-gguf](https://huggingface.co/openbmb/MiniCPM-OCR-Jev-gguf) 已发布，直接下载即可：

```bash
cd llama.cpp
HF_ENDPOINT=https://hf-mirror.com hf download openbmb/MiniCPM-OCR-Jev-gguf \
  --include "MiniCPM-OCR-Jev-F16.gguf" "mmproj-model-f16.gguf" \
  --local-dir ./models
```

- `hf` 命令来自 `huggingface_hub`，没有的话装进任一虚拟环境：`pip install -U "huggingface_hub[cli]"`。
- `F16` 是未量化的完整版本（3.78 GB）。显存或内存吃紧时，把 `--include` 里的语言模型换成量化版本：`Q8_0`（2.01 GB）或 `Q4_K_M`（1.27 GB）——官方卡把前者标为接近无损、后者标为建议的最小档。`mmproj` 只有一个版本，始终用 `mmproj-model-f16.gguf`。
- ModelScope 上有同一个仓库：`OpenBMB/MiniCPM-OCR-Jev-gguf`。
- GGUF 自带 `systemone` 对话模板与决策模型标识，引擎靠它们认出这是打分模型，所以起服时不需要任何模板参数。

### 启动

```bash
cd llama.cpp
./build/bin/llama-server \
  -m ./models/MiniCPM-OCR-Jev-F16.gguf \
  --mmproj ./models/mmproj-model-f16.gguf \
  -ngl 99 \
  -c 32768 \
  --port 18499
```

- `--mmproj`：视觉编码器那份 GGUF，不给就只有文本通路，两张图进不去。
- `-ngl 99`：把全部层放到 GPU 上，macOS 上对应 Metal，写法相同。
- `-c 32768`：上下文长度，由并行槽位共享。
- `-np N`：并行处理 N 个请求。

起服日志里要出现 `decision model type: openbmb-minicpm-ocr-jev` 与 `listening on`，说明引擎认出了这个模型；此时 `curl http://127.0.0.1:18499/health` 返回 `{"status":"ok"}`。

每个请求是一次前向，不生成任何 token。每个请求固定两张图：先原图、后渲染图；模型没有 LM head，文本生成类端点不可用。

---

## 二、不带渲染器服务

你已经有渲染图，只要分数。

### 安装

```bash
# macOS 同样这么装，只是 /opt 要 sudo，换成 ~/venv-score 即可
python3 -m venv /opt/venv-score
source /opt/venv-score/bin/activate
pip install "fastapi>=0.110" "uvicorn>=0.27" "httpx>=0.27" "pydantic>=2.6" "PyYAML>=6.0" "Pillow==12.3.0"
```

**依赖版本参考**（这组版本在 Linux 与 macOS 上一致）

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
cd scripts/minicpm-ocr-jev/
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

三个字段都是必填：`original_image` 是原始块图的 base64，`render_image` 是该候选渲染回图片后的 base64，`ocr_text` 是候选文本本身。base64 **不带** `data:image/png;base64,` 前缀，与镜像接口一致。

### 字段与限额

- `ocr_text` 原样送进模型，不做任何清洗。
- `prob_1` 是该候选与原图一致的概率，不带阈值、不带标签。
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

它装 Node、CJK 字体、Chromium 与服务依赖。

> **这一节是 Linux 专属。** 脚本靠 `apt-get` 装 Node 与 CJK 字体，并把字体环境固定成参考部署那一套；macOS 上这几步都会跳过。而渲染出来的图是模型输入，字体栈换了分数就换，**macOS 上这个服务打出来的分数不能与发布值对照**。macOS 请用上一节的不带渲染器服务（渲染图由你提供），或者改用 Docker 镜像。

慢网下设两个镜像源：

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

prompt 由引擎按 GGUF 内置的模板拼，从服务这一侧读不到，所以 prompt 这一项**自检不作校验、如实报告**，服务照常启动。能校的是另一项：用一张 1×1 的图真打一次前向，确认引擎按分类模型返回了 2 个数而不是一串隐藏层输出。

起服后查 `/healthz`，`status` 为 `ok` 即正常：

```bash
curl -s http://127.0.0.1:18501/healthz
```

```json
{"status": "ok", "served_model": "./models/MiniCPM-OCR-Jev-F16.gguf",
 "prompt": {"template_md5": "9aab68e8ba8ab4da17ba9752bddb199c",
            "source": "server_template",
            "last_token": null, "expected_last_token": 271,
            "token_equality": "skipped", "forward_shape": "2 probabilities",
            "notes": ["this engine builds the prompt from a template of its own that cannot be read from here ..."]}}
```

只看 `status`：`ok` 就是自检通过、服务可用，`prompt` 下的其余字段是自检留下的明细，照上面的样子即为正常。`status` 不是 `ok` 时，`prompt.notes` 写明是哪一项没过。

`source` 为 `server_template`、`last_token` 为 `null`、`token_equality` 为 `skipped`，这三项在本后端下就是正常值，不是故障。由此带来一个后果：本后端分数的尺度，只能靠与已知后端对同一批输入比对来确立。

### 用自带用例验证

本后端的自检不校 prompt（见上），所以这一步不能跳过：用 `examples/` 下三个用例打一遍，与 `case.json` 里的参考分数 `observed_prob_yes` 对照：

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

三行分数与参考值相差都在 0.02 以内即为正常，Linux 与 macOS 同此判据。内置渲染器服务把端点换成 `/v1/rm/score_best`、请求体换成 `image` ＋ `candidates`（见[三、内置渲染器服务 · 请求](#请求-1)），服务会自己渲染 —— 这个变体只在 Linux 上拿来对参考分，原因见该节开头。
