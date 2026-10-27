# MiniCPM-OCR 1.0 — vLLM 部署指南

[English](./vllm_deploy_en.md)

本文介绍如何使用 vLLM 部署 MiniCPM-OCR 1.0，包括 OpenAI 兼容 API 服务、图片识别、离线推理，以及 SDK 文档解析。

- 主模型：[MiniCPM-OCR-1.0](https://huggingface.co/openbmb/MiniCPM-OCR-1.0)
- DSpark 草稿模型：[MiniCPM-OCR-1.0-DSpark](https://huggingface.co/openbmb/MiniCPM-OCR-1.0-DSpark)，加速部署见 [SDK 使用教程](./minicpmvocr_tutorial.md#3-启动服务)
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

从 [openbmb/MiniCPM-OCR-1.0](https://huggingface.co/openbmb/MiniCPM-OCR-1.0) 将完整主模型下载到本地目录 `/path/to/MiniCPM-OCR`。后续示例统一使用该路径。

## 2. API 服务部署

### 2.1 启动 API 服务

```bash
vllm serve /path/to/MiniCPM-OCR \
  --served-model-name minicpm-ocr \
  --host 127.0.0.1 \
  --port 18499 \
  --dtype auto \
  --max-model-len 16384 \
  --gpu-memory-utilization 0.8 \
  --max-num-batched-tokens 8192 \
  --limit-mm-per-prompt '{"image":1,"video":0}' \
  --trust-request-mm-kwargs \
  --mm-processor-kwargs '{"downsample_mode":"4x","max_slice_nums":9}' \
  --api-key token-abc123
```

- `/path/to/MiniCPM-OCR`：本地主模型目录，也可替换为模型仓库 ID `openbmb/MiniCPM-OCR-1.0`。
- `--served-model-name`：客户端请求使用的模型名称。
- `--max-model-len`：最大上下文长度，包含输入与输出 token。
- `--gpu-memory-utilization`：服务可使用的 GPU 显存比例。
- `--max-num-batched-tokens`：批处理 token 预算。
- `--limit-mm-per-prompt`：本例每次请求允许一张图片，并关闭视频输入及其启动预热；PDF 由 SDK 转成图片后识别。
- `--api-key`：示例访问密钥，实际部署时替换为自己的密钥。

上下文长度、显存比例和批处理预算为示例值，需根据模型配置及设备调整。SDK 会逐请求发送 `mm_processor_kwargs`，因此这里显式允许该参数。固定 vLLM 版本必须支持 `downsample_mode`、`max_slice_nums` 及 SDK 的采样字段；若不支持，不能仅凭服务能启动就认定可接入 SDK。`--trust-remote-code` 及相关补丁以最终模型适配要求为准。

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
        "mm_processor_kwargs": {"downsample_mode": "4x", "max_slice_nums": 9},
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

不启动 HTTP 服务时，可在 vLLM 环境中直接调用模型：

```python
from PIL import Image
from transformers import AutoProcessor
from vllm import LLM, SamplingParams

model_path = "/path/to/MiniCPM-OCR"
image = Image.open("sample.png").convert("RGB")
processor = AutoProcessor.from_pretrained(model_path)

llm = LLM(
    model=model_path,
    max_model_len=16384,
    gpu_memory_utilization=0.8,
    limit_mm_per_prompt={"image": 1, "video": 0},
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

该示例以模型提供兼容的 `AutoProcessor` 和聊天模板为前提；自定义处理器加载方式、thinking 开关与停止 token 应随正式模型版本补齐，不能直接套用其他 MiniCPM-V 版本的设置。离线推理会单独加载模型，不要在显存不足时与 API 服务同时运行。

## 4. 使用 SDK 解析文档

API 图片识别适合单个图像块；PDF 或整页文档可使用 MiniCPM-OCR SDK 完成版面检测、裁切与 Markdown 导出。

先按[SDK 使用教程](./minicpmvocr_tutorial.md#安装)安装 SDK、准备版面模型，然后切换到 SDK 环境，在项目仓库根目录执行：

```bash
minicpmvocr parse --config sdk/minicpmvocr/configs/minicpmvocr.yaml \
  --backend vllm --server-url http://127.0.0.1:18499 --model minicpm-ocr \
  --set layout.model_dir=/path/to/PP-DocLayoutV3 --set layout.device=cpu \
  --set engine.max_model_len=16384 \
  --set engine.api_key=token-abc123 \
  --input document.pdf --output document.md
```

预期生成 `document.md`，日志中无失败页面或识别块。检查文字、表格、公式和阅读顺序，确认没有空输出或截断。详细步骤见教程的[解析文档](./minicpmvocr_tutorial.md#4-解析文档)章节。

## 注意事项

1. **版本匹配**：使用发布指定的 vLLM 与 Transformers 版本，不使用浮动版本替代。
2. **模型配置**：保留完整 tokenizer、processor 和聊天模板文件；停止 token 与特殊模板参数使用模型自身配置。
3. **显存调整**：优先根据显存调整上下文、并发和批处理预算，不将示例设置视为硬件支持承诺。
4. **接口地址**：OpenAI Python 客户端使用带 `/v1` 的地址，MiniCPM-OCR SDK 配置使用不带 `/v1` 的服务根地址。
5. **网络访问**：本例仅监听本机。跨主机部署时，通过受保护的网络入口访问，并配置鉴权。

## 采样参数

示例使用 `temperature=0.01`、`top_p=0.001`、`top_k=1`，减少 OCR 输出随机性。`max_tokens` 根据识别块长度调整；长表格可能需要更大的输出预算，但输入与输出总长度不能超过上下文上限。
