from __future__ import annotations

import json
from pathlib import Path
from typing import Dict

import yaml

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
    "markdown_assembly": {
        "ignore_labels": ["number", "footnote", "header", "footer", "aside_text"],
        "title_format": {"doc_title": "# {content}", "paragraph_title": "## {content}", "figure_title": "*{content}*"},
        "formula_format": {"display_formula": "$$\n{content}\n$$", "inline_formula": "${content}$"},
        "table_format": "{content}",
        "image_format": "![image]()",
        "chart_format": "{content}",
        "seal_format": "{content}",
    },
}


def load_prompt_map(cfg: Dict) -> Dict:
    'The effective prompt map for a run.'
    prompt_map_path = cfg["prompt"].get("prompt_map", "")
    prompt_map = json.loads(json.dumps(DEFAULT_PROMPT_MAP))
    if prompt_map_path and Path(prompt_map_path).is_file():
        with Path(prompt_map_path).open("r", encoding="utf-8") as f:
            external = yaml.safe_load(f) or {}
        prompt_map.update(external)
    prompt_map = apply_prompt_override_mode(prompt_map, cfg["prompt"].get("override_mode", "legacy"))
    from .layouts.base import resolve_skip_vlm_labels
    return apply_skip_vlm_labels(prompt_map, resolve_skip_vlm_labels(cfg.get("layout")))


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
