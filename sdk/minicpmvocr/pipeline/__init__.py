from __future__ import annotations

__all__ = [
    "assemble_document_json",
    "infer_run",
    "load_models",
    "parse_layout_run",
    "pipelined_run",
    "prepare_run",
    "stream_pages",
]


def __getattr__(name: str):
    if name == "assemble_document_json":
        from ._response import assemble_document_json
        return assemble_document_json
    if name == "load_models":
        from ._models import load_models
        return load_models
    if name == "stream_pages":
        from ._stream import stream_pages
        return stream_pages
    if name == "pipelined_run":
        from .overlapped import pipelined_run
        return pipelined_run
    if name in {"infer_run", "parse_layout_run", "prepare_run"}:
        from .staged import infer_run, parse_layout_run, prepare_run
        return {
            "infer_run": infer_run,
            "parse_layout_run": parse_layout_run,
            "prepare_run": prepare_run,
        }[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
