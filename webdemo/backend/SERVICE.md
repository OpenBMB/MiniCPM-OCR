# Webdemo 服务说明

部署步骤见 [中文指南](../../docs/webdemo_deploy_zh.md) 和 [English guide](../../docs/webdemo_deploy.md)。本文只说明这个进程怎么接页面。

## 进程

入口是 `server.py`。`start_local_worker.sh` 用一个进程启动它，默认端口 `8966`：

```bash
python -s -m uvicorn server:app --host 0.0.0.0 --port "${PORT:-8966}" --workers 1
```

解释器由 `OCRWEB_PYTHON` 指定。必须加 `-s`，并设置 `PYTHONNOUSERSITE=1`，避免加载用户目录里的另一套包。`backend/env.sh` 把 `PYTHONPATH` 指到本仓库的 `sdk/`。

```
浏览器
  → 前端（VITE_OCR_TARGET，默认 http://127.0.0.1:8966）
    → 本进程
        → 摆正：OCR_UPRIGHT_WORKERS > 0 时用本进程的模型；
          为 0 时使用 OCR_UPRIGHT_REGISTRY 里 90 秒内更新过的摆正服务
        → 版面：本进程的检测器，数量由 OCR_LAYOUT_WORKERS 决定
        → 识别：OCR_SERVER_URL 上已经在跑的服务，类型是 OCR_ENGINE_TYPE，
          模型名是 OCR_SERVED_NAME
```

本进程不加载识别模型，也不启动识别服务。识别服务按对应的部署指南单独运行。

不要把工人端口直接暴露到公网。页面没有登录和 API Key。

## 启动后检查

```bash
curl --noproxy 127.0.0.1 -f http://127.0.0.1:8966/health
```

`{"status":"ok"}` 只说明进程在。版面模型在第一份文档时加载，所以第一次解析更慢。

`/ready` 还会请求 `{OCR_SERVER_URL}/v1/models`，并检查其中是否有 `OCR_SERVED_NAME`。Ollama 列出的名称是 `minicpm-ocr:latest`，这时 `/ready` 可能报告名称不一致，解析仍然使用 `OCR_SERVED_NAME`。

## 页面用的接口

`POST /api/document-parse/jobs`

| 字段 | 含义 |
|---|---|
| `file` | `pdf`、`png`、`jpg`、`jpeg`、`bmp`、`webp`、`tif`、`tiff` |
| `upright` | 默认 `true`。本进程没有摆正模型、登记目录里也没有新的摆正服务时，这一项会被忽略 |
| `page_index` | 可选。只解析 PDF 的这一页，从 0 开始 |

返回 `id`、`status`、`pages_done`、`pages_total` 和 `pages`。

`GET /api/document-parse/jobs/{id}` 轮询进度。做完的页会出现在 `pages` 里。状态为 `Running`、`Success`、`Failed`、`Cancelled`。

`DELETE /api/document-parse/jobs/{id}` 把任务标成 `Cancelled`。已经在跑的那一页会跑完。

任务表只在这个进程的内存里。重启之后，旧的任务地址返回 404。磁盘上的文件还在 `backend/data/jobs/<id>/`：

| 路径 | 内容 |
|---|---|
| `input/` | 上传的原文件 |
| `runtime/intermediate/layouts/` | 版面框 |
| `results_json/` | 这一页的识别结果 |
| `output/` | 拼好的 Markdown |

## 一次解析

一页依次进入摆正、版面和识别。版面检测器一次服务一页，切完归还。切出的图块发给识别服务。印章和图表会送去识别。页面上的展示开关不重新发请求。

改了 `webdemo/backend/` 或 `sdk/minicpmvocr/` 之后，用同一组环境变量重启这一个进程。识别服务可以继续运行。
