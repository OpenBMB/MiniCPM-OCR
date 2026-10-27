---
name: minicpmvocr-sdk
description: 安装、部署和验证 MiniCPM-OCR 1.0 文档解析（PDF / 图片 → Markdown）。在用户要安装 minicpmvocr SDK、启动 vLLM 或 transformers 推理服务（含 DSpark 加速版）、解析文档、排查安装与推理报错，或做 vLLM 与 transformers 双端逐字验证时使用。
---

# MiniCPM-OCR 1.0 部署

SDK（`minicpmvocr`）负责版面检测（PP-DocLayoutV3）、切块、拼接和并发调度，通过 HTTP 调用推理服务。SDK 和推理服务装在不同的 venv 里。

## 1. 确定方案

先问清用户用哪个推理后端、SDK 与服务是否在同一台机器。用户没有偏好时用默认方案。

| 用户目标 | 环境 |
|---|---|
| 解析文档（默认） | `sdk-env` + `vllm-ocr-env`，DSpark 加速版 |
| 不想编译 vLLM | `sdk-env` + `tf-ocr-env` |
| 已有 llama.cpp / OpenAI 兼容服务 | 只装 `sdk-env` |
| vLLM 与 transformers 双端逐字验证 | 两个推理环境，或合并的 `ocr-env`（见第 7 节） |

- 推理环境只装一个，除非用户要做双端验证。
- `sdk-env` 不能和 torch / vLLM 装在一起，否则 numpy、opencv 版本冲突。
- SDK 可以在没有 GPU 的机器上运行，用 `--server-url` 或 SSH 隧道连接远程服务。

## 2. 安装前检查

```bash
nvidia-smi                                                      # 显存 ≥ 24 GB，驱动 ≥ 580
nvidia-smi --query-compute-apps=pid,used_memory --format=csv    # 找一张空闲卡
df -h .                                                         # 剩余 ≥ 20 GB
```

- 驱动 535–579 跑不了默认组合（torch cu130）。告诉用户需要升级驱动，或改用 torch cu126 自行编译 vLLM（A100 上验证过，本 skill 不覆盖）。
- vLLM 环境需要 Python ≥ 3.11；SDK 和 transformers 环境 ≥ 3.10。

需要用户提供的路径（没有给出时先问，不要猜）：

| 占位符 | 含义 |
|---|---|
| `<SDK_REPO>` | 官方仓库地址：`https://github.com/OpenBMB/MiniCPM-OCR.git` |
| `<VLLM_SRC>` | feat-ocr vLLM 源码目录（commit `5c2b92a5dc`） |
| `<TRANSFORMERS_SRC>` | feat-ocr transformers 源码目录（commit `69eafbc5bd`） |

以下命令都在同一个工作目录下执行：环境建在 `./sdk-env` 等目录，模型在 `./models/`，仓库克隆到 `./minicpmvocr-sdk/`，SDK 源码在其 `sdk/` 子目录。

## 3. 安装

### 3.1 sdk-env

```bash
python3 -m venv sdk-env && source sdk-env/bin/activate
pip install paddlepaddle-gpu==3.3.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu129/
# 没有 GPU 时改装 CPU 版：pip install paddlepaddle==3.2.1
git clone <SDK_REPO> minicpmvocr-sdk
pip install -e "./minicpmvocr-sdk/sdk[all]"
pip install paddlex==3.4.2
minicpmvocr list-backends
```

通过标准：输出包含 `vllm`、`llamacpp`、`openai` 后端和 `ppdoclayout3_paddlex`、`ppdoclayout3_torch`、`ppdoclayout3_server` 三个版面 provider。

装的是 CPU 版 paddle 时，后面每条 `minicpmvocr` 命令都要加 `--set layout.device=cpu`。

### 3.2 vllm-ocr-env

