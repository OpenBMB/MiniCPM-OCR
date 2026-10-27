"Cross-page table merging adapted from PaddleOCR-VL's paddlex/inference/pipelines/layout_parsing/merge_table.py (Apache-2.0), which credits MinerU for the logic."
from __future__ import annotations

import re
from copy import deepcopy
from typing import Dict, List, Sequence


TRAILING_ALLOWED = {"footer", "vision_footnote", "number", "footnote", "footer_image", "seal"}

LEADING_ALLOWED = {"header", "header_image", "number", "seal"}

CONTINUE_KEYWORDS = ("continue", "continued", "cont'd", "cont‘d", "续", "續")

WIDTH_TOLERANCE = 0.1
MAX_HEADER_ROWS = 5


def _soup(html: str):
    try:
        from bs4 import BeautifulSoup
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "cross-page table merge requires beautifulsoup4; install it with "
            "`pip install 'minicpmvocr[crosspage]'` or disable "
            "pipeline.merge_cross_page_tables"
        ) from exc
    return BeautifulSoup(html, "html.parser")


def full_to_half(text: str) -> str:
    'Fullwidth ASCII -> halfwidth, so "（a）" and "(a)" compare equal.'
    return "".join(
        chr(ord(c) - 0xFEE0) if 0xFF01 <= ord(c) <= 0xFF5E else c for c in text
    )


def calculate_table_total_columns(soup) -> int:
    'Column count with colspan *and* rowspan accounted for.'
    rows = soup.find_all("tr")
    if not rows:
        return 0
    max_cols = 0
    occupied: Dict[int, Dict[int, bool]] = {}
    for row_idx, row in enumerate(rows):
        col_idx = 0
        occupied.setdefault(row_idx, {})
        for cell in row.find_all(["td", "th"]):
            while col_idx in occupied[row_idx]:
                col_idx += 1
            colspan = _span(cell, "colspan")
            rowspan = _span(cell, "rowspan")
            for r in range(row_idx, row_idx + rowspan):
                occupied.setdefault(r, {})
                for c in range(col_idx, col_idx + colspan):
                    occupied[r][c] = True
            col_idx += colspan
            max_cols = max(max_cols, col_idx)
    return max_cols


def _span(cell, attr: str) -> int:

    try:
        value = int(cell.get(attr, 1))
    except (TypeError, ValueError):
        return 1
    return value if 1 <= value <= 1000 else 1


def _row_columns(row) -> int:
    return sum(_span(cell, "colspan") for cell in row.find_all(["td", "th"]))


def _visual_columns(row) -> int:

    return len(row.find_all(["td", "th"]))


def detect_table_headers(soup1, soup2, max_header_rows: int = MAX_HEADER_ROWS) -> int:
    'How many leading rows the two tables repeat verbatim.'
    rows1, rows2 = soup1.find_all("tr"), soup2.find_all("tr")
    header_rows = 0
    for i in range(min(len(rows1), len(rows2), max_header_rows)):
        cells1 = rows1[i].find_all(["td", "th"])
        cells2 = rows2[i].find_all(["td", "th"])
        if len(cells1) != len(cells2):
            break
        match = True
        for c1, c2 in zip(cells1, cells2):
            t1 = "".join(full_to_half(c1.get_text()).split())
            t2 = "".join(full_to_half(c2.get_text()).split())
            if t1 != t2 or _span(c1, "colspan") != _span(c2, "colspan"):
                match = False
                break
        if not match:
            break
        header_rows += 1
    return header_rows


def check_rows_match(soup1, soup2) -> bool:
    'Fallback when total column counts differ: compare the boundary rows.'
    rows1, rows2 = soup1.find_all("tr"), soup2.find_all("tr")
    if not rows1 or not rows2:
        return False
    header_count = detect_table_headers(soup1, soup2)
    if len(rows2) <= header_count:
        return False
    last_row, first_data_row = rows1[-1], rows2[header_count]
    return (
        _row_columns(last_row) == _row_columns(first_data_row)
        or _visual_columns(last_row) == _visual_columns(first_data_row)
    )


def _has_continue_marker(block: Dict) -> bool:
    text = full_to_half(str(block.get("content") or "")).lower()
    return any(kw in text for kw in CONTINUE_KEYWORDS)


def _is_skippable(block: Dict, allowed: set) -> bool:
    return block.get("label", "") in allowed or _has_continue_marker(block)


def _widths_match(prev_block: Dict, curr_block: Dict) -> bool:
    try:
        prev_w = float(prev_block["bbox"][2]) - float(prev_block["bbox"][0])
        curr_w = float(curr_block["bbox"][2]) - float(curr_block["bbox"][0])
    except (KeyError, IndexError, TypeError, ValueError):
        return False
    if prev_w <= 0 or curr_w <= 0:
        return False
    return abs(curr_w - prev_w) / min(curr_w, prev_w) < WIDTH_TOLERANCE


def _last_table_index(blocks: Sequence[Dict]) -> int | None:
    for i in range(len(blocks) - 1, -1, -1):
        if blocks[i].get("label") == "table":
            return i
    return None


def _first_table_index(blocks: Sequence[Dict]) -> int | None:
    for i, block in enumerate(blocks):
        if block.get("label") == "table":
            return i
    return None


