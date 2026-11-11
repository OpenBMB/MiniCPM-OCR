# SDK API 与配置说明

[← 返回 README](../README_zh.md) · [安装与推理教程](./minicpm_ocr_tutorial.md) · [English](./minicpm_ocr_sdk_api_en.md)

本文介绍 `minicpmvocr` 的命令行参数、配置覆盖方式和 Python API。运行前需安装 SDK，并启动兼容的识别服务。

## 命令行参数

解析一个 PDF 或图片，输出 Markdown：

```bash
minicpmvocr parse doc.pdf -o doc.md --device cuda:0 \
  --server-url http://127.0.0.1:18499 --model minicpm-ocr
```

一次解析多个文件时，每个文件各写一份结果：

```bash
minicpmvocr parse a.png b.png doc.pdf -o out/ --json \
  --device cuda:0 --server-url http://127.0.0.1:18499 --model minicpm-ocr
```

`out/` 下得到 `a.md`、`a.json`、`b.md`、`b.json`、`doc.md`、`doc.json`。也可以直接传一个目录，只取该目录顶层的图片和 PDF，不递归。

| 参数 | 说明 |
|---|---|
| `INPUT` / `--input FILE` | 输入文件，支持 PDF、PNG、JPG、JPEG、GIF、BMP、WebP、TIF、TIFF；两种写法都可以重复，也可以传一个目录 |
| `-o PATH` / `--output PATH` | 单个输入时为 Markdown 路径；多个输入时必须是目录，每个输入写一份 `<文件名>.md`；省略时输出到标准输出 |
| `--json [PATH]` | 另外输出 JSON，结构与线上文档解析异步任务一致。单个输入时 `PATH` 是文件，省略时写在 Markdown 旁边；多个输入时写 `<文件名>.json` |
| `--split-images` | 把每张单图当作独立文档，而不是同一份文档的各页。PDF 始终按文件合并 |
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
| `--stream` / `--stream-ordered` | 每解析完一页就向标准输出写一行 JSON，不等全部解析完，最后一行是运行摘要。`--stream` 按完成先后输出，`--stream-ordered` 按阅读顺序输出。`--stream-detail LEVEL` 设置粒度：`page`（默认）每页一行，`block` 另有版面和每个块的行，`token` 再加每个块解码过程中的文本。`-o`、`--json` 指定的文件仍在结束时写出；多个输入时可以省略 `-o`，此时不写文件。不能与 `--stdout` 同用，见[逐页返回结果](#逐页返回结果) |
| `--run-tag NAME` | 指定中间产物目录名；未指定时根据输入文件名和时间生成 |

`--server-url` 和 `--model` 必须在每次 `parse` 命令中显式传入，即使使用了 `--config` 或设置了环境变量。

完整参数可通过 `minicpmvocr parse --help` 查看。

## 配置覆盖与默认行为

指定 `--config` 时，先读取所选配置文件，再应用命令行选项；`--set` 的优先级高于其他命令行选项。完整配置项见 [SDK 配置文件](../sdk/minicpmvocr/configs/minicpmvocr.yaml)。

省略 `--config` 时，快速开始配置使用 GPU 0 进行版面检测，开启自适应旋转（`upright`），识别上下文长度为 40960，识别请求并发数为 32，版面检测与识别重叠执行，关闭跨页表格合并。服务地址和模型名称没有默认值。

默认 Paddle 版面模型位于运行目录下的 `models/PP-DocLayoutV3_infer/`，自适应旋转使用的三个 Paddle 模型位于 `models/paddle_upright/`。文件完整时直接复用；缺失或不完整时自动下载。`OCR_ASSETS_DIR` 可更改模型所在的资产根目录，`OCR_UPRIGHT_DIR` 可指向已准备好的 `paddle_upright` 目录。运行环境缺少可选的 `paddleocr` 依赖时解析不会失败：记录告警后本次运行跳过摆正。

关闭旋转用 `--set upright.enabled=false`。

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

### 逐页返回结果

PDF 或多张图片不必等全部解析完：`stream_pages(cfg)` 是一个生成器，每解析完一页就产出这一页的结果，其余页继续在后台解析。`cfg` 与上面的例子相同：

```python
from minicpmvocr import stream_pages

for page in stream_pages(cfg):
    print(f"[{page['pages_done']}/{page['pages_total']}] {page['source']} 第 {page['page_index'] + 1} 页 {page['status']}")
    print(page["markdown"])
```

默认按完成的先后产出，不一定是页码顺序；`stream_pages(cfg, ordered=True)` 按输入顺序产出，先完成的页会等它前面的页。每个页事件的字段：

| 字段 | 说明 |
|---|---|
| `index` | 这一页在整次运行输入顺序中的位置，从 0 起 |
| `pages_done` / `pages_total` | 已产出的页数和总页数 |
| `source` / `source_id` | 这一页来自哪个输入文件，以及它在 `runtime/sources.json` 中的编号 |
| `page_index` | 这一页在所属文件中的页码，从 0 起；单图恒为 0 |
| `image_id` | 页标识，对应 `pages_json/<image_id>.json` |
| `status` / `error` | `ok`、`partial_failed`（部分块失败）或 `failed`；失败时 `error` 给出原因 |
| `markdown` | 这一页的 Markdown |
| `output_md` | 这一页的 Markdown 文件路径；Markdown 中的 `imgs/` 链接相对于该文件所在目录 |
| `page` | 与线上单页响应同构的完整结果（含 `ocr.blocks[]`）；页失败时为 `None` |

单页失败只体现在该页事件的 `status` 上，其余页照常产出；导致整次运行中止的错误会在已完成的页产出之后抛出。提前结束迭代不会取消运行，剩余页仍在后台解析并写入运行目录。生成器的返回值是运行摘要。也可以不用生成器，直接把回调传给 `pipelined_run(cfg, on_page=...)` 或 `infer_run(cfg, on_page=...)`，回调收到的事件相同。

逐页结果在跨页表格合并之前产出；开启 `pipeline.merge_cross_page_tables` 时，以运行结束后的 `assemble_document_markdown()` 为准。

逐页返回时前面的页优先：PDF 在后台按页码顺序渲染，前几页渲染好就开始版面检测，不等整份 PDF 渲染完；识别请求也按页依次发出，前面的页先完成。某一页渲染失败时只有该页报告 `failed`。不逐页返回时仍按整次运行“最长的块优先”发出，总耗时最短，但各页会集中在接近结束时才完成。因此逐页返回的总耗时略长：在单张 A100 上实测 18 到 45 页的 PDF 慢约 5% 到 13%。启用 `OCR_SHARED_CROP_POOL=1` 的共享线程池时不改变发出顺序。

#### 块级和逐字

`detail` 决定事件的粒度，默认 `"page"` 只有上面的页事件（`"event": "page"`）。`detail="block"` 在每页的页事件之前多两种事件，`detail="token"` 再多一种：

| 事件 | 何时产出 | 字段 |
|---|---|---|
| `layout` | 一页完成版面检测、识别开始之前 | `image_width`、`image_height`、`blocks[]`（按阅读顺序，每项有 `order`、`label`、`bbox`） |
| `block` | 一个块识别完成 | `order`、`label`、`bbox`、`status`、`content` |
| `delta` | 一个块解码的过程中（仅 `detail="token"`） | `order`、`text`（这一小段新文本） |

这三种事件都带 `index` 和 `image_id`，`layout` 和 `block` 还带 `source`、`source_id`、`page_index`。用 `image_id` 加 `order` 定位到块：

```python
for event in stream_pages(cfg, ordered=True, detail="token"):
    if event["event"] == "delta":
        print(event["text"], end="", flush=True)      # 逐字显示
    elif event["event"] == "block":
        replace_block(event["image_id"], event["order"], event["content"])
```

- `delta` 的文本是模型的原始输出；`block` 的 `content` 是整理后的结果（例如行内公式改写为 `$...$`、表格转成 HTML），应当用它替换这个块此前累计的 `delta` 文本。带 `"restart": true` 的 `delta` 表示这个块的请求被重发，之前累计的文本作废。
- `block` 的内容与最终页结果一致；只有表格里引用了本页图片的块，要等整页组装时才定稿，以页事件为准。
- 不需要识别的块（图片等）同样有 `block` 事件，`content` 为空，没有 `delta`。开启 `tts`（多候选重排）时结果要等候选比较完才确定，因此没有 `delta`，`block` 事件照常。
- 默认各页、各块并行识别，事件交错到达。`ordered=True` 时严格按阅读顺序：一页的 `layout`，然后逐块依次是它的 `delta` 和 `block`，最后是这一页的 `page`，再到下一页；轮到的块实时透传，还没轮到的先缓存。此时把 `delta` 的文本直接顺序拼接就是文档的阅读顺序。
- 逐字需要识别服务支持流式输出，`vllm`、`openai`、`llamacpp`、`ollama` 后端均按各自的流式接口请求。

命令行用 `--stream`，每解析完一页就向标准输出写一行 JSON（字段同上），最后一行是 `"event": "done"` 的运行摘要；加 `--stream-detail block` 或 `--stream-detail token` 输出块级或逐字的行：

```bash
minicpmvocr parse doc.pdf --stream \
  --device cuda:0 --server-url http://127.0.0.1:18499 --model minicpm-ocr
```

### 模型只加载一次

每次运行默认各自加载版面模型（以及开启摆正时的摆正模型），结束时卸载。同一个进程里要解析多批文件时，用 `load_models(cfg)` 先加载一次，再把返回值作为 `resources` 传给每次运行，后面的运行就不再等模型加载：

```python
from minicpmvocr import load_models, pipelined_run, stream_pages

def make_cfg(path):
    return load_config(str(config_path), overrides={**overrides, "input": {"file_path": path}})

with load_models(make_cfg("a.pdf")) as models:
    for path in ["a.pdf", "b.pdf", "c.pdf"]:
        for page in stream_pages(make_cfg(path), resources=models):   # 逐页返回
            print(page["markdown"])
    pipelined_run(make_cfg("d.pdf"), resources=models)                # 不逐页返回，同样复用
```

`load_models()` 读取 `layout`、`upright` 和 `pipeline.layout_workers`；复用它的各次运行应保持这些配置不变，否则以已加载的模型为准。一组已加载的模型同一时间只服务一次运行。离开 `with` 块或调用 `models.close()` 时卸载。

命令行每次调用都是一个新进程，模型无法留在内存里；一次调用里传入多个输入只加载一次。

多个输入时，`runtime/sources.json` 记录每个输入文件对应哪些页以及单图的文档范围；`pages_json/<image_id>.json` 与线上单页响应同构，`metadata` 里额外带 `source`（原文件路径）和 `image_id`。`assemble_documents_json(run_dir)` 返回与 `--json` 相同的按文件分组结果，整批状态为 `Success`、`Partial` 或 `Failed`。

单图的文档范围由 `pipeline.image_document_scope` 控制：默认 `collection` 把一次运行里的所有单图视作同一份文档的各页，跨页表格合并可以在图片之间生效；`file` 让每张单图各自成文档，等价于命令行 `--split-images`。PDF 始终按文件合并。单图输入也可以写在 `input.file_paths` 中，按给定顺序处理。

运行产物默认写入当前目录下的 `runs/<run_tag>/`，包括逐页 Markdown、结构化结果和运行记录。其中 `pages_json/<image_id>.json` 与线上 [文档解析 API](https://platform.modelbest.cn/console/docs/api/document-parse) 的单页响应同构：`metadata.page_index`（从 0 起）、`choices[0].message.content`（整页 Markdown）和 `ocr`（`image_width`、`image_height`、`blocks[]`、`rotation`）。块的 `status` 取值为 `ok`、`failed`、`skipped_no_vlm`、`skipped_seal`；`rotation.total_angle` 以逆时针为正，`applied=true` 时坐标基于摆正后的页面。`assemble_document_json(run_dir)` 返回与 `--json` 相同的整份结果，页间 Markdown 以空行连接。可通过配置项 `run.run_root` 或环境变量 `OCR_RUN_ROOT` 更改输出根目录。
