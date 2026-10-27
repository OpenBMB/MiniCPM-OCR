# MiniCPM-OCR 1.0 Reproduction Guide

[← Back to README](../README.md) · [中文](./benchmark_reproduction_zh.md) · [Model guide](./minicpm_ocr_1dot0_en.md)

This document summarizes the test settings and deployment guides for the MiniCPM-OCR 1.0 parsing-efficiency comparison. Complete evaluation scripts, exact versions, and timing boundaries remain to be added.

## Test Settings

| Item | Test condition |
| :--- | :--- |
| Dataset | The complete OmniDocBench v1.6 dataset, containing 1,651 images |
| SDK and configuration | Each system's official SDK, with acceleration enabled and other settings left at their defaults |
| Concurrency | Image-level concurrency of 1 |
| Hardware | NVIDIA GeForce RTX 5090; all systems run on the same hardware |
| Metric | Pages processed per second (pages/s); higher values indicate higher throughput |

<!-- Source: test settings on pages 6–7 and the throughput chart on page 7 of the user-provided “MiniCPM-OCR 1.0 - 飞书云文档.pdf”; checked on 2026-10-22. The figure states “All models use accelerated configurations.” The original figure does not specify a separate acceleration method for GLM-OCR, so its name is unchanged. -->

Image-level concurrency and recognition concurrency for regions within a page are separate settings, corresponding to `pipeline.page_workers` and `pipeline.max_workers` in the SDK. See the [SDK tutorial](./minicpmvocr_tutorial_en.md). Image-level concurrency of 1 does not imply that regions within each page are recognized sequentially.

## Deployment and DSpark Acceleration

- [SDK tutorial](./minicpmvocr_tutorial_en.md): Install the environment, connect an inference backend, parse documents, and check outputs.
- [vLLM deployment guide](./vllm_deploy_en.md): Deploy the API service and check recognition results.

A comparison with and without DSpark must use the same main-model weights, dataset, hardware, and SDK configuration, changing only whether DSpark is enabled. The deployment examples start the service; complete comparison commands and logs for reproducing the speedup remain to be added.

## Interpreting Results

Measure the benefit of DSpark by comparing the same system with DSpark enabled and disabled. Cross-system throughput comparisons instead reflect each system's parsing efficiency under the settings above; report these two comparisons separately. Throughput values and comparison charts are collected in the [model guide's Throughput section](./minicpm_ocr_1dot0_en.md#throughput).

## Reproduction Details Still to Be Added

- Model weight revisions, SDK versions, complete startup commands, and acceleration arguments for each system.
- Timing start and end points, warmup procedure, failure and retry handling, and complete run logs.
- Commands and results comparing MiniCPM-OCR 1.0 with DSpark enabled and disabled under identical conditions.
- Complete scripts, dataset versions, metric definitions, and subset results for each benchmark.
