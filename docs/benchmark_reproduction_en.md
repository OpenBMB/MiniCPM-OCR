# Reproducing MiniCPM-OCR Performance and Efficiency Evaluation Results

[← Back to README](../README.md) · [Model guide](./minicpm_ocr_1dot0_en.md)

This document summarizes the inference settings, scoring methods, and official sources for evaluating MiniCPM-OCR 1.0, along with the test settings and deployment guides for the parsing-efficiency comparison. Complete evaluation scripts, exact versions, and timing boundaries remain to be added.

## Performance Reproduction

### Evaluation Settings

The same sampling parameters are used across all six benchmarks:

| Parameter | Value | Description |
| :--- | :--- | :--- |
| `temperature` | `0.01` | Sampling temperature |
| `top_p` | `0.001` | Nucleus sampling threshold |
| `top_k` | `1` | Maximum number of candidate tokens |
| `repetition_penalty` | `1.0` | No additional repetition penalty |
| `no_repeat_ngram_size` | `0` | Disable the constraint against repeated n-grams |
| `enable_thinking` | `false` | Disable thinking mode |

The generation length limit is set by **recognition region type**:

| Recognition region type | Maximum generation length (tokens) |
| :--- | ---: |
| Plain text | 4096 |
| Tables | 8192 |
| Display equations | 2048 |
| Inline equations | 1024 |

Short regions, such as headings, use lower generation length limits.

The visual configuration and model context limit are as follows:

| Parameter | Value |
| :--- | :--- |
| `downsample_mode` | `4x` |
| `max_slice_nums` | `9` |
| `max_model_len` | `40960` |

### Scoring Methods and Official Sources

Scoring is performed separately after the model generates predictions: the prediction files and the corresponding version of the ground-truth annotations (GT) are passed to the scorer, and the metrics are then aggregated.

### Benchmarks and Official Scoring Resources

