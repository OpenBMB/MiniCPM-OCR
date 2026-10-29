# MiniCPM-OCR 1.0 — vLLM 部署指南

[English](./vllm_deploy_en.md)

[← 返回首页](../README_zh.md)

本文参照 [SDK 使用教程](./minicpmvocr_tutorial.md#3-启动服务)中的服务部署方式，使用 vLLM 部署 MiniCPM-OCR 1.0，**默认启用 DSpark 推测解码**，包括 OpenAI 兼容 API 服务、图片识别、离线推理，以及 SDK 文档解析。以下 Shell 命令均在**本仓库根目录**通过 Bash 执行。

- 主模型：[MiniCPM-OCR-1.0](https://huggingface.co/openbmb/MiniCPM-OCR-1.0)
- DSpark 草稿模型：[MiniCPM-OCR-1.0-DSpark](https://huggingface.co/openbmb/MiniCPM-OCR-1.0-DSpark)，需要与配套主模型一起使用。
- vLLM 版本：`xxx`
- Transformers 版本：`xxx`
- Python 版本：`xxx`

## 1. 环境准备

为 vLLM 创建独立环境，安装指定版本：

```bash
conda create -n minicpm-ocr-vllm python=xxx -y
conda activate minicpm-ocr-vllm

pip install 'vllm==xxx' 'transformers==xxx' 'openai==xxx' pillow
```

检查安装版本：

```bash
python -c "import vllm, transformers; print('vllm', vllm.__version__, '| transformers', transformers.__version__)"
```

后续示例使用 `openbmb/MiniCPM-OCR-1.0` 和 `openbmb/MiniCPM-OCR-1.0-DSpark`。如需离线部署，请提前下载两个完整模型仓库，将这两个 ID 分别替换为匹配的本地主模型和草稿模型目录，并保留 tokenizer、processor、配置和聊天模板文件。

## 2. API 服务部署

### 2.1 启动 API 服务

在仓库根目录新开一个终端，激活上文创建的 Conda 环境。以下命令沿用教程的 DSpark 配置，并为后续客户端示例添加示例 API 密钥：

```bash
conda activate minicpm-ocr-vllm

vllm serve openbmb/MiniCPM-OCR-1.0 \
  --served-model-name minicpm-ocr \
  --host 127.0.0.1 \
  --port 18499 \
  --max-model-len 40960 \
  --max-num-batched-tokens 40960 \
  --max-num-seqs 32 \
  --limit-mm-per-prompt '{"image":36,"video":0}' \
  --attention-backend FLASH_ATTN \
  --mm-encoder-attn-backend FLASH_ATTN \
  --mm-processor-kwargs '{"downsample_mode":"4x"}' \
  --gpu-memory-utilization 0.85 \
  --trust-request-mm-kwargs \
  --speculative-config '{
    "method": "dspark",
    "model": "openbmb/MiniCPM-OCR-1.0-DSpark",
    "num_speculative_tokens": 15,
    "enable_adaptive_verification": false
  }' \
  --default-chat-template-kwargs '{"enable_thinking":false}' \
  --api-key token-abc123
```

- `openbmb/MiniCPM-OCR-1.0`：主模型；`--speculative-config` 中的 `model` 指向配套 DSpark 草稿模型。
- `--speculative-config`：启用 DSpark，每步最多生成 15 个草稿 token，并关闭自适应验证，与教程保持一致。删除该参数及其完整 JSON 配置即可使用普通解码，此时无需草稿模型。
- `--served-model-name`：客户端请求使用的模型名称。
- `--max-model-len`：最大上下文长度，包含输入与输出 token。
- `--gpu-memory-utilization`：服务可使用的 GPU 显存比例。
- `--max-num-batched-tokens`：批处理 token 预算。
- `--max-num-seqs`：同时处理的最大序列数。
- `--limit-mm-per-prompt`：每次请求最多允许 36 张图片，并关闭视频输入及其启动预热；PDF 由 SDK 转成图片后识别。
- `--attention-backend` 和 `--mm-encoder-attn-backend`：为解码和多模态编码器选择 Flash Attention。
- `--default-chat-template-kwargs`：默认关闭思考。
- `--api-key`：示例访问密钥，实际部署时替换为自己的密钥。

上下文长度、显存比例、并发和批处理预算与教程一致，需根据可用显存调整，同时考虑主模型和草稿模型的占用。SDK 会逐请求发送 `mm_processor_kwargs`，因此服务显式允许该参数。安装的 vLLM 和 Transformers 版本需支持 MiniCPM-OCR 与 DSpark。

服务启动后，在另一终端检查模型列表：

```bash
curl -fsS http://127.0.0.1:18499/v1/models \
  -H 'Authorization: Bearer token-abc123'
```

预期返回的模型列表包含 `minicpm-ocr`。

### 2.2 图片识别

准备含有文字的图片 `sample.png`，使用 OpenAI Python 客户端发送请求：

```python
import base64
from pathlib import Path

from openai import OpenAI

client = OpenAI(
    api_key="token-abc123",
    base_url="http://127.0.0.1:18499/v1",
)

image_base64 = base64.b64encode(Path("sample.png").read_bytes()).decode("utf-8")

response = client.chat.completions.create(
    model="minicpm-ocr",
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image_base64}"},
                },
                {"type": "text", "text": "Text Recognition:"},
            ],
        }
    ],
    temperature=0.01,
    top_p=0.001,
    max_tokens=2048,
    extra_body={
        "top_k": 1,
        "repetition_penalty": 1.0,
        "no_repeat_ngram_size": 100,
        "chat_template_kwargs": {"enable_thinking": False},
        "mm_processor_kwargs": {"downsample_mode": "4x"},
    },
)

print(response.choices[0].message.content)
print("finish_reason:", response.choices[0].finish_reason)
```

请求中将图片放在文字前面。`api_key` 与服务启动参数保持一致，`model` 与 `--served-model-name` 保持一致。

### 2.3 表格与公式识别

按图片内容替换上面示例的提示词：

- 文字：`Text Recognition:`
- 表格：`Table Recognition:`
- 公式：`Formula Recognition:`

建议分别使用裁切后的文字块、表格块和公式块进行测试。表格原始返回格式取决于模型版本；通过 SDK 解析时，可由 SDK 完成相应后处理。

### 2.4 检查识别结果

测试时确认：

- 返回正文非空，且与图片中的文字一致。
- 表格和公式保留预期结构。
- `finish_reason` 不为 `length`；如为 `length`，检查是否截断并调整输出预算。

健康检查成功只说明服务可访问，不能代替图片识别测试。完成测试后，在服务终端按 `Ctrl+C` 停止服务。

## 3. 离线推理

不启动 HTTP 服务时，可在 vLLM 环境中直接调用主模型，并使用相同的 DSpark 草稿配置。使用仓库 ID 时，首次运行会下载文件；如需断网运行，请使用上文说明的本地路径。

```python
from PIL import Image
from transformers import AutoProcessor
from vllm import LLM, SamplingParams

model_path = "openbmb/MiniCPM-OCR-1.0"
draft_model_path = "openbmb/MiniCPM-OCR-1.0-DSpark"
image = Image.open("sample.png").convert("RGB")
processor = AutoProcessor.from_pretrained(model_path)

llm = LLM(
    model=model_path,
    max_model_len=40960,
    max_num_batched_tokens=40960,
    max_num_seqs=32,
    gpu_memory_utilization=0.85,
    limit_mm_per_prompt={"image": 36, "video": 0},
    attention_backend="FLASH_ATTN",
    mm_encoder_attn_backend="FLASH_ATTN",
    mm_processor_kwargs={"downsample_mode": "4x"},
    speculative_config={
        "method": "dspark",
        "model": draft_model_path,
        "num_speculative_tokens": 15,
        "enable_adaptive_verification": False,
    },
)

messages = [
    {
        "role": "user",
        "content": [
            {"type": "image"},
            {"type": "text", "text": "Text Recognition:"},
        ],
    }
]
prompt = processor.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=True,
    enable_thinking=False,
)

outputs = llm.generate(
    {"prompt": prompt, "multi_modal_data": {"image": image}},
    sampling_params=SamplingParams(
        temperature=0.01,
        top_p=0.001,
        top_k=1,
        max_tokens=2048,
    ),
)

print(outputs[0].outputs[0].text)
print("finish_reason:", outputs[0].outputs[0].finish_reason)
```

该示例使用模型自身的处理器和聊天模板，并关闭思考。离线推理会单独加载一组主模型和 DSpark 草稿模型，不要在显存不足时与 API 服务同时运行。

## 4. 使用 SDK 解析文档

API 图片识别适合单个图像块；PDF 或整页文档可使用 MiniCPM-OCR SDK 完成版面检测、裁切与 Markdown 导出。

先按[SDK 使用教程](./minicpmvocr_tutorial.md#安装)安装 SDK、准备版面模型，然后切换到 SDK 环境，在项目仓库根目录执行：

```bash
minicpmvocr parse --config sdk/minicpmvocr/configs/minicpmvocr.yaml \
  --backend vllm --server-url http://127.0.0.1:18499 --model minicpm-ocr \
  --set layout.model_dir=/path/to/PP-DocLayoutV3 --set layout.device=cpu \
  --set engine.max_model_len=40960 \
  --set engine.api_key=token-abc123 \
  --input document.pdf --output document.md
```

预期生成 `document.md`，日志中无失败页面或识别块。检查文字、表格、公式和阅读顺序，确认没有空输出或截断。详细步骤见教程的[解析文档](./minicpmvocr_tutorial.md#4-解析文档)章节。

## 注意事项

1. **版本匹配**：使用支持 MiniCPM-OCR 与 DSpark 的配套 vLLM 和 Transformers 版本。`xxx` 版本占位符沿用当前主分支的环境准备说明，安装前需要填入具体版本。
2. **模型配置**：保留完整 tokenizer、processor 和聊天模板文件；停止 token 与特殊模板参数使用模型自身配置。
3. **显存调整**：优先根据显存调整上下文、并发和批处理预算，不将示例设置视为硬件支持承诺。
4. **接口地址**：OpenAI Python 客户端使用带 `/v1` 的地址，MiniCPM-OCR SDK 配置使用不带 `/v1` 的服务根地址。
5. **网络访问**：本例仅监听本机。跨主机部署时，通过受保护的网络入口访问，并配置鉴权。

## 采样参数

示例使用 `temperature=0.01`、`top_p=0.001`、`top_k=1`，减少 OCR 输出随机性。`max_tokens` 根据识别块长度调整；长表格可能需要更大的输出预算，但输入与输出总长度不能超过上下文上限。
