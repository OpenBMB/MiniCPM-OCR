# 常见问题

安装、模型下载、显存、输入格式与输出异常等常见问题汇总。

## 安装问题

### `pip install minicpmvocr` 提示找不到包
**原因**：PyPI 发行包名为 `minicpm-ocr`，Python 导入名和命令为 `minicpmvocr`。

**解决**：`python -m pip install "minicpm-ocr[all]==1.0.3"`；从当前仓库开发安装可使用 `python -m pip install -e "./sdk[all]"`。

### `minicpmvocr parse` 报告缺少 `--config`
**原因**：安装的是旧版 SDK；当前版本的 `parse` 支持内置快速开始配置。

**解决**：按[教程](./minicpm_ocr_tutorial.md#1-sdk-环境配置)安装当前 SDK，启动识别服务后，在仓库根目录运行：

```bash
minicpmvocr parse doc.pdf -o doc.md --device cuda:0 \
  --server-url http://127.0.0.1:18499 --model minicpm-ocr
```

每次运行都需显式传入 `--server-url` 和 `--model`。自定义配置见 [SDK API 与配置说明](./minicpm_ocr_sdk_api.md)。

### `Could not find nvcc`（Blackwell/5090 首次启动）
**原因**：FlashInfer JIT 需要 nvcc；pip 的 CUDA 包中已包含该工具链。<br>
**解决**：设置 `CUDA_HOME=$VIRTUAL_ENV/lib/pythonX.Y/site-packages/nvidia/cu13`，并将 `$CUDA_HOME/bin` 加入 `PATH`

### `CUDA driver version is insufficient`
**原因**：当前推理环境使用 CUDA 13，默认需要 ≥580 的驱动。
**解决**：使用符合要求的驱动；对于 A100 等支持 CUDA 前向兼容的数据中心 GPU，也可按 [NVIDIA 兼容性说明](https://docs.nvidia.com/deploy/cuda-compatibility/forward-compatibility.html) 配置 `cuda-compat-13-0`。

在已配置 NVIDIA CUDA 软件源的 Ubuntu 系统中，安装兼容库，并在安装和启动 vLLM 的终端设置：

```bash
apt-get install -y cuda-compat-13-0
export OCR_CUDA_COMPAT_DIR=/usr/local/cuda-13.0/compat
export LD_LIBRARY_PATH="$OCR_CUDA_COMPAT_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export OCR_LIBCUDA="$OCR_CUDA_COMPAT_DIR/libcuda.so.1"
```

已有兼容库时，将 `OCR_CUDA_COMPAT_DIR` 改为其实际目录即可。环境变量仅对当前终端及其子进程生效，新开终端启动服务时需要重新设置；激活 `.venv-vllm` 不会自动恢复这些变量。若 vLLM 已安装完成，仅启动时提示 `The NVIDIA driver on your system is too old (found version 12040)`，设置变量后重新启动服务即可，无需重新编译。环境中装好 PyTorch 后，可用以下命令检查 GPU 运算：

```bash
.venv-vllm/bin/python -c 'import torch; x = torch.ones(1, device="cuda"); print(torch.cuda.get_device_name(0), (x + 1).item())'
```

### `bin/crt/link.stub: No such file or directory`
**原因**：pip 安装的 NVCC 包缺少链接时使用的 `bin/crt` 文件。
**解决**：使用当前安装脚本重新安装。脚本会从与 NVCC 版本一致的 NVIDIA 官方组件包中补齐文件，并校验 SHA-256；下载地址和校验值维护在 `pyproject.toml` 中。

### `flashinfer-cubin version does not match`
**解决**：执行 `pip uninstall flashinfer-cubin`；若存在 `vllm download-kernels` 命令则运行它

### `ptxas fatal: Unsupported .version 9.4`
**原因**：nvcc 13.0 无法编译 flashinfer 0.7 的 `compute_120f`。<br>
**解决**：将 nvcc/runtime/nvrtc/nvjitlink 统一到 13.4 系列

### `CUDA compiler and CUDA toolkit headers are incompatible`
**原因**：首次 FlashInfer JIT 使用的 nvcc 13.4.92 与 runtime 13.0.x 混用。<br>
**解决**：按步骤 2 将各 CUDA 组件对齐到统一的 runtime/nvrtc 13.4.92

### `ld: cannot find -lcudart`
**解决**：补充软链接：`lib64 -> lib`、`lib/libcudart.so -> libcudart.so.13`、`lib64/stubs/libcuda.so`（参见步骤 2A）

### `cuda_fp16.h ... nv/target: No such file`
**原因**：缺少 CCCL 头文件。<br>
**解决**：从源码编译 feat-ocr 时安装 `nvidia-cuda-cccl==13.3.4.3.1`

### `CUDA_nvrtc_LIBRARY ... NOTFOUND`
**解决**：补充软链接：`ln -sf libnvrtc.so.13 $CU/lib/libnvrtc.so`

### `Failed to clone https://github.com/nvidia/cutlass.git`
**原因**：内网环境 / 无法访问 GitHub。<br>
**解决**：使用 `VLLM_CUTLASS_SRC_DIR` 等 `*_SRC_DIR` 环境变量指向已有的 `.deps` 源码

### `No module named vllm._C`
**原因**：并非编译失败。该分支的扩展名为 `_C_stable_libtorch.abi3.so`。<br>
**解决**：用 `from vllm import LLM; LLM(...)` 做冒烟测试

### `deep_gemm ... undefined symbol: _ZSt8to_charsPcS_DF128_`
**影响**：非致命错误，vLLM 会跳过；OCR 模型不使用 DeepGEMM。彻底修复需重新编译该扩展或统一 libstdc++ 13

## 服务问题

### 启动时报 `unexpected keyword argument 'adaptive_tile_upsize'`
**原因**：当前固定版本的 vLLM 在视频预热时传入 `adaptive_tile_upsize`，而配套 Transformers 版本的 OCR 图像处理器不接受该参数。
**解决**：本文的文档识别流程只需要图片输入，在 vLLM 启动参数中显式关闭视频：`--limit-mm-per-prompt '{"image":36,"video":0}'`。保留当前终端的 CUDA 兼容库设置，重新启动服务即可，无需重新编译。PDF 仍由 SDK 渲染成页面图片后识别。

### 解析一直挂起直到超时且无结果
**原因**：启动时缺少 `--trust-request-mm-kwargs`。当前 vLLM 构建默认拒绝 `mm_processor_kwargs`（返回 400，SDK 静默重试）。<br>
**解决**：在 vLLM 启动命令中加入 `--trust-request-mm-kwargs`

### 服务正常运行但输出为空 / 乱码
**原因**：缺少 `chat_template_kwargs: {enable_thinking: false}`。<br>
**解决**：SDK 的 vllm 后端已内置该配置；transformers/openai 后端需在 `extra_body` 中补充

### 图像请求返回 400
**原因**：请求的图片数超过 `--limit-mm-per-prompt` 设置，或图像 data URI 格式不正确。
**解决**：在 vLLM 启动命令中补充该参数

### vLLM 启动报告 `Free memory on device ... less than desired GPU memory utilization`
**原因**：该 GPU 已被其他进程占用。<br>
**解决**：通过 `CUDA_VISIBLE_DEVICES` 指定空闲 GPU

## 运行时问题

### `show-config` 报告 `At least one of input... is required`
**原因**：`show-config` 同样会校验输入。<br>
**解决**：补充 `--set input.file_path=<existing_file>`

### feat-ocr 首次运行 `verify_vllm.py` 被 SIGTERM 终止 / 图捕获超时
**原因**：首次 CUDA 图捕获可能较慢。<br>
**解决**：待缓存预热后重跑一次；若仍失败，加上 `--enforce-eager`

### 小尺寸裁剪图报 `assign N multimodal tokens to M placeholders`
**原因**：vLLM ≤0.22 的占位符 bug。<br>
**解决**：升级到当前的 feat-ocr vLLM 构建

### 表格输出中出现 `<otsl>`
**原因**：API 直接输出的是 OTSL 格式。<br>
**解决**：使用 SDK 流水线（步骤 5）自动转换为 HTML；API 直出结果需手动转换

### OOM（显存不足）
**解决**：将 `--gpu-memory-utilization` 降到 0.7，或将 `--max-model-len` 减小到 16384

### 已安装 CPU 版 paddle，版面分析仍报 CUDA 错误
**原因**：`layout.device` 默认值为 `cuda`。<br>
**解决**：补充 `--set layout.device=cpu`（GPU 版无需此项）

### 版面分析报告缺少 `pypdfium2` / 依赖缺失
**解决**：显式安装 `pip install "pypdfium2>=4"`；0.2.3 的 `[all]` 已包含它，更早的源码包可能缺失。即使输入仅为图像，也需要 pypdfium2

## 网络与环境

### 内网 / 容器内 pip 超时
**解决**：切换到清华或阿里云镜像源；访问 localhost 时设置 `no_proxy=127.0.0.1,localhost,::1`

### 服务部署在远程机器
**解决**：执行 `ssh -L 18499:127.0.0.1:18499 user@host`，前端使用 `VLLM_URL=http://127.0.0.1:18499`

### 磁盘空间不足
**要求**：两套环境加模型需要 ≥20GB；若系统盘 / 数据盘接近写满，请切换到更大的磁盘

## 环境配置

### 想合并 feat-ocr 的两套 torch 环境
**说明**：合并是**可选**的，仅在需要双后端逐位比对验证时才有必要。若只做服务部署或解析，安装 vLLM 或 transformers 其中之一即可。<br>
**解决**：如需合并：先编译 vLLM，然后执行 `pip install --no-deps -e <transformers_source>`，最后执行 `pip install --no-deps accelerate`

---

若遇到本文未覆盖的问题，请参阅[详细教程](./minicpm_ocr_tutorial.md)或在 GitHub 上提交 issue。
