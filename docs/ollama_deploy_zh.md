# Ollama 部署指南

[English](./ollama_deploy.md)

[← 返回首页](../README_zh.md)

使用 Ollama 部署 MiniCPM-OCR 1.0，联合加载 **Q8_0 主模型、Q8_0 DSpark 草稿模型（加速头）和 F16 4× 视觉投影器**，启用 DSpark 投机解码。以下命令均在 **本仓库根目录** 的 Bash 终端执行。

## 1. 安装 Ollama

使用 **Ollama v0.40.12 或更新版本**。在 Linux 上安装本文参考版本：

```bash
curl -fsSL https://ollama.com/install.sh | OLLAMA_VERSION=0.40.12 sh
ollama --version
```

macOS 和 Windows 安装方式见 [官方下载页](https://ollama.com/download)。已安装 Ollama 时先检查版本，升级后重启服务。GPU 和驱动要求见 [Ollama GPU 文档](https://docs.ollama.com/gpu)。

## 2. 下载主模型、视觉投影器和 DSpark 草稿模型

从 [主模型仓库](https://huggingface.co/openbmb/MiniCPM-OCR-1.0-gguf) 下载主模型和视觉投影器，从 [DSpark GGUF 仓库](https://huggingface.co/openbmb/MiniCPM-OCR-1.0-DSpark-gguf) 下载配套量化草稿模型。三个文件均需下载，并使用同一 1.0 发布版本的配套权重：

| 文件 | 大小约 | 用途 |
|---|---|---|
| `MiniCPM-OCR-1_0-Q8_0.gguf` | 0.81 GB | Q8_0 主模型 |
| `mmproj-model-f16-4x.gguf` | 0.90 GB | F16 视觉投影器，图片输入必需 |
| `dspark-MiniCPM-OCR-1_0-Q8_0.gguf` | 0.33 GB | Q8_0 DSpark 草稿模型，用于投机解码 |

```bash
mkdir -p ./models/MiniCPM-OCR-1.0-gguf
curl -fL --retry 3 \
  -o ./models/MiniCPM-OCR-1.0-gguf/MiniCPM-OCR-1_0-Q8_0.gguf \
  https://huggingface.co/openbmb/MiniCPM-OCR-1.0-gguf/resolve/main/MiniCPM-OCR-1_0-Q8_0.gguf
curl -fL --retry 3 \
  -o ./models/MiniCPM-OCR-1.0-gguf/mmproj-model-f16-4x.gguf \
  https://huggingface.co/openbmb/MiniCPM-OCR-1.0-gguf/resolve/main/mmproj-model-f16-4x.gguf
curl -fL --retry 3 \
  -o ./models/MiniCPM-OCR-1.0-gguf/dspark-MiniCPM-OCR-1_0-Q8_0.gguf \
  https://huggingface.co/openbmb/MiniCPM-OCR-1.0-DSpark-gguf/resolve/main/dspark-MiniCPM-OCR-1_0-Q8_0.gguf
```

如无法访问 Hugging Face，创建相同目录后，改从 ModelScope 的 [主模型仓库](https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0-gguf) 和 [DSpark 仓库](https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0-DSpark-gguf) 下载：

```bash
mkdir -p ./models/MiniCPM-OCR-1.0-gguf
curl -fL --retry 3 \
  -o ./models/MiniCPM-OCR-1.0-gguf/MiniCPM-OCR-1_0-Q8_0.gguf \
  https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0-gguf/resolve/master/MiniCPM-OCR-1_0-Q8_0.gguf
curl -fL --retry 3 \
  -o ./models/MiniCPM-OCR-1.0-gguf/mmproj-model-f16-4x.gguf \
  https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0-gguf/resolve/master/mmproj-model-f16-4x.gguf
curl -fL --retry 3 \
  -o ./models/MiniCPM-OCR-1.0-gguf/dspark-MiniCPM-OCR-1_0-Q8_0.gguf \
  https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0-DSpark-gguf/resolve/master/dspark-MiniCPM-OCR-1_0-Q8_0.gguf
```

## 3. 启动服务

在服务终端中进入仓库根目录：

```bash
export OLLAMA_HOST=127.0.0.1:18499
export OLLAMA_MODELS="$PWD/models/ollama"
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=1

ollama serve
```

保持此终端运行。Ollama 自动选择推理后端。在使用 NVIDIA GPU 的 Linux 系统上，可通过 `CUDA_VISIBLE_DEVICES=0 ollama serve` 选择 GPU 0。

此实例使用 `18499` 端口，将导入后的模型保存在 `models/ollama`。Ollama 默认端口为 `11434`，下文注册模型时应连接同一个地址和端口；更换端口时同步修改所有命令中的地址。

## 4. 注册模型并检查服务

新开一个终端，进入仓库根目录：

```bash
export OLLAMA_HOST=127.0.0.1:18499

cat > ./models/MiniCPM-OCR-1.0-gguf/Modelfile <<'EOF'
FROM ./MiniCPM-OCR-1_0-Q8_0.gguf
FROM ./mmproj-model-f16-4x.gguf
DRAFT ./dspark-MiniCPM-OCR-1_0-Q8_0.gguf
REQUIRES 0.40.12
PARAMETER num_ctx 8192
PARAMETER temperature 0
PARAMETER draft_num_predict 15
EOF

ollama create minicpm-ocr -f ./models/MiniCPM-OCR-1.0-gguf/Modelfile
ollama show minicpm-ocr
ollama show minicpm-ocr --modelfile

curl --noproxy 127.0.0.1 -f http://127.0.0.1:18499/api/version
curl --noproxy 127.0.0.1 -f http://127.0.0.1:18499/api/tags
```

两个 `FROM` 分别加载主模型与视觉投影器，`DRAFT` 加载配套的 DSpark 草稿模型；所有路径均相对于 Modelfile 所在目录。`PARAMETER draft_num_predict 15` 将每轮草稿 token 上限设为 15。保留官方 GGUF 内嵌的对话模板。

`ollama show --modelfile` 应包含 `DRAFT` 和 `PARAMETER draft_num_predict 15`，`ollama show` 应包含 `vision` 能力，`/api/version` 应返回 `0.40.12` 或更新版本，`/api/tags` 应列出 `minicpm-ocr:latest`。服务地址为 **`http://127.0.0.1:18499`**，本地模型名为 **`minicpm-ocr`**。Ollama 会在首次推理请求时加载主模型和草稿模型，底层 llama.cpp 根据草稿文件元数据自动选择 `draft-dspark`。

首次推理时，服务日志应出现 `adding speculative implementation 'draft-dspark'`，生成后应有 `draft acceptance` 或 `statistics ... draft-dspark` 统计，用于确认 DSpark 实际参与了解码。