| Benchmark | Scoring method | Official repositories and documentation |
| :--- | :--- | :--- |
| OmniDocBench v1.6 | Match elements in full-page Markdown against the v1.6 full GT, then compute text edit distance, formula CDM, table TEDS, and reading-order edit distance. This evaluation uses `quick_match`. | [OmniDocBench repository and evaluation guide](https://github.com/opendatalab/OmniDocBench#evaluation) |
| Real5-OmniDocBench | Reuse the OmniDocBench v1.5 annotations and scoring procedure. Score the five scenarios—Scanning, Warping, Screen-Photography, Illumination, and Skew—separately, with 1,355 pages per scenario. The aggregate score in this evaluation is the equally weighted average of the five scenario Overall scores. | [Official Real5 data and evaluation instructions](https://huggingface.co/datasets/PaddlePaddle/Real5-OmniDocBench#evaluation), [OmniDocBench v1.5 scoring repository](https://github.com/opendatalab/OmniDocBench/tree/v1_5) |
| Wild-OmniDocBench | Score full-page Markdown for 1,350 pages of images captured in real-world conditions, using OmniDocBench annotations and metrics. This evaluation uses the v1.6 scorer and the subset of v1.5 GT corresponding to the Wild pages. The Wild-OmniDocBench scores reported in this project are obtained after rotation correction using the [SDK (`sdk/`)](../sdk/). | [Official Wild repository](https://github.com/VirtualLUOUCAS/Wild_OmniDocBench#evaluation), [OmniDocBench scoring repository](https://github.com/opendatalab/OmniDocBench) |
| olmOCR-Bench | Use the official rules to check text presence and absence, reading order, table relationships, formulas, and other properties in Markdown. Compute the test pass rate for each category, then take the equally weighted average of the category scores. | [allenai/olmocr scoring instructions](https://github.com/allenai/olmocr/blob/main/olmocr/bench/README.md), [scoring code](https://github.com/allenai/olmocr/blob/main/olmocr/bench/benchmark.py), [official dataset](https://huggingface.co/datasets/allenai/olmOCR-bench) |
| OCRBench v2 | Write each answer to the `predict` field in the prediction JSON. First score by task type with `eval_scripts/eval.py`, then aggregate the Chinese and English task metrics with `eval_scripts/get_score.py`. | [Official MultimodalOCR/OCRBench_v2 repository and commands](https://github.com/Yuliang-Liu/MultimodalOCR/tree/main/OCRBench_v2#evaluation) |
| CHAOS-Bench | Compare model outputs against the actually altered words in the image, `ocr_ans`, to measure the proportion recognized faithfully. Outputting the original words, `origin_ans`, does not count as correct. The matching and aggregation rules for this evaluation are described below. | [Official HunyuanOCR/CHAOS-Bench data and evaluation instructions](https://github.com/Tencent-Hunyuan/HunyuanOCR/tree/main/benchmarks/CHAOS-Bench) |

### Document Parsing Metrics and Scoring Images

Overall for OmniDocBench, Real5, and Wild is calculated as follows, with `FormulaCDM` and `TableTEDS` expressed as percentages:

```text
Overall = ((1 - TextEdit) × 100 + FormulaCDM + TableTEDS) / 3
```

Lower `TextEdit` and reading-order edit distance are better; higher `FormulaCDM`, `TableTEDS`, `TableTEDS-S`, and Overall are better. Reading order and `TableTEDS-S` are reported separately and are not included in Overall above.

If a Docker scoring environment is needed, download the images referenced in the official documentation:

```bash
# Public image recommended by the current official OmniDocBench evaluation guide
docker pull ghcr.io/zeng-weijun/omnidocbench-eval:repro-ubuntu2204

# Environment image listed in the official OmniDocBench v1.5 documentation used for Real5
docker pull sunyuefeng/omnidocbench-env:v1.5
```

For complete mount and execution instructions, see the [OmniDocBench Docker evaluation guide](https://github.com/opendatalab/OmniDocBench#environment-setup-and-running) and [v1.5 Docker instructions](https://github.com/opendatalab/OmniDocBench/tree/v1_5#using-docker). The configuration file must specify `ground_truth.data_path`, `prediction.data_path`, the matching method, and the metrics. Run the following in the corresponding scoring environment:

```bash
python pdf_validation.py --config /path/to/eval.yaml
```

The GT page version must match the evaluation dataset; the v1.6 full GT cannot directly replace the v1.5 GT used for Real5. Public image tags may change. To reproduce historical results, pin the scoring code commit, image digest, GT version, and scoring configuration.

In this evaluation, OmniDocBench, Real5, and olmOCR use internally packaged images with scoring code and GT preinstalled; Wild uses fixed scoring assets, and CHAOS uses a local scoring script. The public images above are provided for setting up scoring environments.

### Scoring and Aggregation Rules

- **Evaluation scope**: The six tracks in the archived results are OmniDocBench v1.6, Real5, olmOCR-Bench, Wild original images, Wild deskewed images, and CHAOS-Bench.
- **Wild**: The scores reported in this project use the results after SDK rotation correction. Archived results for original and deskewed images are reported separately, using the same GT and scorer. Deskewing changes input preprocessing, so these results must be treated as separate tracks.
- **olmOCR-Bench**: The main score is the equally weighted average of eight categories, including Base and Headers & Footers. If `excl. headers & footers` is also reported, average only the remaining seven categories with equal weights and label it explicitly.
- **CHAOS-Bench**: There are 500 pages and 1,025 altered words. In this evaluation, whitespace is normalized in the full-page Markdown, and `ocr_ans` is searched for case-insensitively at word boundaries. Compute the hit rate for each page, then take the equally weighted average across all 500 pages and multiply by 100. Pages with empty outputs receive zero. This local implementation does not align outputs individually with the annotated `bbox` regions, so its results should be reported separately from recognition results on cropped regions.

## Parsing Efficiency Test

### Settings

| Item | Test condition |
| :--- | :--- |
| Dataset | The complete OmniDocBench v1.6 dataset, containing 1,651 images |
| SDK and configuration | Each system's official SDK, with acceleration enabled and other settings left at their defaults |
| Concurrency | Image-level concurrency of 1 |
| Hardware | NVIDIA GeForce RTX 5090; all systems run on the same hardware |
| Metric | Pages processed per second (pages/s); higher values indicate higher throughput |

Image-level concurrency and recognition concurrency for regions within a page are separate settings, corresponding to `pipeline.page_workers` and `pipeline.max_workers` in the SDK. See the [SDK tutorial](./minicpmvocr_tutorial_en.md). Image-level concurrency of 1 does not imply that regions within each page are recognized sequentially.

### Deployment and DSpark Acceleration

- [SDK tutorial](./minicpmvocr_tutorial_en.md): Install the environment, connect an inference backend, parse documents, and check outputs.
- [vLLM deployment guide](./vllm_deploy_en.md): Deploy the API service and check recognition results.

A comparison with and without DSpark must use the same main-model weights, dataset, hardware, and SDK configuration, changing only whether DSpark is enabled. The deployment examples start the service; complete comparison commands and logs for reproducing the 62% improvement remain to be added.

### Interpreting Results

Enabling DSpark decoding acceleration improves MiniCPM-OCR 1.0's end-to-end processing efficiency by **62%**. This improvement describes the benefit of DSpark acceleration and does not replace throughput comparisons with other systems.

MiniCPM-OCR 1.0 achieves a parsing throughput of **1.213 pages/s**, compared with **1.179 pages/s** for GLM-OCR. With MiniCPM-OCR 1.0 as the relative-throughput baseline (**1.00×**), GLM-OCR, PaddleOCR-VL-1.6, MinerU2.5-Pro-Standard, and MinerU2.5-Pro-Advanced achieve **0.97×, 0.67×, 0.44×, and 0.28×**, respectively. For complete values and comparison charts, see the [model guide's Throughput section](./minicpm_ocr_1dot0_en.md#throughput).
