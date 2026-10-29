---
name: minicpm-ocr-jev-deploy
description: 安装、部署和验证 MiniCPM-OCR Jev 打分服务，两条路径——Docker 镜像，或 SDK 本地部署（vLLM / SGLang / llama.cpp / Ollama 四个推理后端）。在用户要起 Jev 打分服务、部署 Jev 镜像或 SDK、给 OCR 结果打一致性分数或在多个候选里选优、排查起服与打分报错时使用。
---

# MiniCPM-OCR Jev 本地部署

Jev 判断一段 OCR 文本与原图是否一致：送原图与候选文本，返回 0–1 的一致性分数。

部署有两条路径，用同一个模型、同一套打分逻辑：**Docker 镜像**一个容器里装齐引擎、打分服务与渲染环境；**SDK** 把渲染器与模型服务分开装在主机上——引擎做前向，服务层做打分，两者必须在不同的虚拟环境里。

本文的命令与 `docs/minicpm_ocr_jev_tutorial_zh.md`、`docs/minicpm_ocr_jev_docker_api_zh.md`、`docs/{vllm,sglang,llamacpp,ollama}_deploy_jev_zh.md` 同源，每节都标了对应文档的小节；改任一方需同步。

## 1. 确定方案

### 1.1 先定走哪条路径

| | Docker 镜像（1.2） | SDK（1.3 起） |
|---|---|---|
| 渲染环境 | 镜像内置固定版本的 Chromium 与 CJK 字体 | 自己装（6.2），或由调用方提供渲染图（6.1） |
| 分数口径 | 与云端 API 同一套渲染环境，可直接与发布数字对照 | 排序稳定，绝对值可能差在小数点后第三位 |
| 要装什么 | Docker ＋ NVIDIA Container Toolkit | 两个虚拟环境：引擎 ＋ 服务层 |
| 推理后端 | 镜像内固定 vLLM | vLLM / SGLang / llama.cpp / Ollama 四选一 |
| 平台 | 仅 Linux ＋ NVIDIA | Linux ＋ NVIDIA／macOS（见 1.3） |
| 适合 | 要与发布数字对照、不想自己装渲染环境 | 没有 Docker、在 macOS 上、已有渲染图、或要指定后端 |

机器上有 Docker 和 NVIDIA 卡、用户又没有偏好时走 Docker 镜像。**走 Docker 只需 1.2 ＋ 7.3，外加取权重的第 3 节；第 2、4、5、6、8 节都是 SDK 路径的步骤。**

### 1.2 Docker 镜像（对应 `minicpm_ocr_jev_tutorial_zh.md` 方式一）

前置：Docker 与 NVIDIA Container Toolkit 已装（`docker run --rm --gpus all ubuntu nvidia-smi` 能打印出卡即算通）、驱动 ≥535、显存 ≥12 GB、权重 `<WEIGHTS>` 已按第 3 节取好。

```bash
cd scripts/minicpm-ocr-jev
docker build -f serve/Dockerfile -t minicpm-ocr-jev-1-0:latest .

docker run -d --name minicpm-ocr-jev --gpus '"device=<GPU>"' \
    -p 127.0.0.1:8030:8030 \
    -v <WEIGHTS>:/weights:ro \
    minicpm-ocr-jev-1-0:latest 8030 /weights
```

慢网下构建时加 `--build-arg PIP_INDEX_URL=<镜像源>` 与 `--build-arg PLAYWRIGHT_DOWNLOAD_HOST=<镜像源>`（可用值见第 3 节）。

通过标准：`curl -f http://127.0.0.1:8030/healthz` 的 `status` 为 `ok`。`loading` 是还在加载权重，此时打分返回 503，等它转成 `ok`。

打分：

```bash
curl -s http://127.0.0.1:8030/v1/rm/score -H 'Content-Type: application/json' -d '{
  "input_form": "ternary",
  "items": [
    {"case_id": "blk-001", "image": "<base64>",
     "ocr_text": "待评分的 OCR 文本", "category": "text"}
  ]
}'
```

四个端点：`/healthz`、`/v1/rm/score`（逐块各打一分）、`/v1/rm/score_best`（单块 N 候选选优）、`/v1/rm/score_best_batch`（多块各自选优，块多时用它）。完整字段定义见 `minicpm_ocr_jev_docker_api_zh.md`，调用时要守的几条：

