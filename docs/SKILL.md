---
name: minicpmvocr-sdk
description: 安装、部署和验证 MiniCPM-OCR 1.0 文档解析 SDK 与 vLLM、SGLang 或 llama.cpp 推理服务，包括 DSpark、PDF/图片转 Markdown 和安装排错。Jev 打分服务使用 SKILL_jev.md。
---

# MiniCPM-OCR 1.0 安装、部署与验证

[English](./SKILL_en.md) · [返回首页](../README_zh.md)

SDK（命令 `minicpmvocr`，发行包 `minicpm-ocr`）负责版面检测、切块、拼接，通过 HTTP 调用独立的推理服务。保留用户选择的后端；尚未选择时，根据系统和设备选路。只安装所选推理后端，SDK 与 PyTorch 推理环境分开。

## 1. 选择后端与执行目录

| 情况 | 推理环境 | SDK 后端 | 详细参考 |
|---|---|---|---|
| Linux x86_64 + NVIDIA，默认方案 | `.venv-vllm`，可用 DSpark | `vllm` | [SDK 教程](./minicpmvocr_tutorial.md) |
| Linux x86_64 + NVIDIA，选择 SGLang | `.venv-sglang`，可用 DSpark | `sglang` | [SGLang 指南](./sglang_deploy_zh.md) |
| CPU、本地 GPU 或 Apple Silicon，选择 llama.cpp | `sources/llama.cpp/build`，使用 GGUF，可用 DSpark | `llamacpp` | [llama.cpp 指南](./llamacpp_deploy_zh.md) |
| 已有兼容推理服务 | 复用服务，只装 SDK | 按服务协议选择 | 本文第 7 节 |

- SGLang 使用 `--backend sglang`；SDK 内部将 `sglang` 映射到 `openai` 兼容客户端，`list-backends` 不单独列出 SGLang。llama.cpp 用 `llamacpp`，不要复用 vLLM 特有请求字段。
- llama.cpp 的 Metal 服务不要求 CUDA；完整解析还需要能运行 PP-DocLayoutV3 的 SDK 环境。若本机没有对应 PaddlePaddle wheel，单独安排兼容的 SDK 主机，不把 Metal 服务可用当成整个 SDK 已可用。
- SDK 与服务可以分处两台机器。先确认实际系统、GPU/内存、可用磁盘、目标工作目录和服务地址；已知信息无需再问。

SDK 直接从 PyPI 安装；连接已有推理服务时，在自己的工作目录执行第 3、7 节即可，无需克隆本仓库。自行部署 vLLM 或 SGLang 时，下面的安装步骤会使用仓库中的脚本，先进入已有仓库或克隆。推理服务示例以 **MiniCPM-OCR 仓库根目录**为工作目录；独立 SDK 主机上的 `.minicpm-ocr`、`models/` 和输入输出路径均相对其工作目录：

```bash
git clone https://github.com/OpenBMB/MiniCPM-OCR.git
cd MiniCPM-OCR
```

## 2. 以当前仓库为准检查版本和前置条件

自行部署推理服务前读取根目录 [`pyproject.toml`](../pyproject.toml)、[`scripts/install.sh`](../scripts/install.sh)、[`sdk/pyproject.toml`](../sdk/pyproject.toml) 和 [`sdk/minicpmvocr/_version.py`](../sdk/minicpmvocr/_version.py)。仅安装 SDK 时按第 3 节使用 PyPI 包。下面是本 Skill 对齐的版本；仓库更新时以实际声明为准，同步检查启动参数，不混用旧的 feat-ocr 源码与公开适配版本。

