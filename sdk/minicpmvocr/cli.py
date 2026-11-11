from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shutil
import sys
from contextlib import redirect_stdout
from datetime import datetime
from pathlib import Path

import yaml

from .backends import BACKEND_ALIASES, list_backends
from .config import _deep_merge, load_config
from .constants import PARAMS_FILENAME, SUPPORTED_INPUT_SUFFIXES
from .layouts import LAYOUT_ALIASES, list_layout_providers, normalize_layout_provider
from .layouts.download import ensure_layout_model, ensure_upright_models
from .pipeline import infer_run, parse_layout_run, prepare_run
from .pipeline._sources import read_sources
from .pipeline._stream import InputOrder, run_pages
from ._utils import read_jsonl


def _add_engine_args(p: argparse.ArgumentParser, require_connection: bool = False) -> None:
    p.add_argument(
        "--backend",
        default="",
        help="Override engine.type: %s" % " | ".join(list_backends()),
    )
    p.add_argument(
        "--server-url",
        action="append",
        default=[],
        required=require_connection,
        metavar="URL",
        help="Override the engine endpoint; repeat for a server pool",
    )
    p.add_argument("--model", default="", required=require_connection, help="Served model name / ollama tag")
    p.add_argument(
        "--layout",
        default="",
        help="Override layout.provider: %s" % " | ".join(list_layout_providers()),
    )
    p.add_argument(
        "--set",
        action="append",
        default=[],
        metavar="KEY=VALUE",
        dest="set_overrides",
        help="Override any config field by dotted path, e.g. --set engine.num_ctx=16384",
    )


def _positive_int(value: str) -> int:
    result = int(value)
    if result < 1:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return result


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="minicpmvocr", description="MiniCPMV-OCR SDK pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    for name in ("parse-layout", "prepare", "infer", "run", "show-config"):
        p = sub.add_parser(name)
        p.add_argument("--config", required=True, help="Path to pipeline YAML config")
        _add_engine_args(p)

    p_parse = sub.add_parser(
        "parse",
        help="Parse a PDF or image into Markdown",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Example:\n  minicpmvocr parse doc.pdf -o doc.md --device cuda:0 "
               "--server-url http://127.0.0.1:18499 --model minicpm-ocr",
    )
    p_parse.add_argument(
        "path", nargs="*", metavar="INPUT",
        help="PDF or image to parse; repeat for several inputs, or pass one directory",
    )
    p_parse.add_argument("--config", default="", help="Custom YAML config; default uses the bundled quickstart settings")
    p_parse.add_argument(
        "--input", action="append", default=[], metavar="FILE",
        help="Alias for the INPUT positional argument; repeat for several inputs")
    p_parse.add_argument("-o", "--output", default="", help="Output Markdown path; default is stdout")
    p_parse.add_argument("--device", default="", help="Layout detection device, e.g. cuda:0 (quickstart default)")
    p_parse.add_argument("--layout-model", default="", metavar="DIR", help="Local PP-DocLayoutV3 inference model directory")
    p_parse.add_argument("--workers", type=_positive_int, default=None, metavar="N", help="Number of concurrent recognition requests (quickstart default: 32)")
    p_parse.add_argument("--stdout", action="store_true", help="Print markdown to stdout")
    p_parse.add_argument("--run-tag", default="", help="Optional run tag for this one-shot run")
    p_parse.add_argument("--no-merge-pages", action="store_true", help="Do not merge pages into a single markdown")
    p_parse.add_argument(
        "--split-images", action="store_true",
        help="Treat each standalone image as its own document instead of pages of one collection "
             "(sets pipeline.image_document_scope=file); PDFs are always one document per file")
    p_parse.add_argument(
        "--json", nargs="?", const="", default=None, metavar="PATH",
        help="Also write JSON in the online document-parse shape (pages[] + markdown); "
             "PATH is a file for one input, a directory for several, and omitted writes "
             "it next to the Markdown")
    p_parse.add_argument("--page-delimiter", default="\n\n<!-- page-break -->\n\n", help="Delimiter between pages when merging")
    p_parse.add_argument(
        "--stream", action="store_const", const="completed", default="", dest="stream",
        help="Write each page to standard output as one JSON line as soon as it is parsed, in "
             "the order pages finish, then one closing line with the run summary. Files asked "
             "for with -o / --json are still written at the end")
    p_parse.add_argument(
        "--stream-ordered", action="store_const", const="ordered", default="", dest="stream",
        help="Like --stream, but in reading order: whatever is ahead of its turn waits")
    p_parse.add_argument(
        "--stream-detail", choices=["page", "block", "token"], default="page", metavar="LEVEL",
        help="How fine the --stream lines are. page (default): one line per finished page. "
             "block: also one line when a page is laid out and one per recognized block. "
             "token: also the text of each block while it is being decoded")
    _add_engine_args(p_parse, require_connection=True)

    sub.add_parser("list-backends", help="List pluggable inference backends and layout providers")


    sub.add_parser(
        "serve-layout",
        add_help=False,
        help="Run the standalone PP-DocLayoutV3 detection server (--help for its flags)",
    )

    return parser


