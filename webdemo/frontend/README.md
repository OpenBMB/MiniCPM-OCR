# MiniCPM-OCR 文档解析页

本地文档解析页面。页面把文件发给本机工人，工人地址由 `VITE_OCR_TARGET` 指定，默认 `http://127.0.0.1:8966`。工人的启动方式见 [中文部署指南](../../docs/webdemo_deploy_zh.md)。

打开后进入 `/playground/document-parse`。

## 运行

需要 Node.js 22 或更高版本。pnpm 版本由 `package.json` 锁定为 10.32.1，用 Corepack 安装。

```bash
corepack pnpm install
VITE_OCR_TARGET=http://127.0.0.1:8966 corepack pnpm dev --host --port 5173 --strictPort
```

打开 <http://localhost:5173/playground/document-parse>。

开发服务器把 `/api/document-parse` 和 `/v1` 转到 `VITE_OCR_TARGET`。
