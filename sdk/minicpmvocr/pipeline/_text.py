from __future__ import annotations

import re
from typing import Dict, List

from ..constants import OTSL_LABELS
from ..postprocess.markdown import TEXT_BLOCK_LABELS, split_text_block

INLINE_LATEX_RE = re.compile(r"\\\((.+?)\\\)")
DISPLAY_BRACKET_SEP_RE = re.compile(re.escape(r"\]") + r"\s*" + re.escape(r"\["))
_CLOSING_TOKENS_RE = re.compile(r"\\end\{[^}]*\}|\\\]|\$\$|</(?:table|tr|td|th)>")


def _truncate_repetitive_suffix(text: str) -> str:

    words = list(re.finditer(r"\S+", text))
    if len(words) < 18:
        return text

    normalized = [match.group(0).lower() for match in words]
    earliest_cut = len(text)
    max_window = min(64, len(words) // 3)
    for window in range(6, max_window + 1):
        limit = len(words) - (window * 3) + 1
        for start in range(limit):
            first = normalized[start : start + window]
            if (
                first == normalized[start + window : start + (window * 2)]
                and first == normalized[start + (window * 2) : start + (window * 3)]
            ):
                earliest_cut = min(earliest_cut, words[start].start())
                break

    if earliest_cut < len(text):
        truncated = text[:earliest_cut].rstrip()


        tail = text[earliest_cut:]
        closing = _CLOSING_TOKENS_RE.findall(tail)
        if closing:
            truncated = truncated + " " + " ".join(closing)
        return truncated
    return text


def _normalize_crop_text(text: str, label: str) -> str:
    if text is None:
        return ""
    out = _truncate_repetitive_suffix(text.strip())
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