class _OverrideLoader(yaml.SafeLoader):


    yaml_implicit_resolvers = {
        ch: [
            (tag, regexp)
            for tag, regexp in resolvers
            if tag
            not in (
                "tag:yaml.org,2002:timestamp",
                "tag:yaml.org,2002:bool",
                "tag:yaml.org,2002:int",
            )
        ]
        for ch, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
    }


_OverrideLoader.add_implicit_resolver(
    "tag:yaml.org,2002:bool",
    re.compile(r"^(?:true|True|TRUE|false|False|FALSE)$"),
    list("tTfF"),
)
_OverrideLoader.add_implicit_resolver(
    "tag:yaml.org,2002:int",
    re.compile(r"^[-+]?(?:0|[1-9][0-9]*)$|^0o[0-7]+$|^0x[0-9a-fA-F]+$"),
    list("-+0123456789"),
)


def parse_override_value(raw: str):
    'Parse one `--set` right-hand side.'
    return yaml.load(raw, Loader=_OverrideLoader)


def _deep_set(target: dict, dotted_key: str, value) -> None:
    parts = [p for p in dotted_key.split(".") if p]
    if not parts:
        raise ValueError("Empty override key")
    node = target
    for part in parts[:-1]:
        node = node.setdefault(part, {})
        if not isinstance(node, dict):
            raise ValueError("Cannot override nested key under scalar: %s" % dotted_key)
    node[parts[-1]] = value


def _build_engine_overrides(args: argparse.Namespace) -> dict:
    overrides: dict = {}

    backend = getattr(args, "backend", "")
    if backend:
        _deep_set(overrides, "engine.type", backend)

    server_urls = [u.strip() for u in getattr(args, "server_url", []) or [] if u.strip()]
    if server_urls:

        _deep_set(overrides, "engine.server_url", "")
        _deep_set(overrides, "engine.server_urls", server_urls)

    model = getattr(args, "model", "")
    if model:
        _deep_set(overrides, "engine.model_name", model)

    layout = getattr(args, "layout", "")
    if layout:
        _deep_set(overrides, "layout.provider", layout)

    device = getattr(args, "device", "")
    if device:
        _deep_set(overrides, "layout.device", device)

    layout_model = getattr(args, "layout_model", "")
    if layout_model:
        _deep_set(overrides, "layout.model_dir", str(Path(layout_model).expanduser().resolve()))

    workers = getattr(args, "workers", None)
    if workers is not None:
        _deep_set(overrides, "pipeline.max_workers", workers)

    for item in getattr(args, "set_overrides", []) or []:
        if "=" not in item:
            raise ValueError("--set expects KEY=VALUE, got: %s" % item)
        key, raw_value = item.split("=", 1)
        _deep_set(overrides, key.strip(), parse_override_value(raw_value))

    return overrides


def _build_parse_overrides(args: argparse.Namespace) -> dict:
    inputs = args.inputs
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    if len(inputs) == 1:
        default_tag = f"minicpmvocr_parse_{inputs[0].stem}_{stamp}"
        input_block = {"file_path": str(inputs[0]), "file_paths": []}
    else:
        default_tag = f"minicpmvocr_parse_{len(inputs)}files_{stamp}"
        input_block = {"file_path": "", "file_paths": [str(p) for p in inputs]}
    overrides = {
        "run": {
            "run_tag": args.run_tag or default_tag,
            "mode": "oneshot_file",
        },
        "input": {
            **input_block,
            "manifest": "",
            "image_dir": "",
            "files_dir": "",
            "limit": 0,
        },
        "layout": {
            "enabled": True,
        },
        "logging": {

            "progress_log_every": 10**9,
        },
    }
    if getattr(args, "split_images", False):
        overrides["pipeline"] = {"image_document_scope": "file"}
    return overrides


