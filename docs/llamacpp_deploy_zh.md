# llama.cpp 部署指南

[English](./llamacpp_deploy.md)

[← 返回首页](../README_zh.md)

使用 **Q8_0 主模型、Q8_0 DSpark 草稿头和 F16 4× 视觉投影**联合部署 MiniCPM-OCR 1.0，默认启用 DSpark 推测解码。以下命令均在**本仓库根目录**通过 Bash 执行。

## 1. 安装 llama.cpp

使用已验证的参考版本 **[b11901](https://github.com/ggml-org/llama.cpp/releases/tag/b11901)**。源码编译需要 Git、CMake 和 C++ 编译器：

```bash
mkdir -p ./sources
git clone --branch b11901 --depth 1 https://github.com/ggml-org/llama.cpp.git ./sources/llama.cpp
cmake -S ./sources/llama.cpp -B ./sources/llama.cpp/build -DCMAKE_BUILD_TYPE=Release
cmake --build ./sources/llama.cpp/build -j --target llama-server
./sources/llama.cpp/build/bin/llama-server --version
```

Apple Silicon 默认启用 Metal；Linux 上述配置构建 CPU 后端。使用 NVIDIA GPU 时，安装 CUDA toolkit，并在构建前为 `cmake -S ...` 配置命令追加 `-DGGML_CUDA=ON`。其他后端见官方[编译说明](https://github.com/ggml-org/llama.cpp/blob/b11901/docs/build.md)。

也可以从同一发布页下载并解压适合当前系统的预编译包，将下文的 `./sources/llama.cpp/build/bin/llama-server` 替换为解压后的 `llama-server` 可执行文件路径，并保留其配套动态库。下文服务命令已使用官方 b11901 macOS ARM64 预编译包验证。

## 2. 下载主模型、视觉投影和 DSpark 草稿头

从 [主模型仓库](https://huggingface.co/openbmb/MiniCPM-OCR-1.0-gguf) 下载主模型和视觉投影器，从 [DSpark GGUF 仓库](https://huggingface.co/openbmb/MiniCPM-OCR-1.0-DSpark-gguf) 下载配套量化草稿模型。三个文件均需下载，并使用同一 1.0 发布版本的配套权重：

| 文件 | 大小约 | 用途 |
|---|---|---|
| `MiniCPM-OCR-1_0-Q8_0.gguf` | 0.81 GB | Q8_0 主模型 |
| `mmproj-model-f16-4x.gguf` | 0.90 GB | F16 视觉投影器，图片输入必需 |
| `dspark-MiniCPM-OCR-1_0-Q8_0.gguf` | 0.33 GB | Q8_0 DSpark 草稿模型，用于推测解码 |

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

在仓库根目录的服务终端中执行：

```bash
./sources/llama.cpp/build/bin/llama-server \
  --model ./models/MiniCPM-OCR-1.0-gguf/MiniCPM-OCR-1_0-Q8_0.gguf \
  --mmproj ./models/MiniCPM-OCR-1.0-gguf/mmproj-model-f16-4x.gguf \
  --model-draft ./models/MiniCPM-OCR-1.0-gguf/dspark-MiniCPM-OCR-1_0-Q8_0.gguf \
  --spec-type draft-dspark \
  --spec-draft-n-max 15 \
  --n-gpu-layers 99 \
  --gpu-layers-draft 99 \
  --flash-attn on \
  --ctx-size 8192 \
  --parallel 1 \
  --host 127.0.0.1 \
  --port 18499 \
  --alias minicpm-ocr \
  --jinja \
  --reasoning off
```

保持该终端运行。服务地址为 **`http://127.0.0.1:18499`**，OpenAI 兼容聊天接口为 **`/v1/chat/completions`**，模型名为 **`minicpm-ocr`**。请选择空闲端口；若 Ollama 已占用 `18499`，先停止该实例，或同步修改全部命令中的端口。

- `--model-draft` 加载匹配的量化 DSpark 头，`--spec-type draft-dspark` 指定 DSpark 解码。草稿头不能单独提供 OCR 服务。
- `--spec-draft-n-max 15` 将每步最大草稿长度设为 15 个 token；`--flash-attn on` 启用 Flash Attention。
- `--n-gpu-layers 99` 和 `--gpu-layers-draft 99` 将主模型和草稿模型的层卸载到 GPU。纯 CPU 部署时，将两项均设为 `0`，并追加 `--no-mmproj-offload`。
- `--ctx-size 8192 --parallel 1` 启用单个请求槽位，上下文长度为 8192 token。若图像 token 与输出总量超过此限制，可提高上下文长度，内存占用也会增加。
- `--jinja --reasoning off` 使用官方 GGUF 内置聊天模板并关闭思考。

## 4. 检查服务

另开一个终端执行：

```bash
curl --noproxy 127.0.0.1 -f http://127.0.0.1:18499/health
curl --noproxy 127.0.0.1 -f http://127.0.0.1:18499/v1/models
```

`/health` 应返回 `{"status":"ok"}`，`/v1/models` 应包含 `minicpm-ocr`。服务启动日志应出现 `adding speculative implementation 'draft-dspark'` 和 `n_max=15`；首次推理后，检查 `draft acceptance` 以及接受、生成的 token 数，确认 DSpark 已参与解码。
