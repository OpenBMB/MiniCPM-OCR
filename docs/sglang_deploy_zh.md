# SGLang 部署指南

[English](./sglang_deploy.md)

[← 返回首页](../README_zh.md)

SGLang 通过 OpenAI 兼容 API 提供 MiniCPM-OCR 服务。本文启用 DSpark 解码，需要配套的主模型和草稿模型。SDK 运行在独立环境中，通过 HTTP 连接识别服务。

环境布局和 SDK 设置与 [vLLM 教程](./minicpmvocr_tutorial.md) 一致。以下命令面向 Linux x86_64、NVIDIA GPU 和 Python 3.12。

## 1. 准备源码

MiniCPM-OCR 1.0 的支持来自 [PR #45799](https://github.com/sgl-project/sglang/pull/45799)。截至 2026 年 10 月 26 日，该 PR 仍处于开放状态。本文使用 PR 提交 [`aaab6bfc3de5354b052f2e96d5e566d70b9f69a2`](https://github.com/tc-mb/sglang/commit/aaab6bfc3de5354b052f2e96d5e566d70b9f69a2)，所在分支为 `model/MiniCPM-OCR-1.0`。

以下命令均在**本仓库根目录** `MiniCPM-OCR` 执行：

```bash
git clone https://github.com/sgl-project/sglang.git sources/sglang
git -C sources/sglang fetch origin pull/45799/head
git -C sources/sglang checkout aaab6bfc3de5354b052f2e96d5e566d70b9f69a2
```

如果 `sources/sglang` 已经存在，跳过克隆，只执行 fetch 和 checkout。

## 2. 配置 SDK 环境

按 [SDK 教程](./minicpmvocr_tutorial.md#1-sdk-环境配置) 在 `.minicpm-ocr` 中安装 SDK 和 GPU 版 PaddlePaddle。如果为 vLLM 安装过该环境，直接复用。

使用 CPU 做版面检测时，步骤相同，只把 `paddlepaddle-gpu` 的安装命令换成：

```bash
python -m pip install "paddlepaddle==3.2.1"
```

## 3. 安装服务环境

本仓库 [`pyproject.toml`](../pyproject.toml) 的 `sglang` 配置会安装 `sources/sglang/python` 和 CUDA 13 组件。PyTorch 2.14.1、Transformers 5.19.0 以及其他 SGLang 依赖来自该源码自己的 [`python/pyproject.toml`](https://github.com/tc-mb/sglang/blob/aaab6bfc3de5354b052f2e96d5e566d70b9f69a2/python/pyproject.toml)。安装脚本使用独立的 `.venv-sglang` 环境，因为 vLLM 配置需要不同的 PyTorch 版本。

在 Ubuntu 22.04 上准备系统编译依赖。以 root 运行，或在 APT 命令前加 `sudo`：

```bash
apt-get update
apt-get install -y software-properties-common build-essential pkg-config libssl-dev curl ca-certificates protobuf-compiler
add-apt-repository -y ppa:ubuntu-toolchain-r/test
apt-get update
apt-get install -y gcc-13 g++-13 libdw-dev libelf-dev
```

> **驱动兼容**：CUDA 13 通常需要驱动 ≥580。受支持的 GPU 若驱动较旧，按 [FAQ](./faq_zh.md#cuda-driver-version-is-insufficient) 配置兼容库。安装、启动服务和运行 GPU 版 SDK 的终端都要设置相应的环境变量。

安装服务环境：

```bash
bash scripts/install.sh sglang
source .venv-sglang/bin/activate
```

安装脚本会创建或复用 `.venv-sglang`，必要时安装 `rustup`，并选用 SGLang 源码固定的 Rust 版本（此提交为 1.92）。它也会准备 CUDA 编译器和库链接。如果驱动的 `libcuda.so.1` 不在 `/usr/lib/x86_64-linux-gnu`，安装前把 `OCR_LIBCUDA` 设为它的路径。使用驱动兼容库时，保持 FAQ 中配置的值。

检查环境：

```bash
uv pip check
"$(python -c 'import sysconfig; print(sysconfig.get_path("purelib") + "/nvidia/cu13/bin/nvcc")')" --version
python -c 'import sglang; print(sglang.__file__)'
python -c 'import torch, transformers; print("torch", torch.__version__, "CUDA", torch.version.cuda, "transformers", transformers.__version__); x = torch.ones(1, device="cuda"); print(torch.cuda.get_device_name(0), (x + 1).item())'
```

SGLang 的路径应指向 `sources/sglang/python/sglang`；NVCC 应报告 CUDA 13.0。

此 PR 的模型配置和图像处理器由 SGLang 提供。它的安装使用自己的依赖列表；教程里给 vLLM 用的 Transformers 适配检出不会装进这个环境。

## 4. 准备模型

下载 SDK 的 PP-DocLayoutV3 版面模型，或复用为 vLLM 准备好的目录：

```bash
mkdir -p models
curl -fL -o ./models/PP-DocLayoutV3_infer.tar \
  https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-DocLayoutV3_infer.tar
tar xf ./models/PP-DocLayoutV3_infer.tar -C ./models
```

下载 [MiniCPM-OCR-1.0 主模型](https://huggingface.co/openbmb/MiniCPM-OCR-1.0) 和配套的 [MiniCPM-OCR-1.0-DSpark 草稿模型](https://huggingface.co/openbmb/MiniCPM-OCR-1.0-DSpark)：

```bash
source .venv-sglang/bin/activate
hf download openbmb/MiniCPM-OCR-1.0 --local-dir ./models/MiniCPM-OCR-1.0
hf download openbmb/MiniCPM-OCR-1.0-DSpark --local-dir ./models/MiniCPM-OCR-1.0-DSpark
```

模型已经存在时直接复用。下文的 `--model-path` 指向主模型目录，`--speculative-draft-model-path` 指向配套草稿模型目录，SDK 的 `layout.model_dir` 指向版面模型目录。

## 5. 启动服务

在仓库根目录新开一个服务终端。单卡机器上，先结束 SDK 进程并停掉之前的推理服务，再启动 SGLang，以便腾出显存。

> **旧驱动**：按 [FAQ](./faq_zh.md#cuda-driver-version-is-insufficient)，在启动服务前于本终端设置兼容库环境变量。激活 `.venv-sglang` 不会带入其他终端里的变量。

```bash
source .venv-sglang/bin/activate
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
export RUSTUP_TOOLCHAIN=1.92
export CC=gcc-13 CXX=g++-13
export CUDA_HOME="$(python -c 'import sysconfig; print(sysconfig.get_path("purelib") + "/nvidia/cu13")')"
export PATH="$CUDA_HOME/bin:$PATH"

CUDA_VISIBLE_DEVICES=0 python -m sglang.launch_server \
  --model-path ./models/MiniCPM-OCR-1.0 \
  --served-model-name minicpm-ocr \
  --host 127.0.0.1 --port 18499 \
  --context-length 40960 \
  --max-running-requests 32 \
  --mem-fraction-static 0.85 \
  --speculative-algorithm DSPARK \
  --speculative-draft-model-path ./models/MiniCPM-OCR-1.0-DSpark \
  --default-chat-template-kwargs '{"enable_thinking":false}'
```

`--speculative-algorithm DSPARK` 启用 DSpark。SGLang 从草稿配置读取草稿块大小，并据此得到校验窗口；不要把 vLLM 的 `--speculative-config` JSON 抄进这条命令。

源码检出可能在首次启动时编译 Rust 缓存扩展。本终端要把 Cargo 目录留在 `PATH` 中，并使用 Rust 1.92；安装脚本结束后，系统自带的 Cargo 仍可能更旧。重新激活虚拟环境会重置 `PATH`，激活后再把本段里的 export 全部执行一遍。

> **GPU 和端口**：`CUDA_VISIBLE_DEVICES=0` 选择物理 GPU 0，需要时改成其他 GPU 序号。如果已有服务占用端口 `18499`，这里换一个空闲端口，并在下面的 SDK 命令中使用同一端口。共用一张 GPU 的服务也共用它的可用显存。

> **并发**：这一 SGLang 配置最多允许 32 个正在运行的请求，启用 DSpark 时也是如此。下面的 SDK 示例最多同时发出 32 个请求。显存不足时同时减小这两个值；实际容量还取决于图片大小和序列长度。

聊天模板设置会关闭思考模式，这是适配 PR 的要求。在另一个终端检查服务是否就绪：

```bash
curl --noproxy 127.0.0.1 -f http://127.0.0.1:18499/v1/models
```

返回的模型列表应包含 `minicpm-ocr`。

## 6. 用 SDK 解析文档

在仓库根目录另开一个终端：

```bash
source .minicpm-ocr/bin/activate

minicpmvocr parse --config sdk/minicpmvocr/configs/minicpmvocr.yaml \
  --backend sglang \
  --server-url http://127.0.0.1:18499 \
  --model minicpm-ocr \
  --set layout.model_dir="$PWD/models/PP-DocLayoutV3_infer" \
  --set layout.device=cuda:0 \
  --set pipeline.queue_mode=concurrent \
  --set engine.max_model_len=40960 \
  --set pipeline.max_workers=32 \
  --set pipeline.merge_cross_page_tables=false \
  --set pipeline.overlap_layout=true \
  --input doc.pdf --output doc.md
```

输入可以是 PDF、PNG 或 JPG。PDF 会整份解析；加上 `--set input.limit=1` 则只检查第一页。SDK 的模型名必须与服务的 `--served-model-name` 一致。

`pipeline.overlap_layout=true` 让版面检测和识别同时进行。`pipeline.max_workers=32` 限制的是并发识别请求数，不是页数；按服务能力调整。`pipeline.queue_mode` 在关闭版面重叠时生效。`--backend sglang` 选择 SGLang；SDK 内部把这个别名映射到 OpenAI 兼容客户端。

> **CPU 版面检测**：使用上面配置的 CPU 版 PaddlePaddle 环境，激活 `.minicpm-ocr`，并把 `--set layout.device=cuda:0` 换成 `--set layout.device=cpu`。

> **GPU 选择**：`cuda:0` 是 SDK 进程可见的第一张 GPU。如果该进程设置了 `CUDA_VISIBLE_DEVICES=3`，它唯一可见的 GPU 仍写作 `cuda:0`。旧驱动下，新开的终端在运行 GPU 版面检测或服务之前，也要按 [FAQ](./faq_zh.md#cuda-driver-version-is-insufficient) 恢复兼容库环境变量。

## 排障

| 现象 | 检查 |
|---|---|
| 未知的 `minicpm_ocr` 模型类型或架构 | 确认源码停在固定的 PR 提交，并且装进了 `.venv-sglang` |
| CUDA 驱动报错 | 查看驱动兼容性，以及 [FAQ](./faq_zh.md#cuda-driver-version-is-insufficient) 中的兼容库环境变量 |
| 找不到 `nvcc`，或 NVCC 链接文件缺失 | 按第 5 步恢复 `CUDA_HOME` 和 `PATH`；编译器文件不完整时重新运行 `bash scripts/install.sh sglang` |
| NVCC 报告未知的 `--compress-mode=size` 选项 | 按服务启动命令恢复 `CUDA_HOME` 和 `PATH`，然后重启服务 |
| Rust 缓存编译因 `edition2024` 失败，或 Cargo 退出码为 101 | 先看第一条编译错误。若是 `edition2024`，按第 5 步恢复 Cargo 的 `PATH` 和 `RUSTUP_TOOLCHAIN`；`cargo --version` 应报告 1.92.0 |
| 显存不足 | 减小 `--max-running-requests`、SDK worker 数或 `--context-length`；`engine.max_model_len` 与服务保持一致 |
| 输出中出现思考标签 | 启动服务时保留 `--default-chat-template-kwargs '{"enable_thinking":false}'` |

其他硬件平台和服务选项见 [SGLang 文档](https://docs.sglang.io/)。
