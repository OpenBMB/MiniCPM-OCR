# FlagOS 多芯片部署

[← 返回 README](../README_zh.md#本地部署) · [English](./flagos_deploy_en.md)

MiniCPM-OCR 系列支持通过 FlagOS 进行多芯片部署，将文档解析与识别结果的可信度判别接入不同算力平台。开发者可单独部署 MiniCPM-OCR 1.0 完成 OCR 任务，也可结合 MiniCPM-OCR Jev 构建“文档解析 → 可信度判别 → 人工复核”的处理流程。

## FlagOS 介绍

为推动不同 AI 芯片的大规模应用，北京智源人工智能研究院联合科研机构、芯片企业、系统厂商及算法和软件相关单位，共同发起并创立了众智 FlagOS 开源社区。

FlagOS 致力于打造面向多种 AI 芯片的统一、开源系统软件栈，包括大型算子库、统一 AI 编译器、并行训推框架和统一通信库等核心开源项目，构建“模型—系统—芯片”三层贯通的开放技术生态。在适配支持范围内，开发者可以复用模型接入与算子优化成果，实现一次开发、跨芯迁移，降低不同芯片软件栈之间的迁移成本。

社区官网：[flagos.io](https://flagos.io/) · 开发者文档：[docs.flagos.io](https://docs.flagos.io/en/latest/)

<a id="model-downloads"></a>

## FlagOS 多 AI 芯片支持与下载

FlagRelease 是 FlagOS 团队构建的面向多架构 AI 芯片的模型自动迁移、适配与发布平台。本次提供两个模型的 **BF16** 多芯版本，**分别覆盖平头哥、英伟达、华为昇腾、海光、昆仑芯、沐曦、摩尔线程、清微智能、天数智芯、曦望、M5 及此芯，共 12 款芯片**：

- **MiniCPM-OCR 1.0（1.3B）**：基于 MiniCPM-V 4.6 进行 OCR 特化，面向文字识别与文档解析，支持真实拍摄文档和复杂表格等场景。
- **MiniCPM-OCR Jev（2B）**：独立的 OCR 识别结果判别模型，为识别结果提供经校准的可信度，帮助人工优先复核可能存在识别错误的内容。

下表提供两款模型经 FlagOS 适配后的多芯片模型镜像在 ModelScope 与 Hugging Face 上的下载地址。模型文件、部署代码、镜像拉取与容器启动说明见对应模型卡。

| 芯片 / 平台 | MiniCPM-OCR 1.0                                                                                                                                                                           | MiniCPM-OCR Jev                                                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 平头哥     | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-zhenwu-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-zhenwu-FlagOS)         | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-zhenwu-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-zhenwu-FlagOS)         |
| 英伟达     | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-nvidia-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-nvidia-FlagOS)         | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-nvidia-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-nvidia-FlagOS)         |
| 华为昇腾    | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-ascend-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-ascend-FlagOS)         | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-ascend-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-ascend-FlagOS)         |
| 海光      | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-hygon-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-hygon-FlagOS)           | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-hygon-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-hygon-FlagOS)           |
| 昆仑芯     | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-kunlunxin-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-kunlunxin-FlagOS)   | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-kunlunxin-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-kunlunxin-FlagOS)   |
| 沐曦      | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-metax-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-metax-FlagOS)           | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-metax-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-metax-FlagOS)           |
| 摩尔线程    | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-mthreads-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-mthreads-FlagOS)     | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-mthreads-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-mthreads-FlagOS)     |
| 清微智能    | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-tsingmicro-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-tsingmicro-FlagOS) | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-tsingmicro-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-tsingmicro-FlagOS) |
| 天数智芯    | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-iluvatar-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-iluvatar-FlagOS)     | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-iluvatar-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-iluvatar-FlagOS)     |
| 曦望      | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-sunrise-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-sunrise-FlagOS)       | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-sunrise-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-sunrise-FlagOS)       |
| ARM 端侧  | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-arm-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-arm-FlagOS)               | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-arm-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-arm-FlagOS)               |

ARM 端侧统一使用表中的 `arm` 版本入口，两款模型均为 BF16；具体支持设备、运行环境与部署方式以对应模型卡为准。

## FlagOS 安装与使用

### 方式一：使用 FlagRelease 镜像（推荐）

1. 从上表选择目标芯片平台和模型。仅需文档解析时选择 MiniCPM-OCR 1.0；需要对识别结果进行可信度判别时，再选择对应平台的 MiniCPM-OCR Jev。
2. 按模型卡准备宿主机驱动和运行时，拉取相应镜像，并配置设备映射、模型目录和文档图像目录挂载后启动容器。
3. 在对应环境中运行模型卡提供的 OCR 或 MiniCPM-OCR Jev 示例。模型路径、设备配置、批量大小、图像预处理和启动参数均以所选平台的模型卡为准。

如需先下载模型文件，以下以**平头哥平台的 Hugging Face 仓库**为例，与后文的源码安装示例保持一致：

```bash
python -m pip install --upgrade huggingface_hub

# 下载 OCR 文档解析模型
hf download FlagRelease/MiniCPM-OCR-1.0-BF16-zhenwu-FlagOS \
  --local-dir ./models/MiniCPM-OCR-1.0

# 可选：下载 Jev 可信度判别模型
hf download FlagRelease/MiniCPM-OCR-Jev-BF16-zhenwu-FlagOS \
  --local-dir ./models/MiniCPM-OCR-Jev
```

使用其他平台时，将仓库名替换为上表中的对应版本；也可从 ModelScope 获取模型文件。容器内的模型路径应指向挂载后的模型目录。

### 方式二：从源码安装

#### 1. MiniCPM-OCR 1.0：vLLM-plugin-FL

