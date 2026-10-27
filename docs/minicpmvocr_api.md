# SDK API 与配置说明

[← 返回 README](../README_zh.md) · [安装与推理教程](./minicpmvocr_tutorial.md) · [English](./minicpmvocr_api_en.md)

本文介绍 `minicpmvocr` 的命令行参数、配置覆盖方式和 Python API。运行前需安装 SDK，并启动兼容的识别服务。

## 命令行参数

解析一个 PDF 或图片，输出 Markdown：

```bash
minicpmvocr parse doc.pdf -o doc.md --device cuda:0 \
  --server-url http://127.0.0.1:18499 --model minicpm-ocr
```

| 参数 | 说明 |
|---|---|
| `INPUT` / `--input FILE` | 输入文件，支持 PDF、PNG、JPG、JPEG、BMP、WebP、TIF、TIFF；两种写法任选其一 |
| `-o FILE` / `--output FILE` | 输出 Markdown 路径；省略时输出到标准输出 |
| `--server-url URL` | 必填，识别服务地址；可重复传入以连接多个服务实例 |
| `--model NAME` | 必填，服务暴露的模型名称，对应 vLLM 的 `--served-model-name` |
| `--device DEVICE` | 版面检测设备，例如 `cuda:0`；不改变识别服务使用的设备 |
| `--layout-model DIR` | 已准备好的本地版面模型目录；默认 provider 使用 PP-DocLayoutV3 Paddle inference 格式 |
| `--workers N` | 识别请求的总并发数，快速开始配置为 32；一个请求通常对应一个文档块 |
| `--backend NAME` | 识别后端，支持 `vllm`、`openai`、`llamacpp`、`ollama` |
| `--layout NAME` | 版面 provider，支持 `ppdoclayout3_paddlex`、`ppdoclayout3_torch`、`ppdoclayout3_server` |
| `--config FILE` | 自定义 YAML 配置文件；省略时使用内置快速开始配置 |
| `--set KEY=VALUE` | 按点分路径覆盖配置项，可重复传入，例如 `--set input.limit=1` |
| `--stdout` | 将 Markdown 输出到标准输出，即使同时传入了 `-o` |
| `--run-tag NAME` | 指定中间产物目录名；未指定时根据输入文件名和时间生成 |

`--server-url` 和 `--model` 必须在每次 `parse` 命令中显式传入，即使使用了 `--config` 或设置了环境变量。

完整参数可通过 `minicpmvocr parse --help` 查看。

## 配置覆盖与默认行为

指定 `--config` 时，先读取所选配置文件，再应用命令行选项；`--set` 的优先级高于其他命令行选项。完整配置项见 [SDK 配置文件](../sdk/minicpmvocr/configs/minicpmvocr.yaml)。

省略 `--config` 时，快速开始配置使用 GPU 0 进行版面检测，识别上下文长度为 40960，识别请求并发数为 32，版面检测与识别重叠执行，关闭跨页表格合并。服务地址和模型名称没有默认值。

默认 Paddle 版面模型位于运行目录下的 `models/PP-DocLayoutV3_infer/`。文件完整时直接复用；缺失或不完整时自动下载。`OCR_ASSETS_DIR` 可更改模型所在的资产根目录。

使用 `--layout-model DIR`、`OCR_LAYOUT_MODEL_DIR` 或自定义配置文件指定模型路径时，需提前准备本地模型。自定义 YAML 中的相对路径以配置文件所在目录为基准；`--layout-model` 的相对路径以运行命令时的目录为基准。

多个识别服务实例应使用相同的模型名称和权重。`--workers` 是这些实例共享的请求并发总数。

## Python API

下面使用包内配置解析整个 PDF，并将各页合并导出为一个 Markdown 文件。服务地址和模型名称仍需显式提供：

```python
from importlib.resources import files
from pathlib import Path

from minicpmvocr import (
    assemble_document_markdown,
    load_config,
    load_prompt_map,
    pipelined_run,
)
from minicpmvocr.layouts.download import ensure_layout_model

def main():
    layout_model = ensure_layout_model(Path("models/PP-DocLayoutV3_infer"))
    config_path = files("minicpmvocr").joinpath("configs/minicpmvocr.yaml")
    cfg = load_config(str(config_path), overrides={
        "input": {"file_path": str(Path("doc.pdf").resolve())},
        "engine": {
            "server_url": "http://127.0.0.1:18499",
            "model_name": "minicpm-ocr",
            "max_model_len": 40960,
        },
        "layout": {"model_dir": str(layout_model), "device": "cuda:0"},
        "pipeline": {"overlap_layout": True},
    })

    pipelined_run(cfg)
    markdown, page_count, merge_count = assemble_document_markdown(
        Path(cfg["_meta"]["run_dir"]),
        load_prompt_map(cfg),
        merge_tables=cfg["pipeline"]["merge_cross_page_tables"],
        delimiter="\n\n<!-- page-break -->\n\n",
    )
    Path("doc.md").write_text(markdown, encoding="utf-8")


if __name__ == "__main__":
    main()
```

`ensure_layout_model()` 复用或下载官方版面模型；`load_config()` 合并配置并校验输入；`pipelined_run()` 执行版面检测和识别；`assemble_document_markdown()` 返回合并后的 Markdown、页数和跨页表格合并次数。

运行产物默认写入当前目录下的 `runs/<run_tag>/`，包括逐页 Markdown、结构化结果和运行记录。可通过配置项 `run.run_root` 或环境变量 `OCR_RUN_ROOT` 更改输出根目录。