def _expand_directory(path: Path) -> list:
    'Top-level supported files of a directory, in name order. Directories do not recurse.'
    files = [
        p for p in sorted(path.iterdir())
        if p.is_file() and p.suffix.lower() in SUPPORTED_INPUT_SUFFIXES
    ]
    if not files:
        raise ValueError(f"Directory has no PDF or image files: {path}")
    return files


def _resolve_parse_inputs(args: argparse.Namespace) -> list:
    'Every input file, in the order given; directories expand to their top-level files.'
    requested = [Path(p) for p in (args.path or [])] + [Path(p) for p in (args.input or [])]
    if not requested:
        raise ValueError("An input PDF or image is required")
    resolved: list = []
    seen = set()
    for item in requested:
        if item.is_dir():
            candidates = _expand_directory(item)
        elif not item.exists():
            raise FileNotFoundError(f"Input file not found: {item}")
        elif item.suffix.lower() not in SUPPORTED_INPUT_SUFFIXES:
            raise ValueError(f"Unsupported input file type: {item.suffix}")
        else:
            candidates = [item]
        for candidate in candidates:
            key = str(candidate.resolve())
            if key in seen:
                continue
            seen.add(key)
            resolved.append(candidate.resolve())
    return resolved


def _quickstart_layout_model() -> str:
    configured = os.environ.get("OCR_LAYOUT_MODEL_DIR", "").strip()
    if configured:
        return str(Path(configured).expanduser().resolve())
    assets = Path(os.environ.get("OCR_ASSETS_DIR") or Path.cwd() / "models").expanduser().resolve()
    candidates = [assets / "PP-DocLayoutV3_infer", assets / "PP-DocLayoutV3"]
    return str(next((path for path in candidates if (path / PARAMS_FILENAME).is_file()), candidates[0]))


def _quickstart_upright_root() -> str:
    configured = os.environ.get("OCR_UPRIGHT_DIR", "").strip()
    if configured:
        return str(Path(configured).expanduser().resolve())
    assets = Path(os.environ.get("OCR_ASSETS_DIR") or Path.cwd() / "models").expanduser().resolve()
    return str(assets / "paddle_upright")


def _quickstart_upright_dirs() -> dict:
    root = Path(_quickstart_upright_root())
    return {
        "model_dir": str(root / "PP-LCNet_x1_0_doc_ori"),
        "det_model_dir": str(root / "PP-OCRv5_mobile_det"),
        "textline_model_dir": str(root / "PP-LCNet_x1_0_textline_ori"),
    }


def _load_parse_config(args: argparse.Namespace) -> dict:
    if not args.server_url or any(not url.strip() for url in args.server_url):
        raise ValueError("--server-url URL is required and must not be empty")
    if not args.model.strip():
        raise ValueError("--model NAME is required and must not be empty")
    args.inputs = _resolve_parse_inputs(args)

    overrides = _build_parse_overrides(args)
    explicit_overrides = _build_engine_overrides(args)
    if not args.config:
        defaults = {
            "layout": {
                "model_dir": _quickstart_layout_model(),
                "device": os.environ.get("OCR_LAYOUT_DEVICE") or "cuda:0",
            },
            "upright": _quickstart_upright_dirs(),
            "engine": {"max_model_len": 40960},
            "pipeline": {"overlap_layout": True},
        }
        overrides = _deep_merge(defaults, overrides)
    overrides = _deep_merge(overrides, explicit_overrides)
    explicit_layout = explicit_overrides.get("layout") or {}
    if (
        not args.config
        and "model_dir" not in explicit_layout
        and not os.environ.get("OCR_LAYOUT_MODEL_DIR", "").strip()
        and normalize_layout_provider(overrides["layout"].get("provider", "ppdoclayout3_paddlex")) == "ppdoclayout3_paddlex"
    ):
        ensure_layout_model(Path(overrides["layout"]["model_dir"]))
    explicit_upright = explicit_overrides.get("upright") or {}
    upright_models_managed = (
        "model_dir" in explicit_upright
        or "det_model_dir" in explicit_upright
        or "textline_model_dir" in explicit_upright
        or bool(os.environ.get("OCR_UPRIGHT_DIR", "").strip())
    )
    if (
        not args.config
        and not upright_models_managed
        and overrides.get("upright", {}).get("enabled") is not False
        # Without paddleocr the run skips rotation; the models would go unused.
        and importlib.util.find_spec("paddleocr") is not None
    ):
        ensure_upright_models(Path(_quickstart_upright_root()))
    config = args.config or str(Path(__file__).parent / "configs" / "minicpmvocr.yaml")
    try:
        return load_config(config, overrides=overrides)
    except FileNotFoundError as exc:
        if "layout.model_dir" in str(exc):
            raise FileNotFoundError(
                f"{exc}. Place PP-DocLayoutV3 in ./models/PP-DocLayoutV3_infer, "
                "or set --layout-model DIR / OCR_LAYOUT_MODEL_DIR."
            ) from exc
        raise