def can_merge_tables(prev_page: Sequence[Dict], curr_page: Sequence[Dict]) -> tuple:
    'Four gates, all of which must pass. Returns (ok, prev_idx, curr_idx).'
    prev_idx = _last_table_index(prev_page)
    curr_idx = _first_table_index(curr_page)
    if prev_idx is None or curr_idx is None:
        return False, None, None

    prev_block, curr_block = prev_page[prev_idx], curr_page[curr_idx]
    html_prev = str(prev_block.get("content") or "")
    html_curr = str(curr_block.get("content") or "")
    if "<table" not in html_prev.lower() or "<table" not in html_curr.lower():
        return False, None, None


    if not _widths_match(prev_block, curr_block):
        return False, None, None

    if not all(b.get("label", "") in TRAILING_ALLOWED for b in prev_page[prev_idx + 1:]):
        return False, None, None

    if not all(_is_skippable(b, LEADING_ALLOWED) for b in curr_page[:curr_idx]):
        return False, None, None

    soup_prev, soup_curr = _soup(html_prev), _soup(html_curr)
    if not (
        calculate_table_total_columns(soup_prev) == calculate_table_total_columns(soup_curr)
        or check_rows_match(soup_prev, soup_curr)
    ):
        return False, None, None
    return True, prev_idx, curr_idx


def perform_table_merge(html_prev: str, html_curr: str) -> str:
    "Append the later table's data rows to the earlier one, minus the repeated header."
    soup_prev, soup_curr = _soup(html_prev), _soup(html_curr)
    header_count = detect_table_headers(soup_prev, soup_curr)
    rows_prev = soup_prev.find_all("tr")
    if not rows_prev:
        return html_prev
    anchor = rows_prev[-1].parent
    for row in soup_curr.find_all("tr")[header_count:]:
        row.extract()
        anchor.append(row)
    return str(soup_prev)


def merge_cross_page_tables(pages: List[List[Dict]]) -> tuple[List[List[Dict]], int]:
    'Merge split tables across consecutive pages of one document.'
    merged = deepcopy(pages)
    count = 0
    for i in range(len(merged) - 1, 0, -1):
        ok, prev_idx, curr_idx = can_merge_tables(merged[i - 1], merged[i])
        if not ok:
            continue
        prev_block, curr_block = merged[i - 1][prev_idx], merged[i][curr_idx]
        prev_block["content"] = perform_table_merge(
            str(prev_block.get("content") or ""), str(curr_block.get("content") or "")
        )


        curr_block["content"] = ""
        curr_block["merged_into_previous_page"] = True
        count += 1
    return merged, count


def load_document_pages(run_dir) -> List[Dict]:
    "Read a run's per-page results back in document order."
    from pathlib import Path

    from .._utils import read_json

    results_dir = Path(run_dir) / "results_json"
    if not results_dir.is_dir():
        return []
    pages: List[Dict] = []
    for path in sorted(results_dir.glob("*.json")):
        data = read_json(path, default=None)
        if not data:
            continue
        source = data.get("source") or {}
        page_index = source.get("page_index")
        is_pdf = str(source.get("type") or "") == "pdf" or page_index is not None
        pages.append(
            {
                "image_id": data.get("image_id", path.stem),
                "document": str(source.get("path") or "") if is_pdf else "",

                "page_index": int(page_index) if page_index is not None else -1,
                "markdown": data.get("markdown", ""),
                "blocks": data.get("crop_blocks") or [],
            }
        )
    pages.sort(key=lambda p: (p["document"], p["page_index"], p["image_id"]))
    return pages


def apply_cross_page_merge(pages: List[Dict], prompt_map: Dict) -> Dict[str, Dict]:
    'Run the merge over already-loaded pages and report what changed.'
    from .markdown import assemble_markdown

    changes: Dict[str, Dict] = {}
    if not pages:
        return changes

    ordered = sorted(pages, key=lambda p: (p["document"], p["page_index"], p["image_id"]))
    groups: List[List[Dict]] = []
    for page in ordered:
        if groups and groups[-1][0]["document"] == page["document"]:
            groups[-1].append(page)
        else:
            groups.append([page])

    for group in groups:
        merged_blocks, merges = merge_cross_page_tables([p["blocks"] for p in group])
        if not merges:
            continue
        for page, blocks in zip(group, merged_blocks):
            absorbed = any(b.get("merged_into_previous_page") for b in blocks)
            extended = not absorbed and any(
                old.get("content") != new.get("content")
                for old, new in zip(page["blocks"], blocks)
            )
            if not (absorbed or extended):
                continue
            changes[page["image_id"]] = {
                "markdown": assemble_markdown(blocks, prompt_map),
                "blocks": blocks,
                "extended": extended,
                "absorbed": absorbed,
            }
    return changes


def assemble_document_markdown(
    run_dir, prompt_map: Dict, *, merge_tables: bool, delimiter: str
) -> tuple[str, int, int]:
    "Join a run's pages into one markdown document."
    pages = load_document_pages(run_dir)
    if not pages:
        return "", 0, 0
    changes = apply_cross_page_merge(pages, prompt_map) if merge_tables else {}
    texts = [changes.get(p["image_id"], p)["markdown"] for p in pages]
    merges = sum(1 for c in changes.values() if c["absorbed"])
    return delimiter.join(texts), len(pages), merges
