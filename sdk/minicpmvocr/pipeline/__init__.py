from __future__ import annotations

__all__ = [
    "infer_run",
    "parse_layout_run",
    "pipelined_run",
    "prepare_run",
]


def __getattr__(name: str):
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
