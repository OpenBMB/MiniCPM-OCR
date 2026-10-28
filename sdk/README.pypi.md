<!-- Generated from the repository README.md; do not edit manually. -->

<div align="center">

<img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/release-hero.svg" alt="MiniCPM-OCR: fast, accurate document parsing into text, tables, and formulas, with a lightning arrow connecting documents to structured results; a decision model helps identify regions that need review (illustration)." width="100%">

<p align="center"><strong>MiniCPM-OCR · Fast, accurate parsing for real-world documents.</strong></p>

<p align="center">
  <a href="https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/minicpm_ocr_1dot0_en.md"><strong>MiniCPM-OCR 1.0 Guide</strong></a>&ensp;<a href="https://huggingface.co/openbmb/MiniCPM-OCR-1.0" title="Hugging Face"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/huggingface_logo-noborder.svg" width="19" height="18" alt="Hugging Face"></a>&ensp;<a href="https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0" title="ModelScope"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/modelscope_logo_padded.svg" width="25" height="14" alt="ModelScope"></a>
  &emsp;
  <a href="https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/minicpm_ocr_jev_en.md"><strong>MiniCPM-OCR Jev Guide</strong></a>&ensp;<a href="https://huggingface.co/openbmb/MiniCPM-OCR-1.0-Jev" title="Hugging Face"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/huggingface_logo-noborder.svg" width="19" height="18" alt="Hugging Face"></a>&ensp;<a href="https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-Jev" title="ModelScope"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/modelscope_logo_padded.svg" width="25" height="14" alt="ModelScope"></a>
</p>

<p align="center">
  <a href="https://github.com/OpenBMB/MiniCPM-OCR/blob/main/README.md#quick-start">Get Started</a> &nbsp;·&nbsp;
  <a href="https://github.com/OpenBMB/MiniCPM-OCR/blob/main/README.md#model-weights">Model Weights</a> &nbsp;·&nbsp;
  <a href="https://github.com/OpenBMB/MiniCPM-OCR/blob/main/README.md#api">Free API</a> &nbsp;·&nbsp;
  <a href="https://github.com/OpenBMB/MiniCPM-OCR/blob/main/README.md#skill">Skill</a> &nbsp;·&nbsp;
  Online Demo (<a href="https://platform.modelbest.cn/console/playground/document-parse">CN</a> / <a href="https://platform.modelbest.ai/console/playground/document-parse">Global</a>)
  &nbsp;|&nbsp; English &nbsp;·&nbsp; <a href="https://github.com/OpenBMB/MiniCPM-OCR/blob/main/README_zh.md">中文</a>
</p>

</div>

<a id="overview"></a>

**MiniCPM-OCR** is a family of models for efficient document parsing and text recognition. **MiniCPM-OCR 1.0** parses Chinese and English documents and PDFs, balancing quality and efficiency across challenging inputs such as scans, photographs, curved pages, and recaptured documents. **MiniCPM-OCR Jev** evaluates OCR results at the region level, distinguishing problematic regions from reliable ones. It works with different parsing models to help users locate content that needs review.

## MiniCPM-OCR 1.0

