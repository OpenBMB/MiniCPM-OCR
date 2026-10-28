# 复现 MiniCPM-OCR 性能和效率评测结果

[← 返回 README](../README_zh.md) · [模型指南](./minicpm_ocr_1dot0_zh.md)

本文汇总 MiniCPM-OCR 1.0 的评测推理配置、评分方法与官方来源，以及解析效率对比的测试设置与部署入口。完整评测脚本、精确版本和计时范围待补充。

## 性能复现
### 评测配置

六项评测中使用相同的采样参数：

| 参数 | 值 | 说明 |
| :--- | :--- | :--- |
| `temperature` | `0.01` | 采样温度 |
| `top_p` | `0.001` | 核采样阈值 |
| `top_k` | `1` | 候选 token 数量上限 |
| `repetition_penalty` | `1.0` | 不额外惩罚重复 |
| `no_repeat_ngram_size` | `0` | 关闭 n-gram 禁重复约束 |
| `enable_thinking` | `false` | 关闭思考模式 |

生成长度上限按**识别块类型**设置：

| 识别块类型 | 最大生成长度（tokens） |
| :--- | ---: |
| 普通文本 | 4096 |
| 表格 | 8192 |
| 独立公式 | 2048 |
| 行内公式 | 1024 |

标题等短块另设较低的生成长度上限。

视觉配置与模型上下文上限如下：

| 参数 | 值 |
| :--- | :--- |
| `downsample_mode` | `4x` |
| `max_slice_nums` | `9` |
| `max_model_len` | `40960` |

### 评分方法与官方来源

评分在模型生成预测结果后单独执行：将预测文件与对应版本的真值标注（GT）交给评分器，再汇总各项指标。

### 基准与官方评分入口

