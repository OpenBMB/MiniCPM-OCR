from __future__ import annotations

import argparse
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
from .layouts.download import ensure_layout_model
from .pipeline import infer_run, parse_layout_run, pipelined_run, prepare_run
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
    p_parse.add_argument("path", nargs="?", metavar="INPUT", help="PDF or image to parse")
    p_parse.add_argument("--config", default="", help="Custom YAML config; default uses the bundled quickstart settings")
    p_parse.add_argument("--input", default="", help="Alias for the INPUT positional argument")
    p_parse.add_argument("-o", "--output", default="", help="Output Markdown path; default is stdout")
    p_parse.add_argument("--device", default="", help="Layout detection device, e.g. cuda:0 (quickstart default)")
    p_parse.add_argument("--layout-model", default="", metavar="DIR", help="Local PP-DocLayoutV3 inference model directory")
    p_parse.add_argument("--workers", type=_positive_int, default=None, metavar="N", help="Number of concurrent recognition requests (quickstart default: 32)")
    p_parse.add_argument("--stdout", action="store_true", help="Print markdown to stdout")
    p_parse.add_argument("--run-tag", default="", help="Optional run tag for this one-shot run")
    p_parse.add_argument("--no-merge-pages", action="store_true", help="Do not merge pages into a single markdown")
    p_parse.add_argument("--page-delimiter", default="\n\n<!-- page-break -->\n\n", help="Delimiter between pages when merging")
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
    input_path = Path(args.input).resolve()
    run_tag = args.run_tag or f"minicpmvocr_parse_{input_path.stem}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    return {
        "run": {
            "run_tag": run_tag,
            "mode": "oneshot_file",
        },
        "input": {
            "file_path": str(input_path),
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


def _quickstart_layout_model() -> str:
    configured = os.environ.get("OCR_LAYOUT_MODEL_DIR", "").strip()
    if configured:
        return str(Path(configured).expanduser().resolve())
    assets = Path(os.environ.get("OCR_ASSETS_DIR") or Path.cwd() / "models").expanduser().resolve()
    candidates = [assets / "PP-DocLayoutV3_infer", assets / "PP-DocLayoutV3"]
    return str(next((path for path in candidates if (path / PARAMS_FILENAME).is_file()), candidates[0]))


def _load_parse_config(args: argparse.Namespace) -> dict:
    if not args.server_url or any(not url.strip() for url in args.server_url):
        raise ValueError("--server-url URL is required and must not be empty")
    if not args.model.strip():
        raise ValueError("--model NAME is required and must not be empty")
    positional = args.path or ""
    if positional and args.input:
        raise ValueError("Specify INPUT or --input, not both")
    args.input = positional or args.input
    if not args.input:
        raise ValueError("An input PDF or image is required")
    if Path(args.input).is_dir():
        raise ValueError("INPUT must be a PDF or image file")
    input_path = Path(args.input)
    if not input_path.is_file():
        raise FileNotFoundError(f"Input file not found: {input_path}")
    if input_path.suffix.lower() not in SUPPORTED_INPUT_SUFFIXES:
        raise ValueError(f"Unsupported input file type: {input_path.suffix}")

    overrides = _build_parse_overrides(args)
    explicit_overrides = _build_engine_overrides(args)
    if not args.config:
        defaults = {
            "layout": {
                "model_dir": _quickstart_layout_model(),
                "device": os.environ.get("OCR_LAYOUT_DEVICE") or "cuda:0",
            },
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
            run_dir, load_prompt_map(cfg), merge_tables=True, delimiter=page_delimiter
        )
        if pages:
            return markdown, pages

    if merge_pages:
        return page_delimiter.join(page_texts), len(page_texts)
    return page_texts[0], 1


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
        try:
            cfg = _load_parse_config(args)
        except (ValueError, OSError) as exc:
            parser.error(str(exc))

        with redirect_stdout(sys.stderr):
            if bool(cfg["pipeline"].get("overlap_layout", False)):
                infer_summary = pipelined_run(cfg)
                layout_summary = {"overlapped": True, **infer_summary.get("pipelined", {})}
            else:
                layout_summary = parse_layout_run(cfg)
                prepare_run(cfg)
                infer_summary = infer_run(cfg)

        run_dir = Path(cfg["_meta"]["run_dir"])
        markdown, pages = _read_markdown_from_run(
            run_dir=run_dir,
            merge_pages=not args.no_merge_pages,
            page_delimiter=args.page_delimiter,
            cfg=cfg,
        )

        if args.stdout or not args.output:
            print(_absolute_image_links(markdown, run_dir))
            return 0

        output_path = Path(args.output).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        _sync_markdown_images(run_dir, markdown, output_path)
        output_path.write_text(markdown, encoding="utf-8")

        print(
            json.dumps(
                {
                    "command": "parse",
                    "input": str(Path(args.input).resolve()),
                    "output_md": str(output_path),
                    "pages": pages,
                    "run_dir": str(run_dir),
                    "layout_summary": layout_summary,
                    "infer_summary": infer_summary,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
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
        if bool(cfg["pipeline"].get("overlap_layout", False)):
            infer_summary = pipelined_run(cfg)
            layout_summary = {"overlapped": True, **infer_summary.get("pipelined", {})}
        else:
            layout_summary = parse_layout_run(cfg)
            prepare_run(cfg)
            infer_summary = infer_run(cfg)
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