以下以**平头哥平台的 MiniCPM-OCR 1.0** 为例，安装 **vLLM-plugin-FL 推理环境**。示例使用 **vLLM v0.24.0、vllm-plugin-FL v0.3.0、FlagGems v5.4.0**。安装前请按模型卡准备芯片驱动、运行时、PyTorch 和构建依赖。

vLLM-plugin-FL 官方开发者指南：[GitHub](https://github.com/flagos-ai/vllm-plugin-FL/blob/main/README.md) / [GitCode](https://gitcode.com/flagos-ai/vllm-plugin-FL/blob/main/README.md)。

```bash
# 1. 安装 vLLM v0.24.0（平头哥平台示例）
git clone --branch v0.24.0 https://github.com/vllm-project/vllm.git
cd vllm
VLLM_TARGET_DEVICE=empty python -m pip install -v --no-build-isolation --no-deps .
cd ..

# 2. 安装 vllm-plugin-FL v0.3.0
git clone --branch v0.3.0 https://github.com/flagos-ai/vllm-plugin-FL.git
cd vllm-plugin-FL
python -m pip install --no-build-isolation -e .
cd ..

# 3. 安装 FlagGems v5.4.0
git clone --branch v5.4.0 https://github.com/flagos-ai/FlagGems.git
cd FlagGems
python -m pip install --no-build-isolation -e .
cd ..
```

按平台需求安装 [FlagTree 统一编译器](https://github.com/flagos-ai/FlagTree) 和 [FlagCX 统一通信库](https://github.com/flagos-ai/FlagCX)，具体步骤见各项目文档及对应模型卡。OCR 模型适配代码、图像预处理依赖，以及其他平台的版本和分支配置，以对应模型卡为准。

#### 2. MiniCPM-OCR Jev：Torch-FL

**MiniCPM-OCR Jev 通过 Torch-FL 实现多芯片部署**。Torch-FL 为 MiniCPM-OCR Jev 的 PyTorch 和 Transformers 推理流程对接芯片后端，并结合 FlagGems 算子库与对应编译器运行可信度判别。

Torch-FL 官方开发者指南：[GitHub](https://github.com/flagos-ai/Torch-FL) / [GitCode](https://gitcode.com/flagos-ai/Torch-FL)。不同芯片的 SDK、PyTorch 和编译器依赖不同，请先按[安装指南](https://github.com/flagos-ai/Torch-FL/blob/main/docs/getting-started/installation.md)选择目标平台。

以下同样以**平头哥平台**为例，在为 MiniCPM-OCR Jev 准备的独立 Python 环境中执行。安装前请按[平头哥安装指南](https://github.com/flagos-ai/Torch-FL/blob/main/docs/vendors/ppu/installation.md)准备 PPU 驱动、SDK、配套 PyTorch、构建工具及编译器依赖；示例中的 SDK 路径为 `/usr/local/PPU_SDK`，请按实际安装位置调整。

```bash
mkdir -p minicpm-ocr-jev-src
cd minicpm-ocr-jev-src

# 1. 安装 Torch-FL（平头哥平台示例）
git clone -b main https://github.com/flagos-ai/Torch-FL.git
cd Torch-FL
FLAGOS_ACCELERATOR=ppu \
  CUDA_HOME=/usr/local/PPU_SDK/CUDA_SDK \
  FLAGOS_SKIP_CUDA_ASSETS=1 \
  python -m pip install --no-build-isolation -v -e .
cd ..

# 2. 安装 FlagGems 算子库
git clone https://github.com/flagos-ai/FlagGems.git
cd FlagGems
python -m pip install --no-build-isolation -e .
cd ..

# 3. 按平台需要安装 FlagTree 统一编译器
# 详见 https://github.com/flagos-ai/FlagTree

# 4. 配置平头哥平台的 Torch-FL 运行环境
export FLAGOS_DISABLE_CUDA_ASSETS=1
```

其他平台请使用对应安装指南中的构建参数与运行配置。Torch-FL、FlagGems、FlagTree 及所需 FlagCX 的版本组合，以及 Transformers、MiniCPM-OCR Jev 模型代码和图像渲染依赖，以对应模型卡和平台指南为准。

安装完成后，可在同一环境中检查 Torch-FL 设备是否可用：

```python
import torch
import torch_fl

print("FlagOS available:", torch.flagos.is_available())
print("FlagOS device count:", torch.flagos.device_count())
```

当可用状态为 `True` 且设备数量大于 0 时，可继续按下方 MiniCPM-OCR Jev 判别流程运行模型；模型加载、设备选择与输入预处理按 MiniCPM-OCR Jev 模型卡中的配套示例配置。

### 运行文档解析与可信度判别

**1. 使用 MiniCPM-OCR 1.0 解析文档**

加载目标平台的 OCR 模型，按配套示例输入文档图像，获得文字识别与文档解析结果。图像分辨率、页面切分、提示词及输出格式应使用模型卡提供的配置。若后续接入 MiniCPM-OCR Jev，保留页面块原图及其对应的识别文本，确保两者一一对应。

**2. 使用 MiniCPM-OCR Jev 评估识别结果（可选）**

在已配置好 Torch-FL 的环境中加载目标平台的 MiniCPM-OCR Jev 模型，按配套示例准备页面块原图、由 OCR 文本渲染的图像，以及对应识别文本，通过 Torch-FL 运行 MiniCPM-OCR Jev 的 Transformers 判别流程，并通过配套后处理输出经校准的可信度。

**3. 按可信度安排复核**

结合实际业务样本验证并设置复核阈值，将低可信度内容优先送交人工检查。MiniCPM-OCR Jev 也可接在其他 OCR 模型之后使用，接入前应验证输入格式及其在目标文档上的判别效果。
