'MiniCPM-OCR document parsing SDK.'
from __future__ import annotations

from typing import TYPE_CHECKING

from ._version import __version__


_EXPORTS = {

    "DEFAULT_CONFIG": "minicpmvocr.config",
    "load_config": "minicpmvocr.config",

    "parse_layout_run": "minicpmvocr.pipeline",
    "prepare_run": "minicpmvocr.pipeline",
    "infer_run": "minicpmvocr.pipeline",
    "pipelined_run": "minicpmvocr.pipeline",

    "DEFAULT_PROMPT_MAP": "minicpmvocr.prompts",
    "load_prompt_map": "minicpmvocr.prompts",
    "get_element_cfg": "minicpmvocr.prompts",

    "create_backend": "minicpmvocr.backends",
    "create_layout_detector": "minicpmvocr.layouts",

    "assemble_markdown": "minicpmvocr.postprocess",
    "convert_otsl_to_html": "minicpmvocr.postprocess",
    "apply_cross_page_merge": "minicpmvocr.postprocess",
    "assemble_document_markdown": "minicpmvocr.postprocess",

    "UprightCorrector": "minicpmvocr.pipeline.upright",
}

__all__ = ["__version__", *sorted(_EXPORTS)]


def __getattr__(name: str):
    module_path = _EXPORTS.get(name)
    if module_path is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    from importlib import import_module

    value = getattr(import_module(module_path), name)
    globals()[name] = value
    return value


def __dir__():
    return sorted(__all__)


if TYPE_CHECKING:
    from .backends import create_backend
    from .config import DEFAULT_CONFIG, load_config
    from .layouts import create_layout_detector
    from .postprocess import (
        apply_cross_page_merge,
        assemble_document_markdown,
        assemble_markdown,
        convert_otsl_to_html,
    )
    from .pipeline import infer_run, parse_layout_run, pipelined_run, prepare_run
    from .prompts import DEFAULT_PROMPT_MAP, get_element_cfg, load_prompt_map
    from .pipeline.upright import UprightCorrector