- `input_form` 固定 `"ternary"`，`score_best_batch` 的每个 item 里还要再带一次，缺了返回 422。
- `image` 传 PNG／JPEG 的 base64 正文，**不带** `data:image/png;base64,` 前缀；带了该条返回 `encode_error`。
- `category` 三选一 `text` / `formula` / `table`，**必须与块真实类型一致**：公式块送成 `text` 会按字面渲染，不报错但分数失真。
- 用分数前先看 `verdict`：`0.0` 与 `-1.0` 是打分失败的固定返回值，不是低分。
- 已有渲染图时送 `items[].render_image`（`score_best*` 是 `render_images`），服务端就跳过渲染。
- 单次请求候选总数受 `max_items` 限制（默认 64，超出返回 400）；`threshold`（默认 0.5）只影响汇总里的 `throughput_rate`，不改任何一条的 `prob_yes`。

装完按 [7.3](#73-docker-路径用自带用例打分) 用自带用例核分数——`/healthz` 返回 `ok` 只说明服务起来了。

### 1.3 SDK：选后端与渲染形态

走 SDK 再定两件事：**用哪个推理后端**、**渲染图由谁提供**。用户没有偏好时用 vLLM ＋ 内置渲染器。

按渲染图来源分两种形态，用同一个模型、同一套打分代码：

| | 不带渲染器服务 | 内置渲染器服务 |
|---|---|---|
| 渲染图 | 由调用方提供 | 服务自己渲染（也可由调用方提供） |
| 渲染环境 | **不需要**，无 Chromium、Node、字体 | 需要 |
| 接口 | `/v1/score`，返回 `prob_1` | `/v1/rm/score*`，返回 `prob_yes`，与 Docker 镜像同构 |
| 功能 | 逐条打分 | 逐条打分、块内选优、批量选优，带 precheck |
| 启动脚本 | `sdk/start_score.sh` | `sdk/start_render_score.sh` |

四个后端的环境成本相差很大，按用户的约束选：

| 后端 | 系统 CUDA toolkit | 要编译 | 引擎环境体积 | 可用平台 | 适合 |
|---|---|---|---|---|---|
| vLLM | 不需要 | 否 | 8.4 GB | 仅 Linux ＋ NVIDIA | 默认选择，吞吐最好 |
| SGLang | **需要** | 否 | 9.5 GB | 仅 Linux ＋ NVIDIA | 已有 SGLang 技术栈 |
| llama.cpp | **需要**（仅 Linux） | **是** | 214 MB（build） | Linux ＋ NVIDIA／macOS | 显存小、不想装 torch |
| Ollama | 不需要 | 否 | 无（引擎在安装包里） | Linux ＋ NVIDIA／macOS | 要求最轻，已有 Ollama |

- llama.cpp 与 Ollama 用 GGUF 权重，**官方已发布，默认直接下**（见 5.3），不必下 HF 原始权重、也不必装转换环境。只在要换转换参数、或权重是用户自己微调的时候才自己转，那时需要一个 4.8 GB 的转换环境（CPU 版 torch），转完可删。
- Ollama 跑的就是 llama.cpp 的 runner，两者分数同源，**不要拿它们互相验证**。
- ⭐ **用户在 macOS（Apple Silicon）上时只有 llama.cpp 与 Ollama 两条路**：vLLM 与 SGLang 依赖 CUDA 栈，mac 上起不来，不要建议。两者在 mac 上都走 Metal，命令与 Linux 的差别见 5.3／5.4。
- ⭐ **macOS 上只做不带渲染器服务**：内置渲染器服务要固定字体环境，那一步依赖 apt，mac 上做不到（见 6.2）。

## 2. 安装前检查

本节与第 4、5、6、8 节都只适用于 SDK 路径，Docker 路径的前置写在 1.2。

```bash
# Linux ＋ NVIDIA
nvidia-smi                                                      # 驱动 ≥535
nvidia-smi --query-compute-apps=pid,used_memory --format=csv    # 找一张空闲卡
df -h .                                                         # vLLM/SGLang 留 ≥15 GB

# macOS
sysctl -n machdep.cpu.brand_string    # 须为 Apple M 系列
sysctl -n hw.memsize                  # 统一内存 ≥16 GB
xcode-select -p                       # Command Line Tools 已装
python3 -V                            # 系统自带的是 3.9，不够，须另装 ≥3.10
df -h .
```

显存门槛随后端而变：vLLM ≥12 GB，SGLang ≥16 GB，llama.cpp 与 Ollama ≥8 GB。macOS 上对应统一内存 ≥16 GB。

需要用户提供的东西（没有给出时先问，不要猜）：

| 占位符 | 含义 |
|---|---|
| `<WEIGHTS>` | Jev 权重目录的绝对路径；用户没有现成副本时按第 3 节下载。**Docker 路径与 SDK 的 vLLM、SGLang 要它**，SDK 的 llama.cpp 与 Ollama 默认直接下 GGUF（5.3） |
| `<GPU>` | 用哪张卡（先按上面的命令确认它空闲）；macOS 上不适用 |

以下命令都在仓库的 `scripts/minicpm-ocr-jev/` 下执行，虚拟环境建在 `/opt/venv-*`；macOS 上往 `/opt` 写要 sudo，建在 home 目录下即可（`~/venv-*`），后面各处路径跟着换。

## 3. 取源码、权重与系统前置包

部署文档从 `cd scripts/minicpm-ocr-jev/` 开始，前提是本机已有仓库：

```bash
git clone https://github.com/OpenBMB/MiniCPM-OCR.git
cd MiniCPM-OCR/scripts/minicpm-ocr-jev
```

权重＝[MiniCPM-OCR-Jev](https://huggingface.co/openbmb/MiniCPM-OCR-Jev)。**vLLM 与 SGLang 要这份 HF 权重**；llama.cpp 与 Ollama 用 GGUF，默认按 5.3 直接下，本步可跳过。用户已有副本时也跳过，把它的绝对路径当 `<WEIGHTS>`：

```bash
python3 -m venv /opt/venv-dl && /opt/venv-dl/bin/pip install -U "huggingface_hub[cli]"
HF_ENDPOINT=https://hf-mirror.com /opt/venv-dl/bin/hf download openbmb/MiniCPM-OCR-Jev \
  --local-dir ./models/MiniCPM-OCR-Jev
```

- 下完 `<WEIGHTS>` 即 `$PWD/models/MiniCPM-OCR-Jev`，目录应含 `config.json`、`model.safetensors`、`tokenizer.json`、`preprocessor_config.json`、`chat_template.jinja`。
- 已有 `hf` 命令时直接用，不必建 `/opt/venv-dl`；装进系统 Python 会被 PEP 668 拒绝（见第 9 节）。这个 venv 下完即可删。
- ModelScope：`modelscope download --model OpenBMB/MiniCPM-OCR-Jev --local_dir ./models/MiniCPM-OCR-Jev`。

系统包按后端装（对应各文档「环境要求」）：

```bash
# vLLM / SGLang
sudo apt-get install -y python3 python3-venv python3-pip curl gcc g++ python3-dev
# llama.cpp
sudo apt-get install -y python3 python3-venv python3-pip git curl cmake build-essential
# Ollama
sudo apt-get install -y python3 python3-venv python3-pip curl

# macOS ＋ llama.cpp：编译器与 git 来自 Command Line Tools，CMake 另装
xcode-select --install
brew install cmake

# macOS ＋ Ollama：不需要任何系统包，只要有一个 ≥3.10 的 Python
```

- `gcc`、`g++`、`python3-dev` 是 **runtime** 依赖，vLLM 与 SGLang 都在首次前向时现场编译 Triton 扩展，装完不要删。
- 慢网下先给 pip 指一个就近镜像，否则引擎环境的 8–9 GB 依赖会卡死：

```bash
export PIP_INDEX_URL=https://mirrors.ustc.edu.cn/pypi/simple
```

通过标准：`python3 -V` ≥ 3.10，`gcc -dumpversion` 有输出（llama.cpp 另需 `cmake --version` ≥3.14）。macOS 上不查 `gcc -dumpversion`，改查 `xcode-select -p` 有输出。

## 4. 探测上游支持（动手装之前先做）

**四个后端里有两个的本模型支持是晚近才进上游的**，装之前先确认手上这个版本有。探针都是结构性的——查注册表、查源码、查起服自检：

| 后端 | 探什么 | 什么时候能探 |
|---|---|---|
| vLLM | `Qwen3_5ForConditionalGeneration` 在模型注册表里 | `serve/setup_backend.sh` 装完自动报，不必手动探 |
| SGLang | `Qwen3_5VLForSequenceClassification` 在模型注册表里 | 装完 `sglang[all]` 之后 |
| llama.cpp | 源码里有 `COMMON_DECISION_TYPE_MINICPM_OCR_JEV` | **clone 之后、编译之前** |
| Ollama | 起服自检通过 | 装完、转完 GGUF、注册完之后 |

```bash
# SGLang
/opt/venv-sglang/bin/python -c "
from sglang.srt.models.registry import ModelRegistry
print('Qwen3_5VLForSequenceClassification' in ModelRegistry.models)"

# llama.cpp（在 clone 出来的源码树里）
grep -rq COMMON_DECISION_TYPE_MINICPM_OCR_JEV tools/server/ && echo supported || echo NOT
```

⚠ **不要用版本号判断，也不要相信引擎的能力自报**：

- `ollama show` 的 Capabilities 在 runner 完全不支持时**照样报 `decision, vision` 两项全绿**——它读的是 GGUF 元数据，不是 runner 的能力。
- SGLang 的版本号不告诉你架构有没有注册。
- 探针返回 `False` / `NOT` 时走[第 8 节](#8-上游未就位时的临时路径)，**不要删掉已装好的环境**——临时路径复用它。

## 5. 装引擎并启动

四个引擎的端口都用 18499（文档默认值）。一台机器上同时起多个后端时错开端口，并把服务层的引擎地址跟着改。

### 5.1 vLLM（对应 `vllm_deploy_jev_zh.md` 一）

```bash
bash serve/setup_backend.sh /opt/venv-vllm
PATH=/opt/venv-vllm/bin:$PATH bash sdk/start_engine.sh <GPU> 18499 <WEIGHTS>
```

- `setup_backend.sh` 自己会检查系统包，缺了就打印可直接粘贴的 apt 命令并退出。
- 这个脚本不是 `serve/start_vllm.sh`：镜像那条路径传 pass-through 模板、自己拼 prompt，SDK 这条路径发交错 content list、让模型自带模板渲染。混用会被起服自检拦住。

通过标准：装完打印 `Qwen3_5ForConditionalGeneration  registered`；起服日志出现 `Application startup complete.`（首次启动要过 torch.compile 与 CUDA graph，约 2 分钟）。

### 5.2 SGLang（对应 `sglang_deploy_jev_zh.md` 一）

SGLang 要系统装一套完整 CUDA toolkit，**并且让它能被找到**——`deep_gemm` 在 import 期就会去找：

```bash
export CUDA_HOME=/usr/local/cuda          # 或指向实际路径
export PATH=$CUDA_HOME/bin:$PATH

python3 -m venv /opt/venv-sglang && source /opt/venv-sglang/bin/activate
pip install "sglang[all]"
```

虚拟环境里 pip 装进来的 `nvidia-*` 包不能代替系统 toolkit。装完做[第 4 节](#4-探测上游支持动手装之前先做)的 SGLang 探针，再起引擎：

```bash
python -m sglang.launch_server \
  --model-path <WEIGHTS> \
  --is-embedding \
  --json-model-override-args '{"architectures": ["Qwen3_5VLForSequenceClassification"]}' \
  --port 18499
```

- `--is-embedding`：走池化路径，不加就没有 `/classify` 可调。
- `--json-model-override-args`：权重 `config.json` 写的是生成类时需要它，覆盖成分类类才会返回 value head 的两个 logit。`config.json` 本身已写 `Qwen3_5VLForSequenceClassification` 时可省略。
- 不要加 `--chat-template`：SGLang 不套模板，SDK 直接发拼好的整串 prompt。

通过标准：日志出现 `The server is fired up and ready to roll!`；`curl http://127.0.0.1:18499/get_model_info` 里 `architectures` 是 `["Qwen3_5VLForSequenceClassification"]`。

### 5.3 llama.cpp（对应 `llamacpp_deploy_jev_zh.md` 一）

取源码并编译。先做[第 4 节](#4-探测上游支持动手装之前先做)的 grep 探针，再编译：

```bash
git clone https://github.com/ggml-org/llama.cpp.git && cd llama.cpp

# 配置，按平台二选一
# Linux ＋ NVIDIA
cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
# macOS：Metal 后端默认启用，不需要任何额外开关
cmake -B build -DCMAKE_BUILD_TYPE=Release

cmake --build build -j --target llama-server
```

configure 日志里要出现 `Including METAL backend`（mac）或 `Including CUDA backend`（Linux），这一行说明目标后端已启用。

**仅 Linux**：CUDA toolkit 装在 `/usr/local/cuda` 之外时，先把它的库注册进 `ldconfig`，否则链接 `llama-server` 时会报几十个 `undefined reference to cudaXxx@libcudart.so.13`：

```bash
echo /path/to/cuda/lib64 | sudo tee /etc/ld.so.conf.d/cuda.conf && sudo ldconfig
```

**取 GGUF——默认走这条**：官方仓库已发布，语言模型与 `mmproj` 各下一份：

```bash
HF_ENDPOINT=https://hf-mirror.com hf download openbmb/MiniCPM-OCR-Jev-gguf \
  --include "MiniCPM-OCR-Jev-F16.gguf" "mmproj-model-f16.gguf" \
  --local-dir ./models
```

- `F16` 是未量化的完整版本（3.78 GB）。显存或内存吃紧时把语言模型换成 `Q8_0`（2.01 GB）或 `Q4_K_M`（1.27 GB）——官方卡把前者标为接近无损、后者标为建议的最小档；`mmproj` 只有一个版本。
- 走这条就**不需要** `<WEIGHTS>`，也不需要转换环境。ModelScope 上有同一个仓库 `OpenBMB/MiniCPM-OCR-Jev-gguf`。

自己转只在两种情况下做：要换转换参数，或权重是用户自己微调的。那时另外装转换依赖（必须单独 venv，Debian/Ubuntu 等会按 PEP 668 拒绝装进系统 Python），语言模型与视觉编码器各转一份，**两份都要从改过 `architectures` 的目录转**：

```bash
python3 -m venv /opt/venv-convert && source /opt/venv-convert/bin/activate
pip install -r requirements/requirements-convert_hf_to_gguf.txt

mkdir -p ./models/MiniCPM-OCR-Jev-gguf
for f in <WEIGHTS>/*; do
  [ "$(basename "$f")" = config.json ] || ln -sf "$f" ./models/MiniCPM-OCR-Jev-gguf/
done
python - <<'EOF'
import json, os
c = json.load(open(os.environ["W"] + "/config.json"))
c["architectures"] = ["MiniCPMOCRForSequenceClassification"]
json.dump(c, open("./models/MiniCPM-OCR-Jev-gguf/config.json", "w"), indent=2, ensure_ascii=False)
EOF

python convert_hf_to_gguf.py ./models/MiniCPM-OCR-Jev-gguf \
  --outtype bf16 --outfile ./models/MiniCPM-OCR-Jev-bf16.gguf
python convert_hf_to_gguf.py ./models/MiniCPM-OCR-Jev-gguf --mmproj \
  --outtype bf16 --outfile ./models/mmproj-MiniCPM-OCR-Jev-bf16.gguf
```

（上面那段 heredoc 前先 `export W=<WEIGHTS>`。）`mmproj` 从转换目录转才会带上与训练一致的图片缩放下限，否则小图分数偏。自己转出来的文件名与官方那两份不同，下面起服命令要跟着换。

```bash
./build/bin/llama-server \
  -m ./models/MiniCPM-OCR-Jev-F16.gguf \
  --mmproj ./models/mmproj-model-f16.gguf \
  -ngl 99 -c 32768 --port 18499
```

通过标准：起服日志出现 `decision model type: openbmb-minicpm-ocr-jev` 与 `listening on`；`curl http://127.0.0.1:18499/health` 返回 `{"status":"ok"}`。两个平台同此标准。日志里**没有**那行 `decision model type` 就是这个构建不认模型，回[第 4 节](#4-探测上游支持动手装之前先做)。自己转的话还要核一条：转出 3.6 GB ＋ 641 MB 两份 GGUF。

### 5.4 Ollama（对应 `ollama_deploy_jev_zh.md` 一）

四个后端里要求最轻的一条：引擎在 Ollama 安装包里，不装 CUDA toolkit，也不编译任何东西，连 llama.cpp 都不用取。**GGUF 按 5.3 那条 `hf download` 直接下**（自己转的话同 5.3，再把下面两个 `FROM` 换成转出来的文件名）。

```bash
# Linux
curl -fsSL https://ollama.com/install.sh | sh
# macOS
brew install ollama

cat > Modelfile <<'EOF'
FROM ./models/MiniCPM-OCR-Jev-F16.gguf
FROM ./models/mmproj-model-f16.gguf
EOF

ollama serve &                       # 默认 11434
ollama create minicpm-ocr-jev -f Modelfile
ollama show minicpm-ocr-jev
```

模型名 `minicpm-ocr-jev` 要与 `sdk/backends/ollama.yaml` 里的 `model` 一致，改名则两处同改。

通过标准：**只有起服自检能确认这个后端可用**（见[第 7 节](#7-验证)）。`ollama show` 报 `decision, vision` 只说明 GGUF 转对了，runner 认不认它不负责。两个平台同此标准，macOS 上的 Ollama 也走 llama.cpp ＋ Metal。

## 6. 装服务层并启动

两种形态二选一，不要都起。引擎地址按第 5 节实际用的端口填。

### 6.1 不带渲染器服务（对应各文档 二）

```bash
python3 -m venv /opt/venv-score && source /opt/venv-score/bin/activate
pip install "fastapi>=0.110" "uvicorn>=0.27" "httpx>=0.27" "pydantic>=2.6" "PyYAML>=6.0" "Pillow==12.3.0"
```

```bash
PATH=/opt/venv-score/bin:$PATH bash sdk/start_score.sh 18501 http://127.0.0.1:18499
```

### 6.2 内置渲染器服务（对应各文档 三）

```bash
PIP_INDEX_URL=https://mirrors.ustc.edu.cn/pypi/simple \
PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright \
    bash sdk/setup_render.sh /opt/venv-render
```

它装 Node、CJK 字体、Chromium 与服务依赖，并把字体环境固定下来（约 2.5 分钟，205 MB）。

⚠ **macOS 上不要起这个服务**：装 Node 与 CJK 字体、固定字体环境这几步都靠 `apt-get`，mac 上会跳过。渲染图是模型输入，字体栈一换分数就换，打出来的分不能与发布值对照。mac 上用 6.1 的不带渲染器服务，渲染图由调用方提供。

```bash
PATH=/opt/venv-render/bin:$PATH bash sdk/start_render_score.sh 18500 http://127.0.0.1:18499
```

必须用 `/opt/venv-render` 这个解释器启动——渲染在本进程内完成。要提吞吐调 `RM_RENDER_BROWSERS`，不要加 worker。

### 6.3 vLLM 以外的后端要指定后端配置

```bash
JEV_BACKEND_CONFIG=sdk/backends/sglang.yaml \
PATH=/opt/venv-score/bin:$PATH bash sdk/start_score.sh 18501 http://127.0.0.1:18499
```

把 `sglang.yaml` 换成 `llamacpp.yaml` / `ollama.yaml`。**不设这个变量时服务按 vLLM 协议发请求**：SGLang 那边连得上但分数不可用，llama.cpp 与 Ollama 那边端点对不上、起服即失败。

## 7. 验证

7.1 与 7.2 是 SDK 路径（打服务层的 18501）；Docker 路径走 [7.3](#73-docker-路径用自带用例打分)。

### 7.1 起服自检

```bash
curl -s http://127.0.0.1:18501/healthz
```

只看 `status`，`ok` 即通过。其余字段是明细，各后端的正常值不同：

| 后端 | `prompt.source` | `forward_shape` | 说明 |
|---|---|---|---|
| vLLM | `engine` | `2 logits` | 引擎拼的 prompt 被逐项校过 |
| SGLang | `client` | `2 logits` | prompt 由 SDK 拼，校的是即将发出的字符串 |
| llama.cpp / Ollama | `server_template` | `2 probabilities` | 模板内置在 GGUF 里，读不回来，prompt 不校 |

`token_equality` 为 `skipped` 是跳过不是失败。`status` 不是 `ok` 时读 `prompt.notes` 或 `error`——它会带上引擎的原话。

### 7.2 用自带用例打分

自检只说明服务起得来，分数对不对要用 `examples/` 下三个用例核：

```bash
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

通过标准：三行分数与参考值相差都在 0.02 以内。**这是判断「装对了」的唯一客观标准**——HTTP 200 不是，`/healthz` 也不是。

内置渲染器服务换成 `/v1/rm/score_best`、请求体给 `image` ＋ `category` ＋ `candidates`，服务自己渲染；两个候选都打，`best_index` 应指向 `ground_truth` 那个。

打分前必看 `verdict`（镜像接口）或 `error`（`/v1/score`）：`0.0` 与 `-1.0` 是打分失败的固定返回值，不是低分。

### 7.3 Docker 路径：用自带用例打分

同样在 `scripts/minicpm-ocr-jev/` 下跑，端口是 1.2 里映射的 8030：

```bash
python3 - <<'EOF'
import base64, json, urllib.request
for name in ("01_text_putnam", "02_formula_putnam", "03_table_gb_standard"):
    c = json.load(open(f"examples/{name}/case.json"))
    role = c["reference_render_of"]
    text = next(x["text"] for x in c["candidates"] if x["role"] == role)
    b64 = lambda f: base64.b64encode(open(f"examples/{name}/{f}", "rb").read()).decode()
    body = {"input_form": "ternary",
            "items": [{"case_id": name, "image": b64(c["block_image"]),
                       "render_image": b64(c["reference_render"]),
                       "ocr_text": text, "category": c["category"]}]}
    req = urllib.request.Request("http://127.0.0.1:8030/v1/rm/score",
            data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req))["results"][0]
    print(f"{name:24} {r['verdict']:8} got {r['prob_yes']:.5f}  reference {c['observed_prob_yes'][role]:.5f}")
EOF
```

通过标准：三行 `verdict` 都是 `scored`，分数与参考值相差都在 0.02 以内。与 7.2 是同一口径，只是端点、字段名与端口不同（`/v1/rm/score`、`prob_yes`、8030）。

上面把 `reference_render` 一起送了进去，走的是「渲染图由调用方提供」那条。删掉 `render_image` 那行、让镜像自己渲染，分数同样应落在 0.02 以内——镜像内置的就是参考渲染环境。块内选优改打 `/v1/rm/score_best`：请求体给 `image` ＋ `category` ＋ `candidates`，两个候选都打，`best_index` 应指向 `ground_truth` 那个。

## 8. 上游未就位时的临时路径

```
验证日期：2026-10-28
当时的上游状态：SGLang PR #45829 未合入主仓；Ollama 最新 release v0.40.11/v0.40.12 捆绑的是 llama.cpp 0.7.x，不含本模型支持
失效条件：第 4 节的探针通过，本节即可整段删除
```

⚠ 走本节装出来的东西**与部署文档承诺的不是同一条路径**，要向用户明说走了临时路径、上游就位后应按官方路径重装。若今天的上游版本已不同于上面记录的，先重新验证再用本节。

### 8.1 SGLang：用 PR 源码树覆盖

**保留 `sglang[all]` 装好的全部依赖**（sgl-kernel、flashinfer 等都要用），只换 python 包：

```bash
source /opt/venv-sglang/bin/activate
pip uninstall -y sglang
cd <sglang PR 源码树>/python
SGLANG_BUILD_RUST_EXTS=none pip install -e . --no-build-isolation
```

`SGLANG_BUILD_RUST_EXTS=none` 是必需的：构建后端会去找 `cargo`，没有 Rust 工具链就直接失败。装完重做探针，应返回 `True`。

### 8.2 Ollama：成套换 runner

Ollama 发行版是预编译捆绑的，带的是它自己 vendor 的 llama.cpp。把 runner 换成 5.3 编出来的产物：

```bash
O=/usr/local/lib/ollama          # install.sh 的默认位置
L=<llama.cpp>/build/bin
cp -a $O/llama-server $O/llama-server.stock      # 备份
ln -sfn $L/llama-server $O/
for f in $L/lib*.so*; do ln -sfn "$f" "$O/$(basename "$f")"; done
ln -sfn $L/libggml-cuda.so $O/cuda_v13/libggml-cuda.so
```

⚠ **只换那个二进制无效**：原装 `llama-server` 只有 15 KB，模型支持在 `libllama-server-impl.so` 等共享库里。只换二进制仍然跑得起来、仍然报同样的错，据此会得出「换了也不行」的相反结论。

⚠ 这个换法**跨过了 Ollama 自己的兼容补丁**，为什么能跨过未查清；Ollama 升级后要重新验证。换完重起 `ollama serve` 与服务层，自检应为 `ok`。

## 9. 报错处理

### Docker 路径

| 现象 | 处理 |
|---|---|
| `could not select device driver "nvidia"` | NVIDIA Container Toolkit 没装或装完没重起 docker；先让 1.2 的那条 `--gpus all` 探针过 |
| `/healthz` 一直是 `loading`，打分返回 503 | 还在加载权重，等；久了读 `docker logs minicpm-ocr-jev` 找真实异常 |
| 422 | `input_form` 不是 `"ternary"`，或 `score_best_batch` 漏了 item 里的那一份 |
| `verdict` 为 `encode_error` | 图片 base64 带了 `data:image/...;base64,` 前缀，或字节本身有问题 |
| 400、提到 `max_items` | 单次请求候选总数超了默认的 64，拆批重发 |

### 安装

| 现象 | 处理 |
|---|---|
| `missing system packages: gcc g++ python3-dev` | `setup_backend.sh` 的自检，照它打印的 apt 命令装 |
| pip 装几分钟一个包都没下完 | 没设镜像源，见第 3 节 |
| `error: externally-managed-environment` | PEP 668，转换依赖要装进单独 venv（5.3），不要装进系统 Python |
| `RuntimeError: cargo is required to discover the Rust extension modules` | 装 SGLang PR 源码树时漏了 `SGLANG_BUILD_RUST_EXTS=none` |
| `undefined reference to cudaGetLastError@libcudart.so.13`（约 60 个） | CUDA 库没注册进 ldconfig，见 5.3 |

### 起引擎

| 现象 | 处理 |
|---|---|
| `AssertionError` 在 `deep_gemm/cuda_helpers.py: find_cuda_home` | SGLang 找不到系统 CUDA toolkit，设 `CUDA_HOME`（5.2） |
| `RuntimeError: Failed to find C compiler`，**权重已经加载完** | Triton 要现场编译，装 `gcc g++ python3-dev`（第 3 节） |
| `ValueError: Cannot find model module. 'Qwen3_5VLForSequenceClassification' is not a registered model` | SGLang 这个版本没有本模型支持，走 8.1 |
| 起服后进程被 kill、日志末尾 `EXIT=137` | 往上翻日志找真实异常，137 只是被 SIGKILL |
| `failed to init decision model: unsupported decision model type` | 这个 llama.cpp / Ollama runner 不认模型，走 8.2 或换 ≥v0.8.0 的 llama.cpp |
| llama.cpp 日志没有 `decision model type` 那行 | 同上 |

### 起服务与打分

| 现象 | 处理 |
|---|---|
| `refusing to start: the engine does not assemble the prompt this checkpoint was trained on` | 自检拦下了。读同一段报错里引擎的原话——通常是引擎参数错或 runner 不支持 |
| `backend HTTP 500: llama-server process has terminated` | 引擎侧挂了，去 `ollama serve` / `llama-server` 自己的日志看 |
| 起服卡在 `Waiting for application startup.` | 自检正在打引擎，等；超过两分钟去看引擎日志 |
| 分数全是 `0.0` 或 `-1.0` | 不是低分，是打分失败的固定返回值，读 `verdict` / `error` |
| 分数能打出来但与参考值差很多 | `category` 填错（公式块送成 `text` 会按字面渲染）；或 `mmproj` 不是从改过 `architectures` 的目录转的 |
| 分数只差小数点后第三位 | 自装渲染器与镜像渲染器的像素差异，排序不变，属正常 |
| 换了后端分数对不上 | 跨后端比绝对分要用同一批输入先对齐；Ollama 与 llama.cpp 同源，不算独立验证 |

## 10. 已验证版本

| 组件 | 版本 |
|---|---|
| vLLM | vLLM 0.32.0，torch 2.13.0+cu130，transformers 5.19.0，venv 8.4 GB |
| SGLang | 稳定版 0.5.22 **无本模型支持**；PR #45829 源码树可用，venv 9.5 GB |
| llama.cpp | release **v0.8.0**（含 PR #30980，2026-10-27 合入 master），build 214 MB |
| Ollama | v0.40.11 原装 **无本模型支持**，换 runner 后可用 |
| Docker 镜像 | 由 `serve/Dockerfile` 自建，引擎、打分服务与渲染环境都在镜像里；镜像内各件的实际版本以 `/healthz` 的 `scorer` 与 `render` 字段为准 |
| 服务层 | Python 3.12.3，fastapi 0.162.0，uvicorn 0.54.0，httpx 0.28.1，pydantic 2.14.1，Pillow 12.3.0，venv 59 MB |
| 渲染环境 | playwright 1.62.0，KaTeX 0.16.47，渲染流水线 v8.5，venv 205 MB |
| GGUF | 官方仓 `MiniCPM-OCR-Jev-gguf`：`MiniCPM-OCR-Jev-F16.gguf` 3.78 GB ＋ `mmproj-model-f16.gguf` 671 MB；与自己转的 bf16 打分等价（三个用例分差 ≤5e-5，2026-10-29 在 mac 上用 llama.cpp 与 Ollama 各实测一遍） |
| 硬件 | RTX 5090 单卡，驱动 590.48.01，CUDA 13.0.88，Ubuntu 24.04.5（2026-10-28） |
| macOS | Apple M5／16 GB 统一内存／macOS 26.x，Command Line Tools 26.6.0，llama.cpp v0.8.0 自编（Metal），转换依赖 torch 2.11.0 arm64 ＋ transformers 4.57.6（2026-10-29） |

## 11. 汇报规则

- 说清走的是哪条路径（Docker 镜像 / SDK）与端口。两条路径的渲染环境不一样，绝对分不通用；能直接与发布数字对照的只有 Docker 路径。
- 5090 与 M5 都只是验证用的机器，不要说必须用某一款。门槛是第 2 节那几个数（Docker 路径见 1.2）。
- 只汇报实际跑过的检查。没跑 7.2 就不要说分数对；`/healthz` 返回 `ok` 只能说服务起来了。
- 走了第 8 节的临时路径时必须明说，并说清它与文档路径的差别。
- 四个后端的分数不要互相当作独立验证，Ollama 与 llama.cpp 尤其——它们跑的是同一个二进制。
- 分数不带阈值、不带标签，也没有校准到绝对质量刻度：同一批输入里比高低才有意义，单个绝对分换算不出某种质量水平——报分数时把这条边界一并说清。
