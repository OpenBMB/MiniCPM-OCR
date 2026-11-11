# SDK API and Configuration

[← Back to README](../README.md) · [Installation and inference tutorial](./minicpm_ocr_tutorial_en.md) · [中文](./minicpm_ocr_sdk_api.md)

This guide covers `minicpmvocr` command-line options, configuration overrides, and the Python API. Install the SDK and start a compatible recognition service before running the examples.

## Command-line options

Parse a PDF or image into Markdown:

```bash
minicpmvocr parse doc.pdf -o doc.md --device cuda:0 \
  --server-url http://127.0.0.1:18499 --model minicpm-ocr
```

Parsing several files writes one result per file:

```bash
minicpmvocr parse a.png b.png doc.pdf -o out/ --json \
  --device cuda:0 --server-url http://127.0.0.1:18499 --model minicpm-ocr
```

This writes `a.md`, `a.json`, `b.md`, `b.json`, `doc.md`, and `doc.json` under `out/`. A directory may be given instead; only its top-level PDFs and images are read, without recursion.

| Option | Description |
|---|---|
| `INPUT` / `--input FILE` | Input file: PDF, PNG, JPG, JPEG, GIF, BMP, WebP, TIF, or TIFF; either form repeats, and a directory is accepted |
| `-o PATH` / `--output PATH` | Markdown path for one input; must be a directory for several, which writes one `<name>.md` per input; standard output when omitted |
| `--json [PATH]` | Also write JSON shaped like an online document-parse job. For one input `PATH` is a file and is written next to the Markdown when omitted; several inputs write `<name>.json` |
| `--split-images` | Treat each standalone image as its own document instead of pages of one collection. PDFs always stay one document per file |
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
| `--stream` / `--stream-ordered` | Write one JSON line to standard output as soon as each page is parsed, without waiting for the whole run, then a last line with the run summary. `--stream` writes pages in the order they finish, `--stream-ordered` in reading order. `--stream-detail LEVEL` sets how fine the lines are: `page` (default) one line per page, `block` also the layout and each block, `token` also the text of each block while it is decoded. Files requested with `-o` and `--json` are still written at the end; with several inputs `-o` may be omitted, which writes no files. Cannot be combined with `--stdout`; see [Page-by-Page Results](#page-by-page-results) |
| `--run-tag NAME` | Name of the intermediate output directory; generated from the input filename and time when omitted |

Pass `--server-url` and `--model` explicitly on every `parse` invocation, even when using `--config` or environment variables.

Run `minicpmvocr parse --help` for the complete option list.

## Configuration overrides and defaults

When `--config` is supplied, the selected configuration file is loaded first, then command-line options are applied. `--set` takes precedence over other command-line options. See the [SDK configuration file](../sdk/minicpmvocr/configs/minicpmvocr.yaml) for all configuration fields.

Without `--config`, the quickstart configuration uses GPU 0 for layout detection, enables rotation adaptation (`upright`), a recognition context length of 40960, and 32 concurrent recognition requests. Layout detection and recognition overlap, and cross-page table merging is disabled. The service URL and model name have no default values.

The default Paddle layout model is stored in `models/PP-DocLayoutV3_infer/` under the working directory, and the three Paddle models used by rotation adaptation are stored in `models/paddle_upright/`. Complete model files are reused; missing or incomplete files trigger an automatic download. Set `OCR_ASSETS_DIR` to change the root directory for model assets, or `OCR_UPRIGHT_DIR` to point at a prepared `paddle_upright` directory. If the optional `paddleocr` dependency is missing, parsing does not fail: a warning is logged and rotation adaptation is skipped for that run.

Disable rotation with `--set upright.enabled=false`.

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

### Page-by-Page Results

A PDF or a batch of images does not have to finish before you see results: `stream_pages(cfg)` is a generator that yields each page as soon as it is parsed, while the remaining pages keep going in the background. `cfg` is the same as in the example above:

```python
from minicpmvocr import stream_pages

for page in stream_pages(cfg):
    print(f"[{page['pages_done']}/{page['pages_total']}] {page['source']} page {page['page_index'] + 1} {page['status']}")
    print(page["markdown"])
```

Pages are yielded in the order they finish, which is not necessarily page order; `stream_pages(cfg, ordered=True)` yields them in input order, so a page that finishes early waits for the ones before it. Each page event has these fields:

| Field | Description |
|---|---|
| `index` | Position of the page in the input order of the whole run, zero-based |
| `pages_done` / `pages_total` | Pages yielded so far and the total |
| `source` / `source_id` | The input file the page came from, and its id in `runtime/sources.json` |
| `page_index` | Page number inside its own file, zero-based; always 0 for a standalone image |
| `image_id` | Page id, matching `pages_json/<image_id>.json` |
| `status` / `error` | `ok`, `partial_failed` (some blocks failed), or `failed`; `error` gives the reason for a failure |
| `markdown` | Markdown of the page |
| `output_md` | Path of the page's Markdown file; `imgs/` links in the Markdown are relative to its directory |
| `page` | The full result in the shape of the online page response (including `ocr.blocks[]`); `None` when the page failed |

A page that fails only shows in the `status` of its own event, and the other pages still arrive; an error that stops the whole run is raised after the pages finished before it have been yielded. Ending the iteration early does not cancel the run: the remaining pages are still parsed in the background and written to the run directory. The generator's return value is the run summary. Instead of the generator you can pass a callback to `pipelined_run(cfg, on_page=...)` or `infer_run(cfg, on_page=...)`; it receives the same events.

Pages are yielded before cross-page table merging; with `pipeline.merge_cross_page_tables` enabled, `assemble_document_markdown()` after the run is the authoritative result.

When pages are streamed, earlier pages go first: the PDF renders in page order in the background and layout detection starts on the first pages as soon as they are rendered, without waiting for the whole PDF; recognition requests are also sent page by page, so earlier pages finish first. A page that fails to render is reported as `failed` on its own. Otherwise the run still sends its longest blocks first across all pages, which gives the shortest total time but makes most pages finish close to the end. Streaming therefore takes slightly longer in total: about 5% to 13% on 18- to 45-page PDFs measured on a single A100. With the shared worker pool (`OCR_SHARED_CROP_POOL=1`) the sending order is unchanged.

#### Blocks and Text as It Is Decoded

`detail` sets how fine the events are. The default `"page"` yields only the page events above (`"event": "page"`). `detail="block"` adds two kinds of event before each page event, and `detail="token"` one more:

| Event | When | Fields |
|---|---|---|
| `layout` | A page has been laid out, before recognition starts | `image_width`, `image_height`, `blocks[]` (in reading order, each with `order`, `label`, `bbox`) |
| `block` | One block has been recognized | `order`, `label`, `bbox`, `status`, `content` |
| `delta` | While a block is being decoded (`detail="token"` only) | `order`, `text` (the new piece of text) |

All three carry `index` and `image_id`; `layout` and `block` also carry `source`, `source_id`, and `page_index`. `image_id` plus `order` identifies a block:

```python
for event in stream_pages(cfg, ordered=True, detail="token"):
    if event["event"] == "delta":
        print(event["text"], end="", flush=True)      # text as it is decoded
    elif event["event"] == "block":
        replace_block(event["image_id"], event["order"], event["content"])
```

- A `delta` carries the model's raw output; the `content` of a `block` is the tidied result (inline formulas rewritten as `$...$`, tables converted to HTML, and so on) and should replace the `delta` text collected for that block. A `delta` with `"restart": true` means the request for that block was sent again: drop the text collected so far.
- The content of a `block` matches the final page; only a table that references figures of its page is settled when the whole page is assembled, so the page event is authoritative.
- Blocks that are not recognized (images and the like) still get a `block` event, with empty `content` and no `delta`. With `tts` (candidate reranking) enabled the result is only known after the candidates are compared, so there are no `delta` events; `block` events come as usual.
- By default pages and blocks are recognized in parallel and their events interleave. With `ordered=True` everything is strictly in reading order: a page's `layout`, then block after block its `delta` events and its `block`, then the `page`, then the next page. The block whose turn it is passes through live; whatever is ahead of its turn is held. Concatenating the `delta` text then reads as the document does.
- Text as it is decoded needs a recognition service that streams; the `vllm`, `openai`, `llamacpp`, and `ollama` backends are each asked through their own streaming interface.

On the command line, `--stream` writes one JSON line to standard output as soon as each page is parsed (the fields above), and a last line with `"event": "done"` carrying the run summary; add `--stream-detail block` or `--stream-detail token` for the block-level or text-level lines:

```bash
minicpmvocr parse doc.pdf --stream \
  --device cuda:0 --server-url http://127.0.0.1:18499 --model minicpm-ocr
```

### Loading the Models Once

By default every run loads the layout model (and the upright models when rotation is enabled) for itself and unloads it at the end. To parse several batches in one process, load once with `load_models(cfg)` and pass the result to each run as `resources`; later runs no longer wait for the models:

```python
from minicpmvocr import load_models, pipelined_run, stream_pages

def make_cfg(path):
    return load_config(str(config_path), overrides={**overrides, "input": {"file_path": path}})

with load_models(make_cfg("a.pdf")) as models:
    for path in ["a.pdf", "b.pdf", "c.pdf"]:
        for page in stream_pages(make_cfg(path), resources=models):   # page by page
            print(page["markdown"])
    pipelined_run(make_cfg("d.pdf"), resources=models)                # not streamed, reused all the same
```

`load_models()` reads `layout`, `upright`, and `pipeline.layout_workers`; the runs that reuse it should keep those settings, because the loaded models win. One loaded set serves one run at a time. Leaving the `with` block or calling `models.close()` unloads them.

Each command-line invocation is a new process, so the models cannot stay in memory between invocations; several inputs in one invocation load them once.

With several inputs, `runtime/sources.json` records which pages each input file produced and the image document scope. `pages_json/<image_id>.json` matches the online page response, with `metadata` also carrying `source` (the input path) and `image_id`. `assemble_documents_json(run_dir)` returns the same per-file grouping as `--json`, with a batch status of `Success`, `Partial`, or `Failed`.

`pipeline.image_document_scope` sets how standalone images are grouped: `collection` (default) treats every image in the run as pages of one document, so cross-page table merging can span them; `file` makes each image its own document and matches `--split-images`. PDFs always merge per file. Images may also be listed in `input.file_paths`, processed in the given order.

Run artifacts are written to `runs/<run_tag>/` under the working directory by default, including per-page Markdown, structured results, and run records. `pages_json/<image_id>.json` has the same shape as one page of the online [Document Parsing API](https://platform.modelbest.cn/console/docs/api/document-parse): `metadata.page_index` (zero-based), `choices[0].message.content` (page Markdown), and `ocr` (`image_width`, `image_height`, `blocks[]`, `rotation`). Block `status` is `ok`, `failed`, `skipped_no_vlm`, or `skipped_seal`; `rotation.total_angle` is positive counterclockwise, and coordinates refer to the corrected page when `applied=true`. `assemble_document_json(run_dir)` returns the same document as `--json`, joining page Markdown with a blank line. Change the output root with `run.run_root` in the configuration or the `OCR_RUN_ROOT` environment variable.
