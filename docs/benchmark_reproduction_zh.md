# MiniCPM-OCR 1.0 复现文档

[← 返回 README](../README_zh.md) · [English](./benchmark_reproduction_en.md) · [模型指南](./minicpm_ocr_1dot0_zh.md)

本文汇总 MiniCPM-OCR 1.0 解析效率对比的测试设置与部署入口。完整评测脚本、精确版本和计时范围待补充。

## 测试设置

| 项目 | 测试条件 |
| :--- | :--- |
| 数据集 | OmniDocBench v1.6 完整数据集，共 1,651 张图像 |
| SDK 与配置 | 使用各系统官方 SDK；均启用加速配置，其他设置采用默认配置 |
| 并发 | 图片级并发度为 1 |
| 硬件 | NVIDIA GeForce RTX 5090，所有系统在相同硬件条件下运行 |
| 指标 | 每秒处理页数（pages/s），数值越高表示吞吐越高 |

<!-- 数据来源：用户提供的《MiniCPM-OCR 1.0 - 飞书云文档.pdf》第 6–7 页测试条件与第 7 页吞吐图；材料核对日期：2026-10-22。图下注明“All models use accelerated configurations.”。原图 GLM-OCR 未进一步注明加速方法，因此保留原名称。 -->

图片级并发与单页内文档块的识别并发是不同设置。SDK 中对应 `pipeline.page_workers` 和 `pipeline.max_workers`，详见 [SDK 使用教程](./minicpmvocr_tutorial.md)。上述图片级并发度为 1，不代表页内文档块也串行处理。

## 部署与 DSpark 加速

- [SDK 使用教程](./minicpmvocr_tutorial.md)：安装环境、连接推理后端、解析文档与检查输出。
- [vLLM 部署指南](./vllm_deploy.md)：部署 API 服务与检查识别结果。

DSpark 前后对照需使用相同主模型权重、数据集、硬件和 SDK 配置，仅改变 DSpark 开关。部署指南中的示例用于启动服务；用于复现加速收益的完整对照命令和日志待补充。

## 结果说明

DSpark 的加速收益应由同一系统开启和关闭 DSpark 的对照实验衡量。跨系统吞吐比较则反映各系统在上述设置下的解析效率，两者需要分别报告。吞吐数值与对比图统一见 [模型指南的吞吐章节](./minicpm_ocr_1dot0_zh.md#吞吐)。

## 待补充的复现信息

- 各系统的模型权重版本、SDK 版本、完整启动命令与加速参数。
- 计时起止点、预热方式、失败与重试的处理，以及完整运行日志。
- MiniCPM-OCR 1.0 在相同条件下开启和关闭 DSpark 的对照命令与结果。
- 各评测基准的完整脚本、数据版本、指标定义与子集结果。
