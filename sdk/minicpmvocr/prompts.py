from __future__ import annotations

import copy
import json
import logging
from pathlib import Path
from typing import Dict

import yaml

from .postprocess.markdown import DEFAULT_MARKDOWN, validate_markdown

LOGGER = logging.getLogger(__name__)

DEFAULT_PROMPT_MAP = {
    "default": {
        "prompt": "Text Recognition:",
        "max_new_tokens": 8192,
        "output_format": "text",
        "resize_min_side": None,
        "slice_nums": 9,
    },
    "element_prompts": {
        "text": {"prompt": "Text Recognition:", "max_new_tokens": 4096, "output_format": "text"},
        "content": {"prompt": "Text Recognition:", "max_new_tokens": 4096, "output_format": "text"},
        "abstract": {"prompt": "Text Recognition:", "max_new_tokens": 4096, "output_format": "text"},
        "reference": {"prompt": "Text Recognition:", "max_new_tokens": 2048, "output_format": "text"},
        "reference_content": {"prompt": "Text Recognition:", "max_new_tokens": 2048, "output_format": "text"},
        "vertical_text": {"prompt": "Text Recognition:", "max_new_tokens": 2048, "output_format": "text"},
        "vision_footnote": {"prompt": "Text Recognition:", "max_new_tokens": 1024, "output_format": "text"},
        "algorithm": {"prompt": "Text Recognition:", "max_new_tokens": 4096, "output_format": "text"},
        "doc_title": {"prompt": "Text Recognition:", "max_new_tokens": 512, "output_format": "text"},
        "paragraph_title": {"prompt": "Text Recognition:", "max_new_tokens": 512, "output_format": "text"},
        "figure_title": {"prompt": "Text Recognition:", "max_new_tokens": 512, "output_format": "text"},
        "table": {"prompt": "Table Recognition:", "max_new_tokens": 8192, "output_format": "html"},


        "display_formula": {"prompt": "Formula Recognition:", "max_new_tokens": 2048, "output_format": "latex"},
        "inline_formula": {"prompt": "Text Recognition:", "max_new_tokens": 1024, "output_format": "latex"},
        "formula_number": {"prompt": "Text Recognition:", "max_new_tokens": 256, "output_format": "text"},
        "header": {"prompt": "Text Recognition:", "max_new_tokens": 512, "output_format": "text"},
        "footer": {"prompt": "Text Recognition:", "max_new_tokens": 512, "output_format": "text"},
        "footnote": {"prompt": "Text Recognition:", "max_new_tokens": 1024, "output_format": "text"},
        "aside_text": {"prompt": "Text Recognition:", "max_new_tokens": 1024, "output_format": "text"},
        "number": {"prompt": "Text Recognition:", "max_new_tokens": 256, "output_format": "text"},


        "chart": {"prompt": "Chart to Table:", "max_new_tokens": 4096, "output_format": "html"},
        "seal": {"prompt": "Seal Recognition:", "max_new_tokens": 256, "output_format": "text"},


    },
    # Markdown assembly is run configuration (config `markdown:`); the copy here serves callers without a config.
    "markdown_assembly": copy.deepcopy(DEFAULT_MARKDOWN),
}


_NESTED_PROMPT_MAP_SECTIONS = ("markdown_assembly", "element_prompts")


def _merge_prompt_map_section(base: Dict, external: Dict) -> None:
    'Merge an external prompt-map section into the default instead of replacing it.'
    for key, value in external.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            base[key].update(value)
        else:
            base[key] = value


def load_prompt_map(cfg: Dict) -> Dict:
    'The effective prompt map for a run; its markdown_assembly comes from the config `markdown:` section.'
    prompt_map_path = cfg["prompt"].get("prompt_map", "")
    prompt_map = json.loads(json.dumps(DEFAULT_PROMPT_MAP))
    _merge_prompt_map_section(prompt_map["markdown_assembly"], cfg.get("markdown") or {})
    if prompt_map_path and Path(prompt_map_path).is_file():
        with Path(prompt_map_path).open("r", encoding="utf-8") as f:
            external = yaml.safe_load(f) or {}
        if isinstance(external.get("markdown_assembly"), dict):
            # Deprecated: older prompt maps carried the Markdown settings; they still win over the config.
            LOGGER.warning("prompt map %s sets markdown_assembly; move these settings to the config `markdown:` section",
                           prompt_map_path)
        for section in _NESTED_PROMPT_MAP_SECTIONS:
            if isinstance(external.get(section), dict):
                _merge_prompt_map_section(prompt_map[section], external.pop(section))
        prompt_map.update(external)
    prompt_map = apply_prompt_override_mode(prompt_map, cfg["prompt"].get("override_mode", "legacy"))
    from .layouts.base import resolve_skip_vlm_labels
    prompt_map = apply_skip_vlm_labels(prompt_map, resolve_skip_vlm_labels(cfg.get("layout")))
    validate_markdown(prompt_map["markdown_assembly"])
    return prompt_map


def get_element_cfg(prompt_map: Dict, label: str) -> Dict | None:
    "One label's recipe, or None when the label is skipped."
    default = prompt_map.get("default", {})
    elem = prompt_map.get("element_prompts", {}).get(label, {})
    if elem.get("skip", False):
        return None
    return {
        "prompt": elem.get("prompt", default.get("prompt", "Text Recognition:")),
        "max_new_tokens": elem.get("max_new_tokens", default.get("max_new_tokens", 4096)),
        "output_format": elem.get("output_format", default.get("output_format", "text")),
        "resize_min_side": elem.get("resize_min_side", default.get("resize_min_side", None)),
        "slice_nums": elem.get("slice_nums", default.get("slice_nums", 9)),
    }


def apply_skip_vlm_labels(prompt_map: dict, skip_labels) -> dict:
    'Mark `skip_labels` as skip in the prompt map.'
    if not skip_labels:
        return prompt_map
    elems = prompt_map.setdefault("element_prompts", {})
    for label in skip_labels:
        elems.setdefault(label, {})["skip"] = True
    return prompt_map


def apply_prompt_override_mode(prompt_map: dict, mode: str) -> dict:
    normalized = (mode or "legacy").strip().lower()
    if normalized in ("legacy", "none"):
        return prompt_map
    if normalized in ("display_formula_v3", "formula_recognition"):
        elems = prompt_map.setdefault("element_prompts", {})
        elems.setdefault("display_formula", {})["prompt"] = "Formula Recognition:"
        return prompt_map
    raise ValueError(f"Unknown prompt override mode: {mode}")