_IMAGE_LINK_RE = re.compile(r"(!\[[^\]]*\]\()(imgs/[^)\s]+)\)")


def _sync_markdown_images(run_dir: Path, markdown: str, output_path: Path) -> None:
    'Copy the run images that relative imgs/ links point at next to the written markdown.'
    if not _IMAGE_LINK_RE.search(markdown):
        return
    src_imgs = run_dir / "output" / "imgs"
    if not src_imgs.is_dir():
        return
    if output_path.parent.resolve() == (run_dir / "output").resolve():
        return
    # Merge into an existing imgs/ instead of replacing it: it may hold the user's own files.
    shutil.copytree(src_imgs, output_path.parent / "imgs", dirs_exist_ok=True)


def _absolute_image_links(markdown: str, run_dir: Path) -> str:
    'Point imgs/ links at the run directory, for markdown that has no directory of its own (stdout).'
    root = (run_dir / "output").resolve().as_posix()

    def _target(match: re.Match) -> str:
        path = "%s/%s" % (root, match.group(2))
        return match.group(1) + ("<%s>" % path if re.search(r"\s", path) else path) + ")"

    return _IMAGE_LINK_RE.sub(_target, markdown)


def _read_markdown_from_run(
    run_dir: Path, merge_pages: bool, page_delimiter: str, cfg: dict | None = None
) -> tuple[str, int]:
    tasks = read_jsonl(run_dir / "runtime" / "page_tasks.jsonl")
    if not tasks:
        raise RuntimeError("No page tasks found in run. parse-layout/prepare may have failed.")

    md_root = run_dir / "output"
    page_texts = []
    missing = []
    for task in tasks:
        image_id = task["image_id"]
        md_path = md_root / f"{image_id}.md"
        if not md_path.exists():
            missing.append(str(md_path))
            continue
        page_texts.append(md_path.read_text(encoding="utf-8"))

    if missing:
        raise RuntimeError("Missing markdown outputs: %s" % ", ".join(missing[:5]))

    if not merge_pages and len(page_texts) > 1:
        raise RuntimeError("Multiple pages generated; remove --no-merge-pages or parse a single-page input.")


    if (
        merge_pages
        and cfg is not None
        and bool((cfg.get("pipeline") or {}).get("merge_cross_page_tables", False))
    ):
        from .postprocess.crosspage import assemble_document_markdown
        from .prompts import load_prompt_map

        markdown, pages, _ = assemble_document_markdown(
            run_dir, load_prompt_map(cfg), merge_tables=True, delimiter=page_delimiter, cfg=cfg
        )
        if pages:
            return markdown, pages

    if merge_pages:
        return page_delimiter.join(page_texts), len(page_texts)
    return page_texts[0], 1


def _output_names(sources: list) -> dict:
    'source_id -> file stem; a stem shared by two inputs gets its source_id in front.'
    stems = [Path(source.get("path") or source.get("source_id") or "input").stem for source in sources]
    shared = {stem for stem in stems if stems.count(stem) > 1}
    names = {}
    for source, stem in zip(sources, stems):
        prefix = f"{source.get('source_id', '')}_" if stem in shared else ""
        names[source.get("source_id", "")] = f"{prefix}{stem}"
    return names


