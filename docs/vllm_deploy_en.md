# MiniCPM-OCR 1.0 — vLLM Deployment Guide

[中文](./vllm_deploy.md)

[← Back to README](../README.md)

This guide deploys MiniCPM-OCR 1.0 with **DSpark speculative decoding enabled by default**, following the service setup in the [SDK tutorial](./minicpm_ocr_tutorial_en.md#3-start-the-service). It includes an OpenAI-compatible API service, image recognition, offline inference, and document parsing with the SDK. Run shell commands from the **root of this repository** in Bash.

- Main model: [MiniCPM-OCR-1.0](https://huggingface.co/openbmb/MiniCPM-OCR-1.0)
- DSpark draft model: [MiniCPM-OCR-1.0-DSpark](https://huggingface.co/openbmb/MiniCPM-OCR-1.0-DSpark), required alongside the matching main model.
- vLLM version: `xxx`
- Transformers version: `xxx`
- Python version: `xxx`

## 1. Environment Setup

Create a separate environment for vLLM and install the specified versions:

```bash
conda create -n minicpm-ocr-vllm python=xxx -y
conda activate minicpm-ocr-vllm

pip install 'vllm==xxx' 'transformers==xxx' 'openai==xxx' pillow
```

Check the installed versions:

```bash
python -c "import vllm, transformers; print('vllm', vllm.__version__, '| transformers', transformers.__version__)"
```

The examples below use `openbmb/MiniCPM-OCR-1.0` and `openbmb/MiniCPM-OCR-1.0-DSpark`. For offline deployment, download both complete model repositories and replace these IDs with the matching local main-model and draft-model directories. Keep the tokenizer, processor, configuration, and chat template files.

## 2. API Service Deployment

### 2.1 Start the API Service

Open a new terminal at the repository root and activate the Conda environment created above. The command follows the tutorial's DSpark configuration and adds an example API key for the client examples below:

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

- `openbmb/MiniCPM-OCR-1.0`: Main model; the `model` field in `--speculative-config` points to the matching DSpark draft model.
- `--speculative-config`: Enables DSpark with up to 15 speculative tokens per step and adaptive verification disabled, matching the tutorial. Remove this argument and its entire JSON configuration to use standard decoding without a draft model.
- `--served-model-name`: Model name used in client requests.
- `--max-model-len`: Maximum context length, including input and output tokens.
- `--gpu-memory-utilization`: Fraction of GPU memory available to the service.
- `--max-num-batched-tokens`: Batched token budget.
- `--max-num-seqs`: Maximum number of sequences processed concurrently.
- `--limit-mm-per-prompt`: Allows up to 36 images per request and disables video input and its startup warmup; the SDK converts PDFs into images for recognition.
- `--attention-backend` and `--mm-encoder-attn-backend`: Select Flash Attention for decoding and the multimodal encoder.
- `--default-chat-template-kwargs`: Disables thinking by default.
- `--api-key`: Example access key; replace it with your own key for deployment.

Context length, GPU memory fraction, concurrency, and batched token budget follow the tutorial; adjust them to available memory, accounting for both the main and draft models. The SDK sends `mm_processor_kwargs` in each request, so the service explicitly permits that parameter. The installed vLLM and Transformers versions must support MiniCPM-OCR and DSpark.

After startup, check the model list from another terminal:

```bash
curl -fsS http://127.0.0.1:18499/v1/models \
  -H 'Authorization: Bearer token-abc123'
```

The returned model list should include `minicpm-ocr`.

### 2.2 Image Recognition

Prepare an image containing text as `sample.png`, then send a request with the OpenAI Python client:

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

Place the image before the text in the request. Match `api_key` to the service startup argument and `model` to `--served-model-name`.

### 2.3 Table and Formula Recognition

Replace the prompt in the example according to the image content:

- Text: `Text Recognition:`
- Table: `Table Recognition:`
- Formula: `Formula Recognition:`

Test cropped text, table, and formula regions separately. The raw table output format depends on the model version; the SDK can perform the corresponding postprocessing when parsing documents.

### 2.4 Check Recognition Results

During testing, verify that:

- The response content is nonempty and matches the text in the image.
- Tables and formulas retain the expected structure.
- `finish_reason` is not `length`; if it is, check for truncation and adjust the output budget.

A successful health check only confirms that the service is reachable; it does not replace an image recognition test. After testing, press `Ctrl+C` in the service terminal to stop it.

## 3. Offline Inference

To run without an HTTP service, call the main model with the same DSpark draft configuration in the vLLM environment. Repository IDs download files on the first run; use the local paths described above to run without network access.

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

This example uses the model's own processor and chat template with thinking disabled. Offline inference loads a separate main model and DSpark draft instance, so avoid running it alongside the API service when GPU memory is insufficient.

## 4. Parse Documents with the SDK

The image recognition API handles individual image regions. For PDFs or full-page documents, use the MiniCPM-OCR SDK for layout detection, cropping, and Markdown export.

Follow the [SDK tutorial](./minicpm_ocr_tutorial_en.md#installation) to install the SDK and prepare the layout model, then activate the SDK environment and run the following from the repository root:

```bash
minicpmvocr parse --config sdk/minicpmvocr/configs/minicpmvocr.yaml \
  --backend vllm --server-url http://127.0.0.1:18499 --model minicpm-ocr \
  --set layout.model_dir=/path/to/PP-DocLayoutV3 --set layout.device=cpu \
  --set engine.max_model_len=40960 \
  --set engine.api_key=token-abc123 \
  --input document.pdf --output document.md
```

The command should produce `document.md` with no failed pages or recognition regions in the logs. Inspect text, tables, formulas, and reading order, and check for empty or truncated output. See [Parse documents](./minicpm_ocr_tutorial_en.md#4-parse-documents) for detailed steps.

## Notes

1. **Version compatibility**: Use release-specific vLLM and Transformers versions with MiniCPM-OCR and DSpark support. The `xxx` version placeholders follow the current main-branch environment setup and must be filled in before installation.
2. **Model configuration**: Keep the complete tokenizer, processor, and chat template files. Use the model's own stop tokens and special template parameters.
3. **GPU memory**: Adjust context length, concurrency, and batched token budget to available memory. Example settings are not a guarantee of hardware support.
4. **Endpoint URLs**: The OpenAI Python client uses a URL with `/v1`; the MiniCPM-OCR SDK uses the service root URL without `/v1`.
5. **Network access**: This example listens on localhost only. For cross-host deployment, use a protected network entry point and configure authentication.

## Sampling Parameters

The examples use `temperature=0.01`, `top_p=0.001`, and `top_k=1` to reduce randomness in OCR output. Adjust `max_tokens` to the length of the recognition region. Long tables may need a larger output budget, but the combined input and output length must remain within the context limit.
