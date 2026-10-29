# MiniCPM-OCR webdemo 后端

文档解析页的工人进程。版面检测在本进程里完成，旋转自适应默认打开，识别发给已经在跑的推理服务。部署步骤见 [中文指南](../../docs/webdemo_deploy_zh.md) 和 [English guide](../../docs/webdemo_deploy.md)。页面实际调用的接口见 [`SERVICE.md`](SERVICE.md)。

```
浏览器 → 前端（VITE_OCR_TARGET）
           → 本进程
               ├── 旋转自适应：本进程里的模型
               ├── 版面：本进程里的检测器
               └── 识别：OCR_SERVER_URL 上已经在跑的服务
```

本进程不启动识别服务。识别可以是 vLLM、SGLang、llama.cpp、Ollama，或其它 OpenAI 兼容服务，由 `OCR_ENGINE_TYPE` 和 `OCR_SERVER_URL` 指定。

## 启动

在仓库根目录按部署指南准备环境和模型，然后：

```bash
export OCRWEB_PYTHON=python
export OCR_ENGINE_TYPE=vllm
export OCR_SERVER_URL=http://127.0.0.1:18499
export OCR_SERVED_NAME=minicpm-ocr
export OCR_LAYOUT_MODEL_DIR="$PWD/models/PP-DocLayoutV3_infer"
export OCR_LAYOUT_DEVICE=cuda
export OCR_LAYOUT_WORKERS=1
bash start_local_worker.sh
```

脚本默认监听 `8966`，默认模型名是 `minicpm-ocr`，与前端代理和识别指南一致。`--workers` 固定为 1：任务表在这个进程的内存里。

旋转自适应默认打开，模型目录是仓库里的 `models/paddle_upright`，设备是 `cpu`。`OCR_UPRIGHT_WORKERS=0` 时本进程不加载模型。

路径和解释器都从环境变量传入。`env.sh` 只根据脚本自身的位置找到仓库和 `sdk/`。

## 环境变量

| 变量 | 作用 | 不设时 |
|---|---|---|
| `OCRWEB_PYTHON` | 本进程的解释器 | 启动脚本要求必填 |
| `OCR_SDK_DIR` | `PYTHONPATH` 里的 SDK | 本仓库的 `sdk/` |
| `OCR_LAYOUT_MODEL_DIR` | 版面模型目录 | 启动脚本要求必填 |
| `OCR_LAYOUT_PROVIDER` | 版面实现 | `ppdoclayout3_paddlex`。safetensors 用 `ppdoclayout3_torch` |
| `OCR_LAYOUT_DEVICE` | 版面设备 | `cuda` |
| `OCR_LAYOUT_DEVICES` | 每套检测器的设备 | 按可见 GPU 或 `OCR_LAYOUT_DEVICE` |
| `OCR_LAYOUT_WORKERS` | 版面检测器数量 | `4` |
| `OCR_ENGINE_TYPE` | 识别后端 | `vllm`。还可设 `llamacpp`、`ollama`、`openai` |
| `OCR_SERVER_URL` | 识别服务地址 | 启动脚本要求必填。`VLLM_URL` 是同一项 |
| `OCR_SERVED_NAME` | 识别服务上的模型名 | `minicpm-ocr` |
| `OCR_UPRIGHT_DIR` | 旋转自适应模型的父目录 | `models/paddle_upright` |
| `OCR_UPRIGHT_WORKERS` | 本进程里的模型数量 | `1`。`0` 表示不加载 |
| `OCR_UPRIGHT_DEVICE` | 旋转自适应设备 | `cpu` |
| `OCR_UPRIGHT_REGISTRY` | 摆正服务登记目录 | `backend/data/upright-workers`。空字符串表示不找远程摆正 |
| `PORT` | 本进程端口 | `8966` |
| `VITE_OCR_TARGET` | 前端把解析请求转到这里 | `http://127.0.0.1:8966` |

## 已知限制

- 文档解析接口没有鉴权。对外发布页面，不要把工人端口暴露到公网。
- 任务目录写在 `backend/data/jobs/`，进程不会删除。
- 版面和摆正模型在第一次解析时加载。之后改环境变量要重启本进程。
- 重启后，内存里的任务 id 不再有效。