| 基准 | 评分方法 | 官方仓库与说明 |
| :--- | :--- | :--- |
| OmniDocBench v1.6 | 将整页 Markdown 与 v1.6 full GT 进行元素匹配，计算文本编辑距离、公式 CDM、表格 TEDS 和阅读顺序编辑距离。本轮使用 `quick_match`。 | [OmniDocBench 仓库与评分指南](https://github.com/opendatalab/OmniDocBench#evaluation) |
| Real5-OmniDocBench | 复用 OmniDocBench v1.5 的标注与评分流程；Scanning、Warping、Screen-Photography、Illumination、Skew 五个场景分别评分，每个场景 1,355 页。本轮总分为五个场景 Overall 的等权平均。 | [Real5 官方数据与评测说明](https://huggingface.co/datasets/PaddlePaddle/Real5-OmniDocBench#evaluation)、[OmniDocBench v1.5 评分仓库](https://github.com/opendatalab/OmniDocBench/tree/v1_5) |
| Wild-OmniDocBench | 对 1,350 页真实采集图像的整页 Markdown 评分，沿用 OmniDocBench 的标注与指标。本轮使用 v1.6 评分器和与 Wild 页面对应的 v1.5 GT 子集。本项目报告的 Wild-OmniDocBench 分数为使用 [SDK（`sdk/`）](../sdk/) 进行旋转校正后的结果。 | [Wild 官方仓库](https://github.com/VirtualLUOUCAS/Wild_OmniDocBench#evaluation)、[OmniDocBench 评分仓库](https://github.com/opendatalab/OmniDocBench) |
| olmOCR-Bench | 使用官方规则检查 Markdown 中的文本出现/缺失、阅读顺序、表格关系和公式等；先计算各类别测试通过率，再对类别分数等权平均。 | [allenai/olmocr 评分说明](https://github.com/allenai/olmocr/blob/main/olmocr/bench/README.md)、[评分代码](https://github.com/allenai/olmocr/blob/main/olmocr/bench/benchmark.py)、[官方数据集](https://huggingface.co/datasets/allenai/olmOCR-bench) |
| OCRBench v2 | 将逐题回答写入预测 JSON 的 `predict` 字段，先用 `eval_scripts/eval.py` 按任务类型评分，再用 `eval_scripts/get_score.py` 汇总中英文各任务指标。 | [MultimodalOCR/OCRBench_v2 官方仓库与命令](https://github.com/Yuliang-Liu/MultimodalOCR/tree/main/OCRBench_v2#evaluation) |
| CHAOS-Bench | 比较模型输出与图像中实际被篡改的词 `ocr_ans`，统计忠实识别的比例；输出原词 `origin_ans` 不计为正确。本轮具体匹配与汇总口径见下文。 | [HunyuanOCR/CHAOS-Bench 官方数据与评测说明](https://github.com/Tencent-Hunyuan/HunyuanOCR/tree/main/benchmarks/CHAOS-Bench) |

### 文档解析指标与评分镜像

OmniDocBench、Real5 和 Wild 的 Overall 按以下公式计算，其中 `FormulaCDM`、`TableTEDS` 使用百分制：

```text
Overall = ((1 - TextEdit) × 100 + FormulaCDM + TableTEDS) / 3
```

`TextEdit` 和阅读顺序编辑距离越低越好；`FormulaCDM`、`TableTEDS`、`TableTEDS-S` 和 Overall 越高越好。阅读顺序与 `TableTEDS-S` 单独报告，不计入上述 Overall。

需要 Docker 评分环境时，可从官方文档提供的入口下载：

```bash
# OmniDocBench 当前官方评分指南推荐的公开镜像
docker pull ghcr.io/zeng-weijun/omnidocbench-eval:repro-ubuntu2204

# Real5 对应的 OmniDocBench v1.5 官方文档所列环境镜像
docker pull sunyuefeng/omnidocbench-env:v1.5
```

完整挂载与运行方式见 [OmniDocBench Docker 评分说明](https://github.com/opendatalab/OmniDocBench#environment-setup-and-running) 和 [v1.5 Docker 说明](https://github.com/opendatalab/OmniDocBench/tree/v1_5#using-docker)。配置文件需指定 `ground_truth.data_path`、`prediction.data_path`、匹配方法和指标；在对应评分环境中运行：

```bash
python pdf_validation.py --config /path/to/eval.yaml
```

GT 的页面版本必须与评测集对应，不能直接用 v1.6 full GT 替换 Real5 的 v1.5 GT。公开镜像标签可能更新，复现历史结果时应固定评分代码 commit、镜像 digest、GT 版本和评分配置。

本轮 OmniDocBench、Real5 和 olmOCR 使用预装评分代码与 GT 的内部封装镜像，Wild 使用固定的评分资产，CHAOS 使用本地评分脚本。上述公开镜像用于搭建评分环境。

### 统计口径

- **评测范围**：归档中的六个轨道为 OmniDocBench v1.6、Real5、olmOCR-Bench、Wild 原图、Wild 摆正和 CHAOS-Bench。
- **Wild**：本项目报告的分数使用 SDK 旋转校正后的结果。归档中的原图与摆正结果分开报告，两者使用相同 GT 和评分器；摆正属于输入处理变化，不能与原图结果混为同一轨道。
- **olmOCR-Bench**：主分数包含 Base 和 Headers & Footers，共八个类别等权平均；如另报 `excl. headers & footers`，则仅对剩余七类等权平均，并明确标注。
- **CHAOS-Bench**：共 500 页、1,025 个篡改词。本轮在整页 Markdown 中归一化空白、忽略大小写，并按词边界搜索 `ocr_ans`；先算每页命中比例，再对 500 页等权平均并乘以 100。空输出页计零分。该本地实现未将输出与标注 `bbox` 逐一对齐，应与区域裁剪识别结果分开报告。

## 解析效率测试
### 设置

| 项目 | 测试条件 |
| :--- | :--- |
| 数据集 | OmniDocBench v1.6 完整数据集，共 1,651 张图像 |
| SDK 与配置 | 使用各系统官方 SDK；均启用加速配置，其他设置采用默认配置 |
| 并发 | 图片级并发度为 1 |
| 硬件 | NVIDIA GeForce RTX 5090，所有系统在相同硬件条件下运行 |
| 指标 | 每秒处理页数（pages/s），数值越高表示吞吐越高 |


图片级并发与单页内文档块的识别并发是不同设置。SDK 中对应 `pipeline.page_workers` 和 `pipeline.max_workers`，详见 [SDK 使用教程](./minicpmvocr_tutorial.md)。上述图片级并发度为 1，不代表页内文档块也串行处理。

### 部署与 DSpark 加速

- [SDK 使用教程](./minicpmvocr_tutorial.md)：安装环境、连接推理后端、解析文档与检查输出。
- [vLLM 部署指南](./vllm_deploy.md)：部署 API 服务与检查识别结果。

DSpark 前后对照需使用相同主模型权重、数据集、硬件和 SDK 配置，仅改变 DSpark 开关。部署指南中的示例用于启动服务；用于复现 62% 提升的完整对照命令和日志待补充。

### 结果说明

启用 DSpark 解码加速后，MiniCPM-OCR 1.0 的端到端处理效率提升 **62%**。该提升描述 DSpark 的加速收益，不能替代与其他系统的吞吐比较。

MiniCPM-OCR 1.0 的解析吞吐为 **1.213 pages/s**，GLM-OCR 为 **1.179 pages/s**。相对吞吐以 MiniCPM-OCR 1.0 为基准（**1.00×**），GLM-OCR、PaddleOCR-VL-1.6、MinerU2.5-Pro-Standard 和 MinerU2.5-Pro-Advanced 分别为 **0.97×、0.67×、0.44× 和 0.28×**。完整数值与对比图见 [模型指南的吞吐章节](./minicpm_ocr_1dot0_zh.md#吞吐)。