def _parse_many(args: argparse.Namespace, cfg: dict, run_dir: Path,
                layout_summary: dict, infer_summary: dict) -> int:
    """Write one Markdown (and with --json one JSON) per input file.

    With --stream the pages have already been written to standard output, so
    -o is optional and leaving it out writes no files.
    """
    if args.stdout:
        raise ValueError("--stdout writes a single document; use -o DIR for several inputs")
    if not args.output and not args.stream:
        raise ValueError("Several inputs need -o DIR to hold one result per input")
    output_dir = Path(args.output).resolve() if args.output else None
    if output_dir is not None:
        if output_dir.exists() and not output_dir.is_dir():
            raise ValueError(f"-o must be a directory for several inputs: {output_dir}")
        output_dir.mkdir(parents=True, exist_ok=True)

    from .pipeline._response import assemble_documents_json
    from .postprocess.crosspage import assemble_documents_markdown
    from .prompts import load_prompt_map

    document = assemble_documents_json(run_dir)
    markdowns = assemble_documents_markdown(
        run_dir, load_prompt_map(cfg),
        merge_tables=bool(cfg["pipeline"].get("merge_cross_page_tables", False)),
        delimiter=args.page_delimiter, cfg=cfg,
    )
    sources = (read_sources(run_dir) or {}).get("sources") or []
    names = _output_names(sources)

    outputs = []
    for entry in document["files"]:
        source_id = entry["source_id"]
        name = names.get(source_id, source_id or "input")
        record = {
            "source_id": source_id,
            "input": entry["path"],
            "status": entry["status"],
            "pages": f"{entry['pages_done']}/{entry['pages_total']}",
        }
        if output_dir is None:
            outputs.append(record)
            continue
        if args.no_merge_pages and entry["pages_total"] > 1:
            raise ValueError(
                f"{entry['path']}: {entry['pages_total']} pages; remove --no-merge-pages "
                "or parse that input on its own")
        markdown_path = output_dir / f"{name}.md"
        markdown = markdowns.get(source_id, {}).get("markdown", entry["markdown"])
        _sync_markdown_images(run_dir, markdown, markdown_path)
        markdown_path.write_text(markdown, encoding="utf-8")
        record["output_md"] = str(markdown_path)
        if args.json is not None:
            json_path = output_dir / f"{name}.json"
            json_path.write_text(
                json.dumps(entry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            record["output_json"] = str(json_path)
        outputs.append(record)

    _print_parse_summary(args, {
        "command": "parse",
        "status": document["status"],
        "inputs": len(args.inputs),
        "outputs": outputs,
        "run_dir": str(run_dir),
        "layout_summary": layout_summary,
        "infer_summary": infer_summary,
    })
    failed = [o for o in outputs if o["status"] == "Failed"]
    return 1 if len(failed) == len(outputs) else 0


def _page_stream(args: argparse.Namespace):
    'The on_page callback for --stream, or None; it has a flush() when it holds pages back.'
    if not args.stream:
        return None
    # Captured now: the run itself has standard output pointed at standard error.
    out = sys.stdout

    def _write(event: dict) -> None:
        out.write(json.dumps(event, ensure_ascii=False) + "\n")
        out.flush()

    return InputOrder(_write) if args.stream == "ordered" else _write


def _print_parse_summary(args: argparse.Namespace, summary: dict) -> None:
    'The closing report: pretty JSON, or with --stream one more line of the stream.'
    if args.stream:
        print(json.dumps({"event": "done", **summary}, ensure_ascii=False), flush=True)
    else:
        print(json.dumps(summary, ensure_ascii=False, indent=2))


def main() -> int:


    argv = sys.argv[1:]
    if argv and argv[0] == "serve-layout":


        from .layouts.server_app import main as serve_layout_main

        return serve_layout_main(argv[1:])

    parser = _build_parser()
    args = parser.parse_args()

    if args.command == "list-backends":
        print(
            json.dumps(
                {
                    "engine": {"backends": list_backends(), "aliases": BACKEND_ALIASES},
                    "layout": {"providers": list_layout_providers(), "aliases": LAYOUT_ALIASES},
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    if args.command == "parse":
        if args.stream and args.stdout:
            parser.error("--stream already writes to standard output; drop --stdout")
        if args.stream_detail != "page" and not args.stream:
            parser.error("--stream-detail needs --stream or --stream-ordered")
        try:
            cfg = _load_parse_config(args)
        except (ValueError, OSError) as exc:
            parser.error(str(exc))

        on_page = _page_stream(args)
        with redirect_stdout(sys.stderr):
            layout_summary, infer_summary = run_pages(cfg, on_page, detail=args.stream_detail)
        if isinstance(on_page, InputOrder):
            on_page.flush()

        run_dir = Path(cfg["_meta"]["run_dir"])
        if len(args.inputs) > 1:
            try:
                return _parse_many(args, cfg, run_dir, layout_summary, infer_summary)
            except (ValueError, OSError) as exc:
                parser.error(str(exc))

        if args.stream and not args.output and args.json is None:
            # Every page is already on standard output; there is no file to assemble.
            _print_parse_summary(args, {
                "command": "parse",
                "input": str(args.inputs[0]),
                "pages": int((infer_summary.get("counts") or {}).get("planned", 0)),
                "run_dir": str(run_dir),
                "layout_summary": layout_summary,
                "infer_summary": infer_summary,
            })
            return 0

        markdown, pages = _read_markdown_from_run(
            run_dir=run_dir,
            merge_pages=not args.no_merge_pages,
            page_delimiter=args.page_delimiter,
            cfg=cfg,
        )

        json_path = None
        if args.json is not None:
            from .pipeline._response import assemble_document_json

            if not args.json and not args.output:
                raise ValueError("--json needs a PATH when the Markdown goes to standard output")
            target = Path(args.json).resolve() if args.json else None
            if target is not None and target.is_dir():
                target = target / f"{Path(args.output).stem}.json"
            elif target is None:
                target = Path(args.output).with_suffix(".json").resolve()
            json_path = target
            json_path.parent.mkdir(parents=True, exist_ok=True)
            json_path.write_text(
                json.dumps(assemble_document_json(run_dir), ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

        if not args.stream and (args.stdout or not args.output):
            print(_absolute_image_links(markdown, run_dir))
            return 0

        output_path = None
        if args.output:
            output_path = Path(args.output).resolve()
            output_path.parent.mkdir(parents=True, exist_ok=True)
            _sync_markdown_images(run_dir, markdown, output_path)
            output_path.write_text(markdown, encoding="utf-8")

        _print_parse_summary(args, {
            "command": "parse",
            "input": str(args.inputs[0]),
            **({"output_md": str(output_path)} if output_path else {}),
            **({"output_json": str(json_path)} if json_path else {}),
            "pages": pages,
            "run_dir": str(run_dir),
            "layout_summary": layout_summary,
            "infer_summary": infer_summary,
        })
        return 0

    cfg = load_config(args.config, overrides=_build_engine_overrides(args))

    if args.command == "show-config":
        print(json.dumps(cfg, ensure_ascii=False, indent=2))
        return 0

    if args.command == "parse-layout":
        summary = parse_layout_run(cfg)
        print(json.dumps({"command": "parse-layout", "run_dir": cfg["_meta"]["run_dir"], "summary": summary}, ensure_ascii=False, indent=2))
        return 0

    if args.command == "prepare":
        meta = prepare_run(cfg)
        print(json.dumps({"command": "prepare", "run_dir": cfg["_meta"]["run_dir"], "planned_pages": meta["counts"]["planned_pages"]}, ensure_ascii=False, indent=2))
        return 0

    if args.command == "infer":
        summary = infer_run(cfg)
        print(json.dumps({"command": "infer", "run_dir": cfg["_meta"]["run_dir"], "summary": summary}, ensure_ascii=False, indent=2))
        return 0

    if args.command == "run":
        layout_summary, infer_summary = run_pages(cfg)
        print(
            json.dumps(
                {
                    "command": "run",
                    "run_dir": cfg["_meta"]["run_dir"],
                    "layout_summary": layout_summary,
                    "infer_summary": infer_summary,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