| 组件 | 当前来源 / 版本 |
|---|---|
| SDK | PyPI 包 `minicpm-ocr[all]`，默认安装或升级到与当前 Python 兼容的最新稳定版，与 [SDK 教程](./minicpmvocr_tutorial.md)一致 |
| Python | 安装脚本默认 `3.12`；根项目要求 `>=3.11,<3.14`（SDK 单独要求 `>=3.10`） |
| vLLM | `fa3b9d1377219247060d3c8b49eae199c9e7e154`，由安装脚本准备 |
| vLLM 依赖的 Transformers | `144ecf007b8b4f2910da104c84a79801db6985a6`，由根项目固定 |
| vLLM 依赖的 PyTorch | `torch==2.14.0`、`torchvision==0.29.0` |
| SGLang | [部署指南固定源码](./sglang_deploy_zh.md)：`aaab6bfc3de5354b052f2e96d5e566d70b9f69a2`；根项目仅引用本地路径，不自动下载或校验此 SHA |
| SGLang 的依赖 | 该源码声明 `torch==2.14.1`、`transformers==5.19.0`，Rust 工具链 `1.92`；不要装入 vLLM 的环境 |
| llama.cpp | `a08ab75ae74c36c15accc6c682a989a9e98dbfd2`，MiniCPM-OCR 1.0 适配合入提交（[PR #30979](https://github.com/ggml-org/llama.cpp/pull/30979)）。该提交已包含 `draft-dspark` |
| SDK 版面检测 | `paddlepaddle==3.2.1` 或 `paddlepaddle-gpu==3.3.0`，`paddlex==3.4.2` |

Linux CUDA 路线先检查：

```bash
uname -srm
nvidia-smi
nvidia-smi --query-compute-apps=pid,used_memory --format=csv
df -h .
```

vLLM / SGLang 安装脚本要求 Linux x86_64、`gcc-13` / `g++-13`，使用项目声明的 CUDA 13 pip 组件。CUDA 13 通常要求驱动 ≥580；旧驱动按 [FAQ](./faq_zh.md#cuda-driver-version-is-insufficient) 核对 GPU 与兼容库，安装、起服、GPU SDK 的每个新终端都需恢复相关环境变量。不要只凭驱动号宣告所有后端不可用。

vLLM 完整环境按教程至少预留 40 GB 磁盘；内存有限时降低 `MAX_JOBS`，显存按上下文和并发实际检查，不把某次测试硬件当成统一门槛。CPU / Metal 路线无需执行 `nvidia-smi`；Mac 先查 `xcode-select -p`，编译还需 CMake。

## 3. 通过 pip 安装 SDK

按 [SDK 教程](./minicpmvocr_tutorial.md#1-sdk-环境配置)创建独立的 `.minicpm-ocr` 环境，再用 pip 安装已发布的 SDK 包。已有 uv 则直接复用；没有时可执行 `python3 -m pip install uv`。若系统 Python 受 PEP 668 管理，将 uv 装进单独的工具 venv。SDK 安装本身不需要 Git；自行部署推理服务时再准备 Git、curl 和编译工具。

默认先用 CPU 版面检测，避免占用推理卡；在支持此 PaddlePaddle wheel 的机器上执行：

```bash
if [ ! -x .minicpm-ocr/bin/python ]; then
  uv venv .minicpm-ocr --python 3.12 --seed
fi
source .minicpm-ocr/bin/activate
python -m pip install --upgrade "minicpm-ocr[all]" "paddlex==3.4.2" "pypdfium2>=4"
python -m pip install "paddlepaddle==3.2.1"
python -m pip check
minicpmvocr list-backends
python -c 'from importlib.metadata import version; import minicpmvocr, paddle, paddlex; print(version("minicpm-ocr"), minicpmvocr.__file__); print(paddle.__version__, paddlex.__version__)'
```

记录实际安装的发行包版本，确认导入路径位于 `.minicpm-ocr` 环境的 `site-packages`；后端列表包含 `vllm`、`llamacpp`、`openai`，版面 provider 包含 `ppdoclayout3_paddlex`。这里同时沿用根项目的 `paddlex==3.4.2` 和 `pypdfium2>=4` 依赖，避免版面检测依赖缺失。需要复现特定环境时，再为 SDK 指定版本。

需要 GPU 版面检测时，将上面的 CPU PaddlePaddle 安装行替换为教程中的 GPU 安装命令（CPU/GPU 包二选一），后面的 SDK 命令改用 `--device cuda:0`，仍激活同一个 `.minicpm-ocr` 环境：

```bash
python -m pip install "paddlepaddle-gpu==3.3.0" \
  -i https://www.paddlepaddle.org.cn/packages/stable/cu129/
```

已有可用 SDK 环境时直接复用。只有开发或修改 SDK 源码时才使用仓库中的 editable 安装；正常解析使用上述 pip 安装。

`parse` 不传 `--config` 时使用包内配置，默认寻找 `models/PP-DocLayoutV3_infer`，缺失时自动下载并校验官方版面模型。已有模型可用 `--layout-model /absolute/path/PP-DocLayoutV3_infer`；它必须包含 `inference.pdiparams`、`inference.json`、`inference.yml`。显式传入模型路径或 `--config` 时，不依赖此自动下载行为。

## 4. vLLM：安装、启动与就绪检查

Ubuntu 系统依赖（具有相应权限时执行，否则由管理员安装）：

```bash
sudo apt-get update
sudo apt-get install -y software-properties-common build-essential git curl ca-certificates
sudo add-apt-repository -y ppa:ubuntu-toolchain-r/test
sudo apt-get update
sudo apt-get install -y gcc-13 g++-13 libdw-dev libelf-dev
bash scripts/install.sh vllm
```

安装脚本自动准备固定 SHA 的 `sources/vllm`、`sources/transformers`，调整 vLLM 的 Transformers 依赖并建立 CUDA 编译目录，默认 `MAX_JOBS=8`。已有源码版本不匹配时会停止；先保留本地改动并处理版本，不能直接 reset。不要另装浮动版本的 Transformers 覆盖它。

在新的服务终端中，从仓库根目录执行：

```bash
source .venv-vllm/bin/activate
uv pip check --python "$VIRTUAL_ENV/bin/python"
python -c 'import torch, transformers, vllm; print(torch.__version__, transformers.__version__, vllm.__version__)'
hf download openbmb/MiniCPM-OCR-1.0 --local-dir ./models/MiniCPM-OCR-1.0
hf download openbmb/MiniCPM-OCR-1.0-DSpark --local-dir ./models/MiniCPM-OCR-1.0-DSpark
export CC=gcc-13 CXX=g++-13
export CUDA_HOME="$(python -c 'import sysconfig; print(sysconfig.get_path("purelib") + "/nvidia/cu13")')"
export PATH="$CUDA_HOME/bin:$PATH"

CUDA_VISIBLE_DEVICES=0 vllm serve ./models/MiniCPM-OCR-1.0 \
  --served-model-name minicpm-ocr --host 127.0.0.1 --port 18499 \
  --max-model-len 40960 --max-num-batched-tokens 40960 --max-num-seqs 32 \
  --limit-mm-per-prompt '{"image":36,"video":0}' \
  --attention-backend FLASH_ATTN --mm-encoder-attn-backend FLASH_ATTN \
  --mm-processor-kwargs '{"downsample_mode":"4x"}' \
  --gpu-memory-utilization 0.85 --trust-request-mm-kwargs \
  --speculative-config '{"method":"dspark","model":"./models/MiniCPM-OCR-1.0-DSpark","num_speculative_tokens":15,"enable_adaptive_verification":false}' \
  --default-chat-template-kwargs '{"enable_thinking":false}'
```

主模型与草稿模型须来自同一发布；已有模型可复用。普通解码可删除整个 `--speculative-config` 参数，并跳过草稿下载。`CUDA_VISIBLE_DEVICES=0` 是示例，按空闲卡调整。SDK 请求需要 `--trust-request-mm-kwargs`。不要将 SGLang 的 `DSPARK` 参数复制到 vLLM。

在另一终端检查：

```bash
curl --noproxy 127.0.0.1 -fsS http://127.0.0.1:18499/v1/models
```

返回模型列表包含 `minicpm-ocr` 后，继续第 7 节带图与 SDK 验证。

## 5. SGLang：准备指定源码、安装与启动

这一路线对应 [SGLang 指南](./sglang_deploy_zh.md)。不要直接 `pip install sglang` 后假定含模型适配。

先安装第 4 节列出的 APT 编译依赖（跳过其中的 `bash scripts/install.sh vllm`，不安装 vLLM），再补齐 SGLang 所需工具：

```bash
sudo apt-get install -y pkg-config libssl-dev protobuf-compiler
mkdir -p sources
SGLANG_COMMIT=aaab6bfc3de5354b052f2e96d5e566d70b9f69a2
if [ ! -e sources/sglang ]; then
  git clone https://github.com/sgl-project/sglang.git sources/sglang &&
  git -C sources/sglang fetch origin pull/45799/head &&
  git -C sources/sglang checkout --detach "$SGLANG_COMMIT"
fi
test "$(git -C sources/sglang rev-parse HEAD)" = "$SGLANG_COMMIT" || {
  echo "SGLang source revision mismatch; preserve local work and resolve it before installing." >&2
  exit 1
}
protoc --version
bash scripts/install.sh sglang
```

脚本仅从 `sources/sglang/python` 安装；它不会替你 clone 或锁定 SGLang 源码。上面的版本检查因此不能省略。脚本读取 `rust/rust-toolchain.toml`，安装所需 rustup / Rust，并准备 pip CUDA 目录。`libcuda.so.1` 不在默认位置时，安装前设置 `OCR_LIBCUDA` 为实际路径；兼容库场景沿用 FAQ 配置。

在新的服务终端中，从仓库根目录执行。先激活环境，再恢复 Cargo、Rust、C++ 和 CUDA 设置，避免首次启动编译扩展时找错工具：

```bash
source .venv-sglang/bin/activate
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
export RUSTUP_TOOLCHAIN="$(python -c 'import tomllib; print(tomllib.load(open("sources/sglang/rust/rust-toolchain.toml", "rb"))["toolchain"]["channel"])')"
export CC=gcc-13 CXX=g++-13 CUDAHOSTCXX=g++-13
export CUDA_HOME="$(python -c 'import sysconfig; print(sysconfig.get_path("purelib") + "/nvidia/cu13")')"
export PATH="$CUDA_HOME/bin:$PATH"
uv pip check --python "$VIRTUAL_ENV/bin/python"
cargo --version
"$CUDA_HOME/bin/nvcc" --version
python -c 'import sglang, torch, transformers; print(sglang.__file__); print(torch.__version__, transformers.__version__); print((torch.ones(1, device="cuda") + 1).item())'
hf download openbmb/MiniCPM-OCR-1.0 --local-dir ./models/MiniCPM-OCR-1.0
hf download openbmb/MiniCPM-OCR-1.0-DSpark --local-dir ./models/MiniCPM-OCR-1.0-DSpark

CUDA_VISIBLE_DEVICES=0 python -m sglang.launch_server \
  --model-path ./models/MiniCPM-OCR-1.0 \
  --served-model-name minicpm-ocr --host 127.0.0.1 --port 18499 \
  --context-length 40960 --max-running-requests 32 --mem-fraction-static 0.85 \
  --speculative-algorithm DSPARK \
  --speculative-draft-model-path ./models/MiniCPM-OCR-1.0-DSpark \
  --default-chat-template-kwargs '{"enable_thinking":false}'
```

安装路径应指向 `sources/sglang/python/sglang`。该源码的 Rust 为 1.92，NVCC 应为项目声明的 CUDA 13.0。不要把 vLLM 路线的 Transformers editable 安装进这个环境；SGLang 使用自己的模型配置与 processor 适配。

不启用 DSpark 时删除 `--speculative-algorithm` 和 `--speculative-draft-model-path` 两个参数，跳过草稿下载。使用 DSpark 时保持匹配的主模型和草稿模型；不要套用 vLLM 的投机 JSON。

在另一终端运行第 4 节的 `/v1/models` 检查，确认有 `minicpm-ocr`，再按第 7 节使用 `--backend sglang` 验证。若端口已被占用，改服务端口与所有客户端地址；同一张卡上切换服务前先确认原服务的占用。

## 6. llama.cpp：GGUF、编译与启动

llama.cpp 不使用 HF safetensors 直接起服。默认启用 DSpark，需要主模型 GGUF、视觉 projector GGUF 和配套草稿 GGUF。当前路线使用 [llama.cpp 指南](./llamacpp_deploy_zh.md)中的官方 F16 主模型，并搭配同版本 F16 草稿。已有 `hf` 时复用；服务主机没有 SDK 时只建下载环境，不需要安装 PaddlePaddle、torch 或转换权重：

```bash
if ! command -v hf >/dev/null; then
  if [ ! -x .venv-models/bin/python ]; then
    uv venv --python 3.12 .venv-models
  fi
  uv pip install --python .venv-models/bin/python huggingface-hub
  export PATH="$PWD/.venv-models/bin:$PATH"
fi
hf download openbmb/MiniCPM-OCR-1.0-gguf \
  MiniCPM-OCR-1_0-F16.gguf mmproj-model-f16-4x.gguf \
  --local-dir ./models/MiniCPM-OCR-1.0-gguf
hf download openbmb/MiniCPM-OCR-1.0-DSpark-gguf \
  dspark-MiniCPM-OCR-1_0-F16.gguf \
  --local-dir ./models/MiniCPM-OCR-1.0-gguf
mkdir -p sources
LLAMA_COMMIT=a08ab75ae74c36c15accc6c682a989a9e98dbfd2
if [ ! -e sources/llama.cpp ]; then
  git clone https://github.com/ggml-org/llama.cpp.git sources/llama.cpp &&
  git -C sources/llama.cpp checkout --detach "$LLAMA_COMMIT"
fi
test "$(git -C sources/llama.cpp rev-parse HEAD)" = "$LLAMA_COMMIT" || {
  echo "llama.cpp source revision mismatch; preserve local work and resolve it before building." >&2
  exit 1
}
git -C sources/llama.cpp rev-parse HEAD
```

本 Skill 固定到 MiniCPM-OCR 1.0 的适配合入提交。已有源码版本不匹配时先保留本地改动，再处理版本或使用独立目录；不要直接 reset。确认 SHA 一致后再编译，避免复用其他版本的旧二进制。

Ubuntu 上先准备编译依赖：

```bash
sudo apt-get update
sudo apt-get install -y cmake build-essential git curl ca-certificates
```

macOS 上检查 Command Line Tools；若未安装，执行 `xcode-select --install` 并等安装完成。用 Homebrew 准备 CMake：

```bash
xcode-select -p
brew install cmake
```

CUDA 构建还需可找到的完整 CUDA toolkit（`nvcc --version`、`CUDA_HOME`），只有显卡驱动不足以编译；CPU / Metal 不需要 CUDA。按平台**只执行下面一个配置块**，切换后端时使用独立 build 目录或清理自己生成的 CMake 缓存：

Linux + NVIDIA：

```bash
cmake -S sources/llama.cpp -B sources/llama.cpp/build \
  -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
```

macOS + Apple Silicon（Metal 默认启用）：

```bash
cmake -S sources/llama.cpp -B sources/llama.cpp/build \
  -DCMAKE_BUILD_TYPE=Release
```

CPU（显式关闭 GPU 后端）：

```bash
cmake -S sources/llama.cpp -B sources/llama.cpp/build \
  -DGGML_CUDA=OFF -DGGML_METAL=OFF -DCMAKE_BUILD_TYPE=Release
```

确认配置输出包含预期后端；然后编译。`-j 8` 按本机内存调整：

```bash
cmake --build sources/llama.cpp/build -j 8 --target llama-server
./sources/llama.cpp/build/bin/llama-server --version
```

从仓库根目录启动（这里统一用端口 18499，客户端显式指定地址，不依赖 SDK 的后端默认端口）：

```bash
./sources/llama.cpp/build/bin/llama-server \
  --model ./models/MiniCPM-OCR-1.0-gguf/MiniCPM-OCR-1_0-F16.gguf \
  --mmproj ./models/MiniCPM-OCR-1.0-gguf/mmproj-model-f16-4x.gguf \
  --model-draft ./models/MiniCPM-OCR-1.0-gguf/dspark-MiniCPM-OCR-1_0-F16.gguf \
  --spec-type draft-dspark \
  --spec-draft-n-max 15 \
  --alias minicpm-ocr --host 127.0.0.1 --port 18499 \
  --ctx-size 40960 --n-gpu-layers 999 --gpu-layers-draft 999 \
  --parallel 1 --reasoning off
```

`--model-draft` 加载配套草稿，`--spec-type draft-dspark` 启用 DSpark，`--spec-draft-n-max 15` 将每步草稿长度上限设为 15。不启用 DSpark 时删除这三个参数和 `--gpu-layers-draft`，并跳过草稿下载。CPU 推理将 `--n-gpu-layers` 和 `--gpu-layers-draft` 都改为 `0`，并追加 `--no-mmproj-offload`。上下文 40960 不是低内存保证；内存或显存不足时先降低 `--ctx-size`，并同步第 7 节的 `engine.max_model_len`。保留 `--reasoning off`：适配 PR 指出，默认 `auto` 可能将识别文本放进 `reasoning_content`，而当前 SDK 读取 `content`，导致读到空输出。自行转换权重时还需核对模板，按指南加入 `--chat-template-kwargs '{"enable_thinking":false}'`。启动日志应出现 `adding speculative implementation 'draft-dspark'`。

在另一终端检查：

```bash
curl --noproxy 127.0.0.1 -fsS http://127.0.0.1:18499/health
curl --noproxy 127.0.0.1 -fsS http://127.0.0.1:18499/v1/models
```

`/health` 返回 `status=ok`，模型列表核对别名 `minicpm-ocr`，然后执行第 7 节。不要用 SDK 启动脚本的历史默认模型路径覆盖本节下载路径。

## 7. 三层验证：就绪、带图请求、单页解析

### 7.1 就绪

按相应后端检查 `/v1/models`，llama.cpp 另查 `/health`。模型名与客户端一致，SDK 的 URL 为服务根地址 `http://127.0.0.1:18499`，不带 `/v1`。健康检查成功只说明可访问。

### 7.2 用当前 SDK 客户端发送一个真实图片块

激活已安装的 SDK 环境，准备含清晰文字的 `sample.png`（真实裁切的文字块），按后端替换 `OCR_BACKEND`：vLLM 为 `vllm`，SGLang 为 `sglang`，llama.cpp 为 `llamacpp`。模型 ID、URL 按实际服务调整：

```bash
source .minicpm-ocr/bin/activate
export OCR_BACKEND=llamacpp
export OCR_TEST_URL=http://127.0.0.1:18499
export OCR_TEST_MODEL=minicpm-ocr
python - <<'PYTEST'
import os
from copy import deepcopy
from PIL import Image
from minicpmvocr import DEFAULT_CONFIG, create_backend

cfg = deepcopy(DEFAULT_CONFIG)
cfg["engine"].update({
    "type": os.environ["OCR_BACKEND"],
    "server_url": os.environ["OCR_TEST_URL"],
    "model_name": os.environ["OCR_TEST_MODEL"],
    "max_model_len": 40960,
    "startup_timeout_sec": 60,
    "request_ready_timeout_sec": 30,
    "extra_body": {"chat_template_kwargs": {"enable_thinking": False}},
})
client = create_backend(cfg)
client.wait_ready(timeout_sec=60)
with Image.open("sample.png") as image:
    result = client.recognize(image.convert("RGB"), "Text Recognition:", max_new_tokens=2048)
assert result["text"].strip(), "Empty OCR output"
assert result["finish_reason"] != "length", "Output truncated; inspect the token budget"
print(result["text"])
print("finish_reason:", result["finish_reason"])
PYTEST
```

这段使用当前 `create_backend` / `recognize` 接口，按后端生成请求，避免手工把 vLLM 字段发给其他服务。若服务上下文已调小，同步修改脚本里的 `max_model_len`。检查输出是否与图片一致；非空断言不能代替识别质量判断。直接调用客户端返回模型原始输出，表格后处理由完整流水线完成。

### 7.3 用 SDK 解析一页

下面三个示例**按所选后端执行一个**。先激活 `.minicpm-ocr`。默认 CPU 版面；第 3 节选择 GPU PaddlePaddle 时可改用 `--device cuda:0`。`doc.pdf` 也可换成 PNG/JPG。使用 `parse` 的包内配置以启用版面模型自动准备。

vLLM：

```bash
minicpmvocr parse --backend vllm \
  --server-url http://127.0.0.1:18499 --model minicpm-ocr \
  --device cpu --workers 1 --set input.limit=1 \
  --set engine.max_model_len=40960 \
  --input doc.pdf --output out-vllm.md
```

SGLang：

```bash
minicpmvocr parse --backend sglang \
  --server-url http://127.0.0.1:18499 --model minicpm-ocr \
  --device cpu --workers 1 --set input.limit=1 \
  --set engine.max_model_len=40960 \
  --set engine.extra_body='{"chat_template_kwargs":{"enable_thinking":false}}' \
  --input doc.pdf --output out-sglang.md
```

llama.cpp（单 slot，串行识别）：

```bash
minicpmvocr parse --backend llamacpp \
  --server-url http://127.0.0.1:18499 --model minicpm-ocr \
  --device cpu --workers 1 --set input.limit=1 \
  --set engine.max_model_len=40960 \
  --set pipeline.queue_mode=serial --set pipeline.overlap_layout=false \
  --input doc.pdf --output out-llamacpp.md
```

通过标准：输出 Markdown 非空，日志没有失败的页/块，文字与原图一致；表格页检查 HTML `<table>`，公式页检查 LaTeX，不能残留未经处理的 `<otsl>` 或明显截断。通过后去掉 `input.limit=1` 处理全篇；vLLM / SGLang 再按显存逐步增加 SDK workers 与服务并发。

默认解析无需 `--config`。需要自定义配置时，先从已安装的包中定位参考 YAML，再通过 `--config` 指向该文件或自己的副本，并显式设置 `layout.model_dir` 为已准备好的模型：

```bash
python -c 'from importlib.resources import files; print(files("minicpmvocr").joinpath("configs/minicpmvocr.yaml"))'
```

该配置的源码位置为 `sdk/minicpmvocr/configs/minicpmvocr.yaml`，pip 用户无需准备此源码路径。不要再引用不存在的 `configs/backends/*.yaml`。`--set` 中的路径按配置目录解析，使用绝对路径；`--input` 按当前目录解析。`run` 等分阶段命令需要 `--set input.file_path=/absolute/path/doc.pdf`；重跑时更换 `run.run_tag`，需要时用 `run.run_root` 指定磁盘。

### 7.4 可选：验证 DSpark 加速

vLLM 开启 DSpark 后，发出实际请求再查：

```bash
curl --noproxy 127.0.0.1 -fsS http://127.0.0.1:18499/metrics | grep spec_decode_num
```

只有观测到 draft / accepted token 指标随请求增长，才报告 vLLM DSpark 已生效。SGLang 需检查其实际日志/指标中的 DSPARK 行为，不复用 vLLM 指标名。llama.cpp 在启动日志中确认 `adding speculative implementation 'draft-dspark'`，首次推理后再看 `draft acceptance`。

## 8. 按失败阶段排查并汇报

| 现象 | 处理 |
|---|---|
| `Clone the SGLang source ... first` | 按第 5 节准备和校验固定源码，再运行安装脚本 |
| SGLang 缺 `protoc`、Rust 编译失败 | 装 `protobuf-compiler`；新终端恢复 Cargo PATH 和源码声明的 `RUSTUP_TOOLCHAIN`，读首个编译错误 |
| `minicpm_ocr` 未识别 | vLLM 核对根项目固定的两份源码；SGLang 核对 PR SHA 和导入路径；两条路线的 Transformers 不能互相覆盖 |
| NVCC 缺失或 `--compress-mode=size` 不识别 | 恢复所选服务环境的 `CUDA_HOME` / PATH，确认实际 NVCC；不要混用其他环境的工具链 |
| CUDA 驱动错误 | 按 FAQ 核对 GPU、驱动与兼容库，在当前终端恢复环境变量 |
| llama.cpp 无法加载模型或图像 | 核对主模型、投影器、草稿 GGUF、源码 SHA、二进制版本和实际后端；不能仅以 `/health` 成功判断支持图片 |
| llama.cpp 链接/动态库错误 | 核查 CMake 日志、CUDA toolkit 和动态库搜索路径，按实际缺库处理，不套用历史绝对路径 |
| vLLM 请求 400 / SDK 反复重试 | 核对 `--trust-request-mm-kwargs`、图片数量限制和服务端原始错误 |
| 输出为空、thinking 标签、乱码 | 核对实际模型 ID 和关闭 thinking 的模板参数；llama.cpp 确认启动时带 `--reasoning off`，并检查 GGUF 模板 |
| 显存不足 / 编译进程被杀 | 区分运行显存与编译 RAM；分别降低上下文/并发或 `MAX_JOBS` |
| `/v1/models` 正常但解析失败 | 先跑 7.2 的单块请求，再区分识别服务、版面模型/设备与流水线问题 |
| 端口已占用 / 服务不在本机 | 同步修改服务监听地址与客户端 URL；可用 SSH 隧道 `ssh -L 18499:127.0.0.1:18499 user@host` |

汇报实际使用的后端、源码 SHA/包版本、模型文件、设备、地址，以及安装检查、健康检查、带图请求、单页解析分别通过与否。安装成功、服务就绪、识别正确、DSpark 生效是不同结论。不要在排错时删除用户环境、重置源码或用未核实的临时补丁掩盖版本不匹配。

参数与 API 细节见 [SDK 配置说明](./minicpmvocr_api.md)；Jev 打分服务使用 [Jev Skill](./SKILL_jev.md)，不混用其权重、分类架构和验证标准。
