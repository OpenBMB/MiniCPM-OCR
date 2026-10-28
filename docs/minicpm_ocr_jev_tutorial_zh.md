# MiniCPM-OCR Jev 本地部署

[English](minicpm_ocr_jev_tutorial_en.md)

MiniCPM-OCR Jev 用于判断一段 OCR 解析结果与原图是否一致：输入一个图像区域与相应的解析结果，输出一个 0–1 之间的一致性分数。可用于从多条**候选择优**、**筛出低质量解析结果**送人工复核、或对**多个 OCR 模型输出排序**。

如需在更多不同 AI 芯片上部署 MiniCPM-OCR Jev，支持平台、模型下载和镜像用法见 [FlagOS 多芯片部署指南](./flagos_deploy_zh.md)。

[硬件要求](#硬件要求) · [Docker 镜像部署](#方式一docker-镜像) · [SDK 本地部署](#方式二sdk-本地部署)

---

## 硬件要求

| 项目 | 要求 |
|---|---|
| GPU | NVIDIA，显存 ≥12GB |
| 驱动 | ≥535 |
| Python | ≥3.10（仅 SDK 方式需要） |
| 磁盘 | 前向环境约 5–9 GB、渲染环境约 1.5 GB、权重约 2.5 GB |

---

## 部署方式

渲染器受安装环境影响，同样的文字内容，不同环境版本以及字体依赖的渲染器会得到不同的渲染图，**渲染环境的一致性影响分数的绝对值**。因此我们提供了Docker镜像和SDK两种本地部署方式。两种方式的默认用法一样：送原图与候选文本，渲染在服务内自动完成。区别在渲染环境：

**Docker 镜像**内置固定版本的 Chromium、CJK 字体与渲染依赖，渲染结果与云端 API 完全一致，分数可以直接与发布数字对照。

**SDK 本地部署**把渲染器与模型服务解耦，模型服务支持多种推理后端，适配不同环境。SDK模式下，渲染器安装受具体环境影响，与镜像的渲染环境会有细微差异，分数的排序保持稳定，但绝对值可能略有偏差。如果你手边已经有渲染图，也可以跳过渲染环节，直接走模型服务，依赖最轻。


### 方式一：Docker 镜像

构建：

```bash
cd scripts/minicpm-ocr-jev
docker build -f serve/Dockerfile -t minicpm-ocr-jev-1-0:latest .
```

慢网下加上 `--build-arg PIP_INDEX_URL=https://<mirror>/simple` 和 `--build-arg PLAYWRIGHT_DOWNLOAD_HOST=https://<mirror>`。

运行（挂载权重、映射端口）：

```bash
docker run -d --name minicpm-ocr-jev --gpus '"device=0"' \
    -p 127.0.0.1:8030:8030 \
    -v /path/to/checkpoint:/weights:ro \
    minicpm-ocr-jev-1-0:latest 8030 /weights
```

健康检查：

```bash
curl -f http://127.0.0.1:8030/healthz
```

服务就绪后即可打分。以单次评分为例：

```bash
curl -s http://127.0.0.1:8030/v1/rm/score -H 'Content-Type: application/json' -d '{
  "input_form": "ternary",
  "items": [
    {"case_id": "blk-001", "image": "data:image/png;base64,<base64>",
     "ocr_text": "待评分的 OCR 文本", "category": "text"}
  ]
}'
```

```json
{
  "results": [
    {"case_id": "blk-001", "category": "text", "verdict": "scored",
     "prob_yes": 0.99509, "prob_no": 0.00491, "detail": ""}
  ],
  "summary": {"total": 1, "scored": 1, "pass_rate": 1.0, "throughput_rate": 1.0, …}
}
```

`image` 传 `data:image/png;base64,` 或 `data:image/jpeg;base64,` 前缀加 base64 正文。`category` 必须与块真实类型一致（`text` / `formula` / `table`），填错不报错但分数会偏。**用分数前必须先看** `verdict`——`0.0` 与 `-1.0` 是打分失败时的固定返回值，不是低分。

更多端点（`/v1/rm/score_best`、`/v1/rm/score_best_batch`）与完整字段定义见 [Docker 镜像 API 参考](./minicpm_ocr_jev_docker_api_zh.md)。


### 方式二：SDK 本地部署

不需要 Docker，渲染器与模型服务分开安装在主机上。按**渲染图由谁提供**分两种部署形态：

- **不带渲染器部署**：已经有渲染好的图，只要分数。输入原图 + 渲染图 + 文本，输出分数。主机上不需要 Chromium、Node 和字体。
- **内置渲染器部署**：只有候选文本，渲染交给服务。输入原图 + 文本，输出分数。要装完整渲染环境，换来的是与 Docker 镜像完全一致的端点和字段名，以及块内选优这类接口。

两种形态用的是同一个模型、同一套打分代码，区别只在于渲染图来源。

#### 推理打分

支持多种推理引擎进行打分：[vLLM](./vllm_deploy_jev_zh.md)，[SGLang](./sglang_deploy_jev_zh.md)，[llama.cpp](./llamacpp_deploy_jev_zh.md)，[Ollama](./ollama_deploy_jev_zh.md)

#### 环境要求

SDK 要两个独立安装的虚拟环境：

| 环境   | 跑什么             | 版本要求                                               |
| ---- | --------------- | -------------------------------------------------- |
| 引擎环境 | 前向推理            | 随后端而定，见上述对应文档                                      |
| 服务环境 | 打分服务；用内置渲染器时含渲染 | Python ≥3.10；`Pillow==12.3.0`、`playwright==1.62.0` |

---

## 工作方式

对一条候选文本打分分三个阶段：

```
    precheck  ---->    render    ---->   forward
（LaTeX 语法校验）    （渲染成图片）      （vLLM 前向打分）
```

**precheck** 先检查候选文本的合法性（公式类块会校验 LaTeX 语法），语法错误时会直接判定错误。**render** 把候选文本渲染成图片，让模型能直接"看到"它的排版效果，而不只是读字符。**forward** 把原图、渲染图、候选文本一起送进模型，输出分数。

---

## 常见问题

| 问题 | 处理方式 |
|---|---|
| `category` 填错 | 公式块送成 `text` 会按字面 LaTeX 渲染，分数失真且不报错；必须与块真实类型一致 |
| 分数返回 `0.0` 或 `-1.0` | 那不是概率，是打分失败时的固定返回值；读同一项的 `verdict` 看原因 |
| 服务起不来、提示 prompt 不匹配 | 引擎拼出的 prompt 与训练时不一致；按 [vllm_deploy_jev_zh.md](./vllm_deploy_jev_zh.md) 的"启动自检"查 |
| 渲染图漂移 | 自装渲染器与镜像渲染器画出的像素略有差异；排序不变，小数点后第三位不作承诺 |