```bash
sudo add-apt-repository -y ppa:ubuntu-toolchain-r/test
sudo apt-get update && sudo apt-get install -y gcc-13 g++-13 libdw-dev libelf-dev

python3.13 -m venv vllm-ocr-env && source vllm-ocr-env/bin/activate
pip install torch==2.14.0 torchaudio==2.11.0 torchvision==0.29.0
pip install "transformers>=5.16.1,<5.20.0"
pip install "setuptools-rust>=1.9.0" "setuptools-scm>=8.0" "setuptools>=77.0.3,<81.0.0" \
    "cmake>=3.26.1" ninja packaging wheel jinja2
pip install nvidia-cuda-nvcc==13.0.48 nvidia-cuda-crt==13.0.48 nvidia-nvvm==13.0.48 \
    nvidia-cuda-runtime==13.0.96 nvidia-cuda-nvrtc==13.0.88 nvidia-nvjitlink==13.4.92 \
    nvidia-cuda-cccl==13.3.4.3.1
```

`nvidia-cuda-cccl` 不能省，缺了会报 `cuda_fp16.h: nv/target: No such file or directory`。

补齐 pip CUDA 包的目录布局：

```bash
CU="$VIRTUAL_ENV/lib/python$(python -c 'import sys; print("%d.%d" % sys.version_info[:2])')/site-packages/nvidia/cu13"
mkdir -p "$CU/nvvm/bin" && ln -sf "$CU/bin/cicc" "$CU/nvvm/bin/cicc"
ln -sfn lib "$CU/lib64"
ln -sf "$CU/lib/libcudart.so.13" "$CU/lib/libcudart.so"
ln -sf "$CU/lib/libnvrtc.so.13" "$CU/lib/libnvrtc.so"
mkdir -p "$CU/lib64/stubs" && ln -sf /usr/lib/x86_64-linux-gnu/libcuda.so.1 "$CU/lib64/stubs/libcuda.so"
```

如果 13.0.48 的包缺少 `bin/crt/link.stub`、`prelink.stub` 或 `bin/nvdisasm`，从同一台机器上装了 13.4.92 的环境复制到 `$CU/bin/` 对应位置。

编译（96 核约 20 分钟；内存小时调低 `MAX_JOBS`）：

```bash
cd <VLLM_SRC>
# 无法访问 GitHub 时，先设置下面“离线编译”中的变量
CUDA_HOME="$CU" PATH="$VIRTUAL_ENV/bin:$CU/bin:$PATH" \
  CC=gcc-13 CXX=g++-13 CUDAHOSTCXX=g++-13 MAX_JOBS=64 \
  pip install -e . --no-build-isolation --progress-bar off
cd -
python -c "from vllm import LLM; print('vLLM OK')"
```

不要用 `import vllm._C` 判断编译是否成功。这个分支的扩展名是 `_C_stable_libtorch.abi3.so`。

DSpark 主模型是 `minicpm_ocr` 架构，PyPI 的 transformers 不支持。编译完 vLLM 后再装 feat-ocr transformers，顺序不能反：

```bash
pip install --no-deps -e <TRANSFORMERS_SRC>
python -c "import transformers; print(transformers.__version__)"   # 应为 5.19.0.dev0
```

离线编译（CMake 拉取 CUTLASS 等依赖超时时）：

```bash
DEPS=<已有 vLLM 源码>/.deps
export VLLM_CUTLASS_SRC_DIR="$DEPS/cutlass-src"
export VLLM_FLASH_ATTN_SRC_DIR="$DEPS/vllm-flash-attn-src"
export FLASH_KDA_SRC_DIR="$DEPS/flashkda-src"
export DEEPSELECT_SRC_DIR="$DEPS/deepselect-src"
export FLASH_MLA_SRC_DIR="$DEPS/flashmla-src"
export TRITON_KERNELS_SRC_DIR="$DEPS/triton_kernels-src/python/triton_kernels/triton_kernels"
export TML_FA4_SRC_DIR="$DEPS/tml_fa4-src"
export FMHA_SM100_SRC_DIR="$DEPS/fmha_sm100-src"
export QUTLASS_SRC_DIR="$DEPS/qutlass-src"
export DEEPGEMM_SRC_DIR="$DEPS/deepgemm-src"
export CMAKE_ARGS="-DCUTLASS_ENABLE_TESTS=OFF"   # 否则还会拉取 googletest
```

