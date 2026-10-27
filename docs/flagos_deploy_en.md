# Multi-Chip Deployment with FlagOS

[← Back to README](../README.md) · [中文](./flagos_deploy_zh.md)

The MiniCPM-OCR family supports deployment across multiple chip platforms through FlagOS, bringing document parsing and OCR confidence assessment to different compute platforms. Developers can deploy MiniCPM-OCR 1.0 on its own for OCR tasks or combine it with MiniCPM-OCR Jev to build a workflow of document parsing → confidence assessment → human review.

## FlagOS Overview

The Beijing Academy of Artificial Intelligence (BAAI), together with research institutions, chip manufacturers, system vendors, and organizations working on algorithms and software, established the FlagOS Open Source Community to support large-scale adoption of diverse AI chips.

FlagOS develops a unified, open-source system software stack for multiple AI chip architectures. Its core projects include an operator library, a unified AI compiler, parallel training and inference frameworks, and a unified communication library, connecting the model, system, and chip layers. Across supported platforms, developers can reuse model integrations and operator optimizations to develop once and migrate across chips, reducing the cost of moving between different chip software stacks.

Community website: [flagos.io](https://flagos.io/) · Developer documentation: [docs.flagos.io](https://docs.flagos.io/en/latest/)

<a id="model-downloads"></a>

## FlagOS Multi-Chip Support and Downloads

FlagRelease is the FlagOS team's platform for automated model migration, adaptation, and release across AI chip architectures. Both models are available in **BF16** for deployment across **12 chip and edge platforms**: T-Head, NVIDIA, Huawei Ascend, Hygon, Kunlunxin, MetaX, Moore Threads, Tsingmicro, Iluvatar, Sunrise, M5, and CIX.

- **MiniCPM-OCR 1.0 (1.3B)**: An OCR-specialized model based on MiniCPM-V 4.6 for text recognition and document parsing, with support for photographed documents and complex tables.
- **MiniCPM-OCR Jev (2B)**: An independent model that assesses OCR results and provides calibrated confidence scores, helping human reviewers prioritize potentially incorrect OCR results.

The table below provides ModelScope and Hugging Face download links for the FlagOS-adapted deployment images of both models across supported chip platforms. See the corresponding model cards for model files, deployment code, and instructions for pulling images and starting containers.

| Chip / Platform | MiniCPM-OCR 1.0                                                                                                                                                                           | MiniCPM-OCR Jev                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-Head          | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-zhenwu-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-zhenwu-FlagOS)         | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-zhenwu-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-zhenwu-FlagOS)         |
| NVIDIA          | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-nvidia-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-nvidia-FlagOS)         | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-nvidia-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-nvidia-FlagOS)         |
| Huawei Ascend   | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-ascend-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-ascend-FlagOS)         | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-ascend-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-ascend-FlagOS)         |
| Hygon           | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-hygon-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-hygon-FlagOS)           | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-hygon-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-hygon-FlagOS)           |
| Kunlunxin       | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-kunlunxin-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-kunlunxin-FlagOS)   | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-kunlunxin-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-kunlunxin-FlagOS)   |
| MetaX           | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-metax-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-metax-FlagOS)           | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-metax-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-metax-FlagOS)           |
| Moore Threads   | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-mthreads-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-mthreads-FlagOS)     | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-mthreads-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-mthreads-FlagOS)     |
| Tsingmicro      | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-tsingmicro-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-tsingmicro-FlagOS) | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-tsingmicro-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-tsingmicro-FlagOS) |
| Iluvatar        | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-iluvatar-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-iluvatar-FlagOS)     | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-iluvatar-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-iluvatar-FlagOS)     |
| Sunrise         | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-sunrise-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-sunrise-FlagOS)       | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-sunrise-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-sunrise-FlagOS)       |
| ARM CPU (edge)  | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-1.0-BF16-arm-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-1.0-BF16-arm-FlagOS)               | [ModelScope](https://modelscope.cn/models/FlagRelease/MiniCPM-OCR-Jev-BF16-arm-FlagOS) / [Hugging Face](https://huggingface.co/FlagRelease/MiniCPM-OCR-Jev-BF16-arm-FlagOS)               |

ARM edge deployments use the `arm` download links listed above, with BF16 versions for both models. Refer to the corresponding model cards for supported devices, runtime requirements, and deployment instructions.

## FlagOS Installation and Usage

### Option 1: Use a FlagRelease Image (Recommended)

1. Select the target chip platform and model from the table above. Choose MiniCPM-OCR 1.0 for document parsing; add MiniCPM-OCR Jev for the same platform if confidence assessment is required.
2. Follow the model card to prepare the host drivers and runtime, pull the corresponding image, and start a container with the required device mappings and mounts for the model and document image directories.
3. Run the OCR or MiniCPM-OCR Jev example provided by the model card in the corresponding environment. Use the platform-specific settings for model paths, devices, batch size, image preprocessing, and startup parameters.

To download the model files first, the following example uses the **T-Head repositories on Hugging Face**, matching the source installation examples below:

```bash
python -m pip install --upgrade huggingface_hub

# Download the OCR document parsing model
hf download FlagRelease/MiniCPM-OCR-1.0-BF16-zhenwu-FlagOS \
  --local-dir ./models/MiniCPM-OCR-1.0

# Optional: download the Jev confidence assessment model
hf download FlagRelease/MiniCPM-OCR-Jev-BF16-zhenwu-FlagOS \
  --local-dir ./models/MiniCPM-OCR-Jev
```

For another platform, replace the repository names with the corresponding entries in the table. Model files are also available through ModelScope. Inside a container, the model path should point to the mounted model directory.

### Option 2: Install from Source

#### 1. MiniCPM-OCR 1.0: vLLM-plugin-FL

The following example sets up **vLLM-plugin-FL** for **MiniCPM-OCR 1.0 on the T-Head platform**, using **vLLM v0.24.0, vllm-plugin-FL v0.3.0, and FlagGems v5.4.0**. Before installation, prepare the chip drivers, runtime, PyTorch, and build dependencies as described in the model card.

Official vLLM-plugin-FL developer guide: [GitHub](https://github.com/flagos-ai/vllm-plugin-FL/blob/main/README.md) / [GitCode](https://gitcode.com/flagos-ai/vllm-plugin-FL/blob/main/README.md).

```bash
# 1. Install vLLM v0.24.0 (T-Head example)
git clone --branch v0.24.0 https://github.com/vllm-project/vllm.git
cd vllm
VLLM_TARGET_DEVICE=empty python -m pip install -v --no-build-isolation --no-deps .
cd ..

# 2. Install vllm-plugin-FL v0.3.0
git clone --branch v0.3.0 https://github.com/flagos-ai/vllm-plugin-FL.git
cd vllm-plugin-FL
python -m pip install --no-build-isolation -e .
cd ..

# 3. Install FlagGems v5.4.0
git clone --branch v5.4.0 https://github.com/flagos-ai/FlagGems.git
cd FlagGems
python -m pip install --no-build-isolation -e .
cd ..
```

Install the [FlagTree unified compiler](https://github.com/flagos-ai/FlagTree) and the [FlagCX unified communication library](https://github.com/flagos-ai/FlagCX) as required by your platform. See their project documentation and the corresponding model card for instructions. Refer to the model card for OCR model integration code, image preprocessing dependencies, and version and branch configurations for other platforms.

#### 2. MiniCPM-OCR Jev: Torch-FL

**MiniCPM-OCR Jev uses Torch-FL for multi-chip deployment.** Torch-FL connects MiniCPM-OCR Jev's PyTorch and Transformers inference workflow to the chip backend, using FlagGems operators and the corresponding compiler to perform confidence assessment.

Official Torch-FL developer guide: [GitHub](https://github.com/flagos-ai/Torch-FL) / [GitCode](https://gitcode.com/flagos-ai/Torch-FL). SDK, PyTorch, and compiler dependencies vary by chip. Start with the [installation guide](https://github.com/flagos-ai/Torch-FL/blob/main/docs/getting-started/installation.md) to select your target platform.

The following example also targets **T-Head**. Run it in a separate Python environment prepared for MiniCPM-OCR Jev. First, follow the [T-Head installation guide](https://github.com/flagos-ai/Torch-FL/blob/main/docs/vendors/ppu/installation.md) to prepare the PPU driver, SDK, compatible PyTorch build, build tools, and compiler dependencies. The example assumes the SDK is installed at `/usr/local/PPU_SDK`; adjust the path to match your installation.

```bash
mkdir -p minicpm-ocr-jev-src
cd minicpm-ocr-jev-src

# 1. Install Torch-FL (T-Head example)
git clone -b main https://github.com/flagos-ai/Torch-FL.git
cd Torch-FL
FLAGOS_ACCELERATOR=ppu \
  CUDA_HOME=/usr/local/PPU_SDK/CUDA_SDK \
  FLAGOS_SKIP_CUDA_ASSETS=1 \
  python -m pip install --no-build-isolation -v -e .
cd ..

# 2. Install the FlagGems operator library
git clone https://github.com/flagos-ai/FlagGems.git
cd FlagGems
python -m pip install --no-build-isolation -e .
cd ..

# 3. Install the FlagTree unified compiler if required by the platform
# See https://github.com/flagos-ai/FlagTree

# 4. Configure the Torch-FL runtime for T-Head
export FLAGOS_DISABLE_CUDA_ASSETS=1
```

For other platforms, use the build flags and runtime configuration from their installation guides. Follow the corresponding model card and platform guide for compatible Torch-FL, FlagGems, FlagTree, and any required FlagCX versions, as well as Transformers, MiniCPM-OCR Jev model code, and image rendering dependencies.

After installation, check whether a Torch-FL device is available in the same environment:

```python
import torch
import torch_fl

print("FlagOS available:", torch.flagos.is_available())
print("FlagOS device count:", torch.flagos.device_count())
```

If availability is `True` and the device count is greater than 0, continue with the MiniCPM-OCR Jev assessment workflow below. Configure model loading, device selection, and input preprocessing using the examples in the MiniCPM-OCR Jev model card.

### Run Document Parsing and Confidence Assessment

**1. Parse documents with MiniCPM-OCR 1.0**

Load the OCR model for the target platform and supply document images using the provided example to obtain recognized text and document parsing results. Follow the model card for image resolution, page segmentation, prompts, and output formats. If MiniCPM-OCR Jev will be used afterward, retain each original page-region image and its corresponding OCR text, keeping them correctly matched.

**2. Assess OCR results with MiniCPM-OCR Jev (optional)**

Load the MiniCPM-OCR Jev model for the target platform in the configured Torch-FL environment. Following its example, prepare the original page-region image, an image rendered from the OCR text, and the corresponding recognized text. Run MiniCPM-OCR Jev's Transformers classification workflow through Torch-FL and apply the provided postprocessing to obtain calibrated confidence scores.

**3. Prioritize human review**

Validate a review threshold on representative documents from your application, then prioritize low-confidence content for human inspection. MiniCPM-OCR Jev can also be used after other OCR models, subject to validation of the input format and assessment quality on the target documents.