**MiniCPM-OCR 1.0** (1.3B) is the first OCR-specific model in the [MiniCPM-V/o](https://github.com/openbmb/MiniCPM-V) family. It focuses on text-centric document understanding, covering text, tables, formulas, charts, seals, and structured information extraction. Its key features include:

- 🏆 **SOTA document parsing**: MiniCPM-OCR 1.0 achieves a **SOTA score of 93.68 on Real5-OmniDocBench**, a benchmark for real-world document parsing, and demonstrates leading parsing capabilities on OmniDocBench v1.6, Wild-OmniDocBench, and olmOCR-Bench. It supports Chinese and English documents and PDFs, handling both standard documents and challenging capture conditions, including scans, curved pages, photographs, skewed pages, and recaptured documents.
- ⚡ **Efficient inference.** With DSpark decoding acceleration ([**DSpark-BF16**](https://huggingface.co/openbmb/MiniCPM-OCR-1.0-DSpark), [**DSpark-GGUF**](https://huggingface.co/openbmb/MiniCPM-OCR-1.0-DSpark-gguf)), MiniCPM-OCR 1.0 improves **end-to-end processing efficiency by 55%**. Its throughput is approximately **1.49×** that of PaddleOCR-VL-1.6 and **3.62×** that of MinerU2.5 Pro, reducing the time needed for large-scale document parsing.
- 🔍 **General recognition and information extraction**: MiniCPM-OCR 1.0 achieves a **SOTA score of 54.7 on OCRBench v2**, demonstrating strong general OCR capabilities. It **also supports key information extraction (KIE)**, extracting relevant document content for downstream information management and automated processing.
- 🛠️ **Easy deployment and development**: MiniCPM-OCR 1.0 supports **vLLM, SGLang, llama.cpp, and Ollama from day one**, with multiple chip platforms and quantized versions available at release. It **supports further fine-tuning** and provides a **[pip SDK](https://pypi.org/project/minicpm-ocr/)** and a **[full-featured API](https://github.com/OpenBMB/MiniCPM-OCR/blob/main/README.md#api)** for application integration and customization. You can also **[get started quickly with SKILL.md](https://github.com/OpenBMB/MiniCPM-OCR/blob/main/README.md#skill)**. Try the Online Demo ([CN](https://platform.modelbest.cn/console/playground/document-parse) / [Global](https://platform.modelbest.ai/console/playground/document-parse)) to explore parsing results.

### SOTA Performance, Higher Throughput

Among the open-source OCR models shown below, MiniCPM-OCR 1.0 achieves 1.2 pages/s and the highest overall performance on OmniDocBench v1.6, Real5-OmniDocBench, Wild-OmniDocBench, and olmOCR-Bench.

<p align="center"><a href="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/efficiency-performance-en.png"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/efficiency-performance-en.png" alt="Throughput and parsing quality of open-source OCR models. The horizontal axis shows throughput in pages per second on a logarithmic scale; the vertical axis shows the equally weighted average score across four document parsing benchmarks." width="90%"></a></p>

<sub>See the [reproduction guide](https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/benchmark_reproduction_en.md) for test settings and reproduction details, and the [model guide throughput evaluation](https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/minicpm_ocr_1dot0_en.md#throughput) for each model's throughput.</sub>

<a id="ocr-benchmark"></a>

### Benchmark Comparisons

<p align="center"><a href="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/benchmark-radar.png"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/benchmark-radar.png" alt="Radar chart comparing MiniCPM-OCR 1.0 with other OCR models across six benchmarks; some values remain to be confirmed." width="80%"></a></p>

<details>
<summary>View complete MiniCPM-OCR 1.0 evaluation results</summary>

<p align="center"><a href="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/ocr-benchmarks.png"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/ocr-benchmarks.png" alt="Detailed OCR model results on OmniDocBench v1.6, Real5, Wild, olmOCR-Bench, CHAOS-Bench, and OCRBench v2." width="100%"></a></p>

</details>

See the [MiniCPM-OCR 1.0 guide](https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/minicpm_ocr_1dot0_en.md#evaluation) for per-benchmark bar charts and throughput details.

### Examples

Left to right: original document, detected layout, and rendered Markdown.

#### English Documents

<p align="center"><a href="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/minicpm-english-examples-3-column.gif"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/minicpm-english-examples-3-column.gif" alt="English document animation: original, detected layout, and rendered Markdown." width="100%"></a></p>

<details>
<summary>More English Examples</summary>

Original documents and parsed results, side by side.

<p align="center"><a href="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/minicpm-ocr-english-cases.png"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/minicpm-ocr-english-cases.png" alt="English examples comparing inputs and results: handwriting, historical and scanned documents, newspapers, financial statements, and key information extraction." width="100%"></a></p>

</details>

#### Chinese Documents

<p align="center"><a href="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/minicpm-chinese-examples-3-column.gif"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/minicpm-chinese-examples-3-column.gif" alt="Chinese document animation: original, detected layout, and rendered Markdown." width="100%"></a></p>

<details>
<summary>More Chinese Examples</summary>

Original documents and parsed results, side by side.

<p align="center"><a href="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/minicpm-ocr-chinese-cases.png"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/minicpm-ocr-chinese-cases.png" alt="Chinese examples comparing inputs and results: handwritten notes, complex formulas, newspapers, financial statements, stamped documents, illustrations, and key information extraction." width="100%"></a></p>

</details>

## MiniCPM-OCR Jev

**MiniCPM-OCR Jev** is an **OCR correctness decision model** for text, formulas, and tables. Given an image and its corresponding OCR result, it returns a **quality score from 0 to 1** to help select reliable results and locate content that needs review.

- 🛡️ **Strong performance in a small model**: With only 2B parameters, MiniCPM-OCR Jev achieves an AUROC (×100) of 93.6 on [JevOCRBench](https://huggingface.co/datasets/openbmb/JevOCRBench), **outperforming JEV-35B-A3B (90.1)** and approaching Qwen3.5-397B-A17B (93.8).
- 🧩 **Consistent generalization**: Across parsing results from MiniCPM-OCR 1.0, GLM-OCR, PaddleOCR-VL-1.6, and Xiaomi-OCR-0, its AUROC (×100) ranges from **91.9 to 93.4**.

<a id="jev-benchmark"></a>

<a id="评测表现"></a>

### Evaluation Results

The table below reports overall and per-category AUROC (×100) on JevOCRBench. Higher values indicate better discrimination between correct and incorrect parsing results.

<p align="center"><a href="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/jev-benchmark-score-table.png"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/jev-benchmark-score-table.png" alt="Overall, text, formula, and table AUROC results on JevOCRBench, highlighting MiniCPM-OCR Jev." width="100%"></a></p>

<a id="判别力跨ocr模型泛化"></a>
<a id="使用场景"></a>
<a id="用法一块级直通省掉大部分人工核验"></a>
<a id="用法二多专家聚合扩展-ocr-的能力边界"></a>

### Review-Free Accuracy

Accuracy at different review-free rates across three document types.

<p align="center"><a href="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/review-free-en.png"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/review-free-en.png" alt="Accuracy versus review-free rate for legal documents, financial receipts, and complex documents." width="100%"></a></p>

### Decision Examples

Jev scores for text, formula, and table recognition.

<p align="center"><a href="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/jev-case-en.png"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/jev-case-en.png" alt="Original images, two OCR candidates, and their Jev scores for text, formulas, and tables." width="100%"></a></p>

See the [MiniCPM-OCR Jev model guide](https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/minicpm_ocr_jev_en.md) for more on usage, technical specifications, evaluation results, and efficiency results.

<a id="quick-start"></a>

## Using MiniCPM-OCR

Choose how to integrate MiniCPM-OCR 1.0 and MiniCPM-OCR Jev:

<a id="使用-agent-skill-部署推荐"></a>

### Skill

Ask a coding agent to follow the MiniCPM-OCR 1.0 [skill](https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/SKILL_en.md) to set up the environment, download models, and parse your first document. Send the following instruction to the agent:

```text
Read and execute https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/SKILL_en.md
```

If you have already cloned this repository, you can use `./docs/SKILL_en.md` directly.

<a id="api"></a>

### Free API

Use the Free API to access MiniCPM-OCR 1.0 recognition and MiniCPM-OCR Jev quality scoring.

[MiniCPM-OCR 1.0 API example](https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/minicpm_ocr_api_en.md) &emsp;·&emsp; [MiniCPM-OCR Jev API example](https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/minicpm_ocr_jev_api_en.md) (coming soon)

<a id="手动部署"></a>

<a id="本地部署"></a>

### Local Deployment

Run the models on your own hardware: MiniCPM-OCR 1.0 parses PDFs and images into Markdown or JSON, while MiniCPM-OCR Jev scores the parsing results.

[MiniCPM-OCR 1.0 deployment tutorial](https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/minicpmvocr_tutorial_en.md) · [MiniCPM-OCR Jev deployment tutorial](https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/minicpm_ocr_jev_tutorial_en.md)

<a id="模型微调"></a>

### Fine-Tuning

| Model | Fine-tuning tutorial |
| :--- | :--- |
| MiniCPM-OCR 1.0 | [LLaMA-Factory](https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/llamafactory_minicpm_ocr_french_en.md) · [Swift](https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/swift_minicpm_ocr_french_en.md) |
| MiniCPM-OCR Jev | [Swift](https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/finetune_jev_en.md) |

<a id="resources"></a>
<a id="model-weights"></a>

## Model Weights

<table border="1" cellspacing="0" cellpadding="8">
<tr>
<td nowrap>Model</td>
<td width="360">Description</td>
<td nowrap width="170">Main Model Weights</td>
<td nowrap width="150">DSpark Heads</td>
</tr>
<tr>
<td nowrap>MiniCPM&#8209;OCR&nbsp;<strong>1.0</strong></td>
<td width="360">Efficient document parsing and text recognition for Chinese and English documents and PDFs, balancing quality and speed across scans, photographs, curved pages, and recaptured documents.</td>
<td nowrap><a href="https://huggingface.co/openbmb/MiniCPM-OCR-1.0">🤗</a>&nbsp;&nbsp;<a href="https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/modelscope_logo.png" width="20" alt="ModelScope"></a>&nbsp;<strong>BF16</strong><br><a href="https://huggingface.co/openbmb/MiniCPM-OCR-1.0-gguf">🤗</a>&nbsp;&nbsp;<a href="https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0-gguf"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/modelscope_logo.png" width="20" alt="ModelScope"></a>&nbsp;<strong>GGUF</strong><br><a href="https://huggingface.co/openbmb/MiniCPM-OCR-1.0-AWQ">🤗</a>&nbsp;&nbsp;<a href="https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0-AWQ"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/modelscope_logo.png" width="20" alt="ModelScope"></a>&nbsp;<strong>AWQ</strong><br><a href="https://huggingface.co/openbmb/MiniCPM-OCR-1.0-GPTQ">🤗</a>&nbsp;&nbsp;<a href="https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0-GPTQ"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/modelscope_logo.png" width="20" alt="ModelScope"></a>&nbsp;<strong>GPTQ</strong></td>
<td nowrap><a href="https://huggingface.co/openbmb/MiniCPM-OCR-1.0-DSpark">🤗</a>&nbsp;&nbsp;<a href="https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0-DSpark"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/modelscope_logo.png" width="20" alt="ModelScope"></a>&nbsp;<strong>BF16</strong><br><a href="https://huggingface.co/openbmb/MiniCPM-OCR-1.0-DSpark-gguf">🤗</a>&nbsp;&nbsp;<a href="https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-1.0-DSpark-gguf"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/modelscope_logo.png" width="20" alt="ModelScope"></a>&nbsp;<strong>GGUF</strong></td>
</tr>
<tr>
<td nowrap>MiniCPM&#8209;OCR&nbsp;<strong>Jev</strong></td>
<td width="360">An OCR correctness decision model for text, formulas, and tables. Given an image and its OCR result, it returns a quality score from 0 to 1.</td>
<td align="center" valign="middle" colspan="2"><a href="https://huggingface.co/openbmb/MiniCPM-OCR-1.0-Jev">🤗</a>&nbsp;&nbsp;<a href="https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-Jev"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/modelscope_logo.png" width="20" alt="ModelScope"></a>&nbsp;<strong>BF16</strong>&emsp;<a href="https://huggingface.co/openbmb/MiniCPM-OCR-1.0-Jev-gguf">🤗</a>&nbsp;&nbsp;<a href="https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-Jev-gguf"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/modelscope_logo.png" width="20" alt="ModelScope"></a>&nbsp;<strong>GGUF</strong><br><a href="https://huggingface.co/openbmb/MiniCPM-OCR-1.0-Jev-AWQ">🤗</a>&nbsp;&nbsp;<a href="https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-Jev-AWQ"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/modelscope_logo.png" width="20" alt="ModelScope"></a>&nbsp;<strong>AWQ</strong>&emsp;<a href="https://huggingface.co/openbmb/MiniCPM-OCR-1.0-Jev-GPTQ">🤗</a>&nbsp;&nbsp;<a href="https://modelscope.cn/models/OpenBMB/MiniCPM-OCR-Jev-GPTQ"><img src="https://raw.githubusercontent.com/OpenBMB/MiniCPM-OCR/main/assets/minicpm-ocr/modelscope_logo.png" width="20" alt="ModelScope"></a>&nbsp;<strong>GPTQ</strong></td>
</tr>
</table>

## 💡 FAQ and Troubleshooting

See the [FAQ](https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/faq_en.md) for common questions about installation, model downloads, GPU memory, input formats, and unexpected outputs.

## 📄 License

The entire project is released under the [Apache License 2.0](https://github.com/OpenBMB/MiniCPM-OCR/blob/main/LICENSE), including code, documentation, and model weights for MiniCPM-OCR 1.0 and MiniCPM-OCR Jev.