编译后可以忽略的告警：

- `vllm.third_party.deep_gemm ... undefined symbol: _ZSt8to_charsPcS_DF128_`：OCR 模型不用 DeepGEMM。
- `FlashInfer's precompiled kernels are missing or do not match`：冷启动会慢一些（实测初始化约 104 秒），不影响结果。

### 3.3 tf-ocr-env

```bash
python3 -m venv tf-ocr-env && source tf-ocr-env/bin/activate
pip install torch==2.14.0 torchvision
pip install -e <TRANSFORMERS_SRC>         # 需要 OpenAI 兼容服务时装 "<TRANSFORMERS_SRC>[serving]"
pip install accelerate
# 可选加速内核，不装时回退参考实现，结果相同但更慢：
# pip install causal-conv1d flash-linear-attention
```

### 3.4 下载模型

主模型：[MiniCPM-OCR-1.0](https://huggingface.co/openbmb/MiniCPM-OCR-1.0)；DSpark 草稿模型：[MiniCPM-OCR-1.0-DSpark](https://huggingface.co/openbmb/MiniCPM-OCR-1.0-DSpark)。

```bash
# DSpark：主模型和 draft 必须来自同一次发布，不能和其他 checkpoint 混用
HF_ENDPOINT=https://hf-mirror.com hf download openbmb/MiniCPM-OCR-1.0 --local-dir ./models/MiniCPM-OCR-1.0
HF_ENDPOINT=https://hf-mirror.com hf download openbmb/MiniCPM-OCR-1.0-DSpark --local-dir ./models/MiniCPM-OCR-1.0-DSpark
sha256sum ./models/MiniCPM-OCR-1.0-DSpark/model.safetensors   # 对照 release_manifest.json 的 weight_sha256

curl -L -o PP-DocLayoutV3_infer.tar \
  https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-DocLayoutV3_infer.tar
tar xf PP-DocLayoutV3_infer.tar
export OCR_LAYOUT_MODEL_DIR=$PWD/PP-DocLayoutV3_infer
test -f "$OCR_LAYOUT_MODEL_DIR/inference.pdiparams" && echo "layout OK"
```

- ModelScope：`modelscope download --model <MS_REPO_ID> --local_dir <同名目录>`。
- 主模型目录应包含 `config.json`、`model.safetensors`、`tokenizer.json`、`preprocessor_config.json`、`chat_template.jinja`。
- `OCR_LAYOUT_MODEL_DIR` 必须是 Paddle inference 目录（含 `inference.pdiparams`、`inference.json`、`inference.yml`），不是 safetensors 目录。

## 4. 启动推理服务

每个新 shell 里启动 vLLM 前都要设置 `CUDA_HOME`，否则 Blackwell 显卡首次启动会报 `Could not find nvcc`：

```bash
source vllm-ocr-env/bin/activate
CU="$VIRTUAL_ENV/lib/python$(python -c 'import sys; print("%d.%d" % sys.version_info[:2])')/site-packages/nvidia/cu13"
export CUDA_HOME="$CU" PATH="$VIRTUAL_ENV/bin:$CU/bin:$PATH"
```

### 4.1 DSpark 加速版（默认）

```bash
CUDA_VISIBLE_DEVICES=<空闲卡> python -m vllm.entrypoints.openai.api_server \
  --model ./models/MiniCPM-OCR-1.0 \
  --served-model-name minicpm-ocr \
  --port 18499 \
  --max-model-len 40960 \
  --max-num-batched-tokens 40960 \
  --max-num-seqs 1 \
  --attention-backend FLASH_ATTN \
  --mm-encoder-attn-backend FLASH_ATTN \
  --mm-processor-kwargs '{"downsample_mode":"4x"}' \
  --gpu-memory-utilization 0.85 \
  --trust-request-mm-kwargs \
  --speculative-config '{"method":"dspark","model":"./models/MiniCPM-OCR-1.0-DSpark","num_speculative_tokens":15,"enable_adaptive_verification":false}' \
  --default-chat-template-kwargs '{"enable_thinking":false}'
```

- `--max-num-seqs 1` 表示一次只处理一个请求，SDK 的并发请求会排队。用户需要高吞吐时，起多个实例并重复传 `--server-url`，或改用标准版。
- 服务启动时使用 `--served-model-name minicpm-ocr`，SDK 解析命令对应使用 `--model minicpm-ocr`。修改名称时，两处需一起修改。

### 4.2 标准版（无投机采样）

```bash
CUDA_VISIBLE_DEVICES=<空闲卡> python -m vllm.entrypoints.openai.api_server \
  --model ./models/MiniCPM-OCR-1.0 \
  --served-model-name minicpm-ocr \
  --port 18499 \
  --max-model-len 40960 \
  --limit-mm-per-prompt '{"image": 36}' \
  --gpu-memory-utilization 0.85 \
  --trust-request-mm-kwargs
```

两个版本都必须带 `--trust-request-mm-kwargs`。漏掉时服务对每个请求返回 400，SDK 会静默重试，直到 600 秒后才报错，看起来像卡死。

### 4.3 transformers serve

```bash
source tf-ocr-env/bin/activate
transformers serve ./models/MiniCPM-OCR-1.0 --port 18499 --host 0.0.0.0 --continuous-batching
```

### 4.4 就绪检查

```bash
curl --noproxy 127.0.0.1 http://127.0.0.1:18499/v1/models     # 首次启动约 3 分钟
```

返回里有 `"id":"minicpm-ocr"` 才算就绪。首次启动在 CUDA graph capture 阶段超时或被 SIGTERM 时，直接重启一次（编译缓存已经生成）；仍然失败再加 `--enforce-eager`。

## 5. 解析文档

```bash
source sdk-env/bin/activate
export OCR_LAYOUT_MODEL_DIR=$PWD/PP-DocLayoutV3_infer
export PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True

minicpmvocr parse --config minicpmvocr-sdk/configs/backends/vllm.yaml \
  --server-url http://127.0.0.1:18499 \
  --model minicpm-ocr \
  --set input.limit=1 --input <文件> --output out.md
```

- 先用 `--set input.limit=1` 只解析一页，确认通过后再去掉，解析全部页面。
- 配置文件都在 `minicpmvocr-sdk/configs/backends/`：vLLM 用 `vllm.yaml`；transformers serve 和其他 OpenAI 兼容服务用 `openai.yaml`；llama.cpp 用 `llamacpp.yaml`。
- 用 `openai.yaml` 时加 `--set engine.extra_body='{"chat_template_kwargs":{"enable_thinking":false}}'`，否则输出可能为空或乱码。`vllm.yaml` 已自动关闭思考模式。
- 多卡机器上版面检测默认用 GPU 0。GPU 0 被占用时加 `--set layout.device=cuda:N`。
- 除 `parse` 外的命令（`run`、`parse-layout`、`prepare`、`infer`、`show-config`）都要用 `--set input.file_path`、`input.files_dir` 或 `input.image_dir` 指定输入。
- `--set` 里的相对路径按配置文件所在目录解析，一律写绝对路径（如 `$PWD/doc.pdf`）。`--input` 按当前目录解析。
- `run` 的输出目录由配置里固定的 `run.run_tag` 决定，已有结果的页面会被跳过。重跑前换 `--set run.run_tag=<新名字>`。
- 产物默认写在 SDK 目录的 `runs/` 下。磁盘紧张时加 `--set run.run_root=<其他盘的绝对路径>`。

## 6. 验证结果

```bash
python - <<'PY'
from pathlib import Path
md = Path("out.md").read_text(encoding="utf-8")
assert md.strip(), "输出为空"
assert "<otsl>" not in md, "表格仍是 OTSL，没有转成 HTML"
print("OK", len(md), "chars", "| table" if "<table>" in md else "")
PY
```

- 表格页应有 `<table>`，公式页应有 LaTeX（如 `\frac`），正文页应是可读文本。
- DSpark 版本还要确认投机采样生效。发几个请求后：

```bash
curl --noproxy 127.0.0.1 -s http://127.0.0.1:18499/metrics | grep spec_decode_num
```

应看到 `spec_decode_num_accepted_tokens_total` 和 `spec_decode_num_drafts_total`，且数值随请求增加。accept length = 1 + accepted / drafts，验证环境中为 5.2–7.0。没有这两项说明服务没带 `--speculative-config`。服务能响应不代表 DSpark 生效。

## 7. 可选：双端逐字验证

只有用户要求时才做。`verify_transformers.py` 和 `verify_vllm.py` 随 feat-ocr 源码提供，不在 SDK 里。用户没有这两个脚本时跳过，不要声称已验证双端一致。

如果想在一个环境里跑两端，在编译好 vLLM 的环境里执行（顺序不能反）：

```bash
pip install --no-deps -e <TRANSFORMERS_SRC>
pip install --no-deps accelerate
python -c "import transformers, vllm, torch; print(transformers.__version__, vllm.__version__, torch.__version__)"
```

两端分别运行：

```bash
# transformers 端（tf-ocr-env 或合并环境）
CUDA_VISIBLE_DEVICES=<空闲卡> python verify_transformers.py \
  --model ./models/MiniCPM-OCR-1.0 --image table.png \
  --prompt "请识别图中的表格并输出 OTSL" --attn sdpa --max-new-tokens 512

# vLLM 端（vllm-ocr-env 或合并环境，先按第 4 节设置 CUDA_HOME）
CUDA_VISIBLE_DEVICES=<空闲卡> python verify_vllm.py \
  --model ./models/MiniCPM-OCR-1.0 --image table.png \
  --prompt "请识别图中的表格并输出 OTSL" --max-tokens 512
```

通过标准：

- transformers 端加载时没有 missing、unexpected 或 mismatched keys，参数量 1.300B。
- 两端的 prompt token 数相同，输出逐字相同，都以 `</otsl>` 结尾。

参考值（1080×1080 表格图）：prompt 1975 tokens，视觉 1936 tokens，生成 284 tokens，输出 677 字符。换图片或 prompt 后数值会变，判断依据是两端一致。

## 8. 报错处理

### 安装与编译

| 现象 | 处理 |
|---|---|
| `Failed to clone https://github.com/nvidia/cutlass.git` | 无法访问 GitHub，按 3.2 的离线编译设置 `*_SRC_DIR` |
| 关掉 CUTLASS 拉取后还要拉 `googletest` | 设 `CMAKE_ARGS="-DCUTLASS_ENABLE_TESTS=OFF"` |
| `Could not find a package configuration file provided by "MLIR"` | `TRITON_KERNELS_SRC_DIR` 层级错了，应指向 `.../python/triton_kernels/triton_kernels` |
| 编译中大量 `FAILED: [code=9]` | 编译进程因内存不足被杀。调低 `MAX_JOBS`（147 GB 内存用 8–32），先装 `ccache` 避免重编 |
| `ld: cannot find -lcudart` | 补 3.2 里的 `lib64`、`libcudart.so`、`stubs/libcuda.so` 链接 |
| `CUDA_nvrtc_LIBRARY ... NOTFOUND` | 补 `libnvrtc.so` 链接 |
| `cuda_fp16.h ... nv/target: No such file` | 装 `nvidia-cuda-cccl==13.3.4.3.1` |
| `No module named vllm._C` | 不是编译失败，用 `from vllm import LLM` 验证 |
| vLLM 环境里 transformers 是 `5.19.0` 而非 `5.19.0.dev0` | editable 安装被 vLLM 依赖覆盖，重新 `pip install --no-deps -e <TRANSFORMERS_SRC>` |
| 版面报缺 `pypdfium2` | `pip install "pypdfium2>=4"`，只处理图片也需要 |

### 启动服务

| 现象 | 处理 |
|---|---|
| `model type 'minicpm_ocr' ... does not recognize this architecture` | vLLM 环境缺 feat-ocr transformers，按 3.2 安装。不需要重编 vLLM |
| `Could not find nvcc` | 没有设置 `CUDA_HOME`，见第 4 节 |
| `ptxas fatal: Unsupported .version 9.4` 或 `CUDA compiler and CUDA toolkit headers are incompatible` | 把 nvcc、runtime、nvrtc、nvjitlink 统一到 13.4.92，再按 3.2 补链接 |
| `flashinfer-cubin version does not match` | `pip uninstall flashinfer-cubin`；`vllm download-kernels` 存在时运行它 |
| `CUDA driver version is insufficient` | 驱动低于 580，见第 2 节 |
| 驱动 < 580 时报 `TopKMaskLogits ... device kernel image is invalid` | 设 `VLLM_USE_FLASHINFER_SAMPLER=0`，贪心解码结果相同 |
| 驱动 < 580 时报 `nvcc fatal: Unknown option '--compress-mode=size'` | `CUDA_HOME` 指向与 torch 匹配的工具链（cu126 对应 12.8） |
| 导入 vLLM 时报 `libtorchcodec_image.so` | `pip uninstall torchcodec` |
| `Free memory on device ... less than desired GPU memory utilization` | 这张卡被占用，换 `CUDA_VISIBLE_DEVICES` |
| OOM | `--gpu-memory-utilization` 降到 0.7，或 `--max-model-len` 降到 16384 |
| CUDA graph capture 超时或被 SIGTERM | 重启一次；仍失败加 `--enforce-eager` |

### 解析

| 现象 | 处理 |
|---|---|
| 解析长时间没有结果，日志里出现 `request failed until timeout` | 服务漏了 `--trust-request-mm-kwargs`，请求被拒后 SDK 一直重试到 600 秒超时 |
| SDK 等待很久后报 `no ... endpoint became ready within 1800s` | 服务没起来或地址不对，先用 `curl /v1/models` 检查 |
| 带图请求返回 400 | 标准版漏了 `--limit-mm-per-prompt '{"image": 36}'` |
| 输出为空或乱码 | 思考模式没关，见第 5 节 |
| 表格是 `<otsl>` 而不是 `<table>` | 直接调用 API 时不会转换，要走 SDK 流水线 |
| crop 小图报 `assign N multimodal tokens to M placeholders` | vLLM 版本太旧，换成 feat-ocr build |
| 版面报 CUDA 错误 | 装的是 CPU 版 paddle，加 `--set layout.device=cpu` |
| `At least one of input.image_dir / input.files_dir / input.file_path is required` | 加 `--set input.file_path=<文件的绝对路径>` |
| `input.file_path not found`，但文件存在 | `--set` 里用了相对路径，改成绝对路径 |
| `run` 重跑结果没变 | 换 `--set run.run_tag=<新名字>` |
| pip 超时 | 换国内镜像。访问 localhost 时设 `no_proxy=127.0.0.1,localhost,::1` |
| 服务在远程机器 | `ssh -L 18499:127.0.0.1:18499 user@host`，SDK 用 `--server-url http://127.0.0.1:18499` |

## 9. 已验证版本

| 组件 | 版本 |
|---|---|
| vLLM 环境 | Python 3.13.9，torch 2.14.0+cu130，vLLM 源码 `5c2b92a5dc`，feat-ocr transformers `69eafbc5bd` |
| transformers 环境 | Python 3.10.12 / 3.13.9，torch 2.14.0+cu130，transformers 5.19.0.dev0（`69eafbc5bd`） |
| SDK 环境 | minicpmvocr 0.2.3，paddlepaddle-gpu 3.3.0 或 paddlepaddle 3.2.1，paddlex 3.4.2 |
| 硬件 | 3×RTX 5090，驱动 590.48.01，Ubuntu 22.04.5（2026-10-19） |

## 10. 汇报规则

- 5090 只是验证用的机器，不要说必须用 5090。门槛是显存 ≥ 24 GB 和驱动 ≥ 580。
- 只汇报实际跑过的检查。没跑双端验证就不要说两端一致；没查 `/metrics` 就不要说 DSpark 生效。
- SDK 仓库里没有 Web UI 脚本，不要向用户提及或引导用户运行任何 `demo_*.py`。
