from __future__ import annotations

import re
from typing import Dict, List

from ..constants import OTSL_LABELS
from ..postprocess.markdown import TEXT_BLOCK_LABELS, VERBATIM_LABELS, split_text_block

INLINE_LATEX_RE = re.compile(r"\\\((.+?)\\\)")
DISPLAY_BRACKET_SEP_RE = re.compile(re.escape(r"\]") + r"\s*" + re.escape(r"\["))


def _normalize_crop_text(text: str, label: str) -> str:
    if text is None:
        return ""
    if label in VERBATIM_LABELS:
        # Code / terminal output: keep indentation and line structure, as PaddleOCR-VL does.
        return INLINE_LATEX_RE.sub(lambda m: f"${m.group(1).strip()}$", text.strip("\n"))
    # Repetition loops are cut once, in postprocess_content (PaddleOCR-VL's truncate_repetitive_content).
    # No word-level cut here: it took legitimately repeated matrix rows and table cells for a loop.
    out = text.strip()
    if label != "display_formula":
        out = INLINE_LATEX_RE.sub(lambda m: f"${m.group(1).strip()}$", out)
    else:
        out = DISPLAY_BRACKET_SEP_RE.sub("$$   $$", out)
        out = out.replace("\\[", "").replace("\\]", "")
    out = re.sub(r"[ \t]+", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    if label in OTSL_LABELS:
        from minicpmvocr.postprocess.otsl import convert_otsl_to_html
        html = convert_otsl_to_html(out)
        if html:
            return html
    return out


def _normalize_and_dedupe_blocks(blocks: List[Dict]) -> List[Dict]:
    out = []
    seen = set()
    for block in sorted(blocks, key=lambda x: x.get("order", 0)):
        item = dict(block)
        label = item.get("label", "")
        item["content"] = _normalize_crop_text(item.get("content", ""), label)
        if label in TEXT_BLOCK_LABELS:
            item["content"] = split_text_block(item["content"])
        elif label == "inline_formula" and item.get("inline_formula_mixed", False):
            item["content"] = split_text_block(item["content"], protect_inline_math=True)
        key = (item.get("order"), item.get("label"), item.get("content"))
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out
