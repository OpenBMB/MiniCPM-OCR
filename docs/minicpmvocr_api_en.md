# SDK API and Configuration

[← Back to README](../README.md) · [Installation and inference tutorial](./minicpmvocr_tutorial_en.md) · [中文](./minicpmvocr_api.md)

This guide covers `minicpmvocr` command-line options, configuration overrides, and the Python API. Install the SDK and start a compatible recognition service before running the examples.

## Command-line options

Parse a PDF or image into Markdown:

```bash
minicpmvocr parse doc.pdf -o doc.md --device cuda:0 \
  --server-url http://127.0.0.1:18499 --model minicpm-ocr
```

| Option | Description |
|---|---|
| `INPUT` / `--input FILE` | Input file: PDF, PNG, JPG, JPEG, BMP, WebP, TIF, or TIFF; use either form |
| `-o FILE` / `--output FILE` | Output Markdown path; writes to standard output when omitted |
| `--server-url URL` | Required recognition service URL; repeat to connect to multiple service instances |
| `--model NAME` | Required model name exposed by the service, matching vLLM's `--served-model-name` |
| `--device DEVICE` | Layout detection device, such as `cuda:0`; does not change the device used by the recognition service |
| `--layout-model DIR` | Local layout model directory you have already prepared; the default provider uses the PP-DocLayoutV3 Paddle inference format |
| `--workers N` | Total concurrent recognition requests; the quickstart uses 32. Each request usually handles one document chunk |
| `--backend NAME` | Recognition backend: `vllm`, `openai`, `llamacpp`, or `ollama` |
| `--layout NAME` | Layout provider: `ppdoclayout3_paddlex`, `ppdoclayout3_torch`, or `ppdoclayout3_server` |
| `--config FILE` | Custom YAML configuration file; uses the built-in quickstart configuration when omitted |
| `--set KEY=VALUE` | Override a configuration value using a dotted path; repeat as needed, for example `--set input.limit=1` |
| `--stdout` | Print Markdown to standard output even when `-o` is supplied |
| `--run-tag NAME` | Name of the intermediate output directory; generated from the input filename and time when omitted |

Pass `--server-url` and `--model` explicitly on every `parse` invocation, even when using `--config` or environment variables.

Run `minicpmvocr parse --help` for the complete option list.

## Configuration overrides and defaults

When `--config` is supplied, the selected configuration file is loaded first, then command-line options are applied. `--set` takes precedence over other command-line options. See the [SDK configuration file](../sdk/minicpmvocr/configs/minicpmvocr.yaml) for all configuration fields.

Without `--config`, the quickstart configuration uses GPU 0 for layout detection, a recognition context length of 40960, and 32 concurrent recognition requests. Layout detection and recognition overlap, and cross-page table merging is disabled. The service URL and model name have no default values.

The default Paddle layout model is stored in `models/PP-DocLayoutV3_infer/` under the working directory. Complete model files are reused; missing or incomplete files trigger an automatic download. Set `OCR_ASSETS_DIR` to change the root directory for model assets.

When specifying a model path through `--layout-model DIR`, `OCR_LAYOUT_MODEL_DIR`, or a custom configuration file, prepare the local model first. Relative paths in a custom YAML file are resolved against that file's directory; relative `--layout-model` paths are resolved against the directory where the command is run.

Multiple recognition service instances should use the same model name and weights. `--workers` sets the total request concurrency shared by all instances.

## Python API

This example uses the bundled configuration to parse an entire PDF and combine its pages into one Markdown file. Supply the service URL and model name explicitly:

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

`ensure_layout_model()` reuses or downloads the official layout model; `load_config()` merges the configuration and validates the input; `pipelined_run()` runs layout detection and recognition; `assemble_document_markdown()` returns the combined Markdown, page count, and number of cross-page table merges.

Run artifacts are written to `runs/<run_tag>/` under the working directory by default, including per-page Markdown, structured results, and run records. Change the output root with `run.run_root` in the configuration or the `OCR_RUN_ROOT` environment variable.
