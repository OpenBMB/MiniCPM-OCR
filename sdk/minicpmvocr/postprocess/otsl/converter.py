'OTSL to HTML conversion ported from PaddleX paddleocr_vl/uilts.py.'

from __future__ import annotations

import html
import itertools
import re
from typing import List, Tuple

from .types import TableCell, TableData, export_to_html


OTSL_NL = "<nl>"
OTSL_FCEL = "<fcel>"
OTSL_ECEL = "<ecel>"
OTSL_LCEL = "<lcel>"
OTSL_UCEL = "<ucel>"
OTSL_XCEL = "<xcel>"

_NON_CAPTURING_TAG_GROUP = "(?:<fcel>|<ecel>|<nl>|<lcel>|<ucel>|<xcel>)"
_OTSL_FIND_PATTERN = re.compile(
    f"{_NON_CAPTURING_TAG_GROUP}.*?(?={_NON_CAPTURING_TAG_GROUP}|$)",
    flags=re.DOTALL,
)
_ALL_TAGS = {OTSL_NL, OTSL_FCEL, OTSL_ECEL, OTSL_LCEL, OTSL_UCEL, OTSL_XCEL}


def otsl_pad_to_sqr_v2(otsl_str: str) -> str:
    'Pad an OTSL string so every row contains the same number of cells.'
    assert isinstance(otsl_str, str)
    otsl_str = otsl_str.strip()
    if OTSL_NL not in otsl_str:
        return otsl_str + OTSL_NL

    lines = otsl_str.split(OTSL_NL)
    row_data = []
    for line in lines:
        if not line:
            continue
        raw_cells = _OTSL_FIND_PATTERN.findall(line)
        if not raw_cells:
            continue
        total_len = len(raw_cells)
        min_len = 0
        for i, cell_str in enumerate(raw_cells):
            if cell_str.startswith(OTSL_FCEL):
                min_len = i + 1
        row_data.append({"raw_cells": raw_cells, "total_len": total_len, "min_len": min_len})

    if not row_data:
        return OTSL_NL

    global_min_width = max(row["min_len"] for row in row_data)
    max_total_len = max(row["total_len"] for row in row_data)
    search_start = global_min_width
    search_end = max(global_min_width, max_total_len)

    min_total_cost = float("inf")
    optimal_width = search_end
    for width in range(search_start, search_end + 1):
        cost = sum(abs(row["total_len"] - width) for row in row_data)
        if cost < min_total_cost:
            min_total_cost = cost
            optimal_width = width

    repaired_lines = []
    for row in row_data:
        cells = row["raw_cells"]
        current_len = len(cells)
        if current_len > optimal_width:
            new_cells = cells[:optimal_width]
        else:
            new_cells = cells + [OTSL_ECEL] * (optimal_width - current_len)
        repaired_lines.append("".join(new_cells))
    return OTSL_NL.join(repaired_lines) + OTSL_NL


def otsl_extract_tokens_and_text(s: str) -> Tuple[List[str], List[str]]:
    'Split an OTSL string into a flat token list and a mixed text/tag list.'
    pattern = "(" + "|".join([OTSL_NL, OTSL_FCEL, OTSL_ECEL, OTSL_LCEL, OTSL_UCEL, OTSL_XCEL]) + ")"
    tokens = re.findall(pattern, s)
    text_parts = re.split(pattern, s)
    text_parts = [t for t in text_parts if t.strip()]
    return tokens, text_parts


def otsl_parse_texts(
    texts: List[str], tokens: List[str]
) -> Tuple[List[TableCell], List[List[str]]]:
    'Convert a flat OTSL token/text stream into a list of TableCell objects.'
    split_row_tokens = [
        list(y)
        for x, y in itertools.groupby(tokens, lambda z: z == OTSL_NL)
        if not x
    ]


    if split_row_tokens:
        max_cols = max(len(row) for row in split_row_tokens)
        for row in split_row_tokens:
            while len(row) < max_cols:
                row.append(OTSL_ECEL)

        new_texts: List[str] = []
        text_idx = 0
        for row in split_row_tokens:
            for token in row:
                new_texts.append(token)
                if text_idx < len(texts) and texts[text_idx] == token:
                    text_idx += 1
                    if text_idx < len(texts) and texts[text_idx] not in _ALL_TAGS:
                        new_texts.append(texts[text_idx])
                        text_idx += 1
            new_texts.append(OTSL_NL)
            if text_idx < len(texts) and texts[text_idx] == OTSL_NL:
                text_idx += 1
        texts = new_texts

    def _count_right(tokens_2d: List[List[str]], c: int, r: int, which: List[str]) -> int:
        span = 0
        ci = c
        while ci < len(tokens_2d[r]) and tokens_2d[r][ci] in which:
            ci += 1
            span += 1
        return span

    def _count_down(tokens_2d: List[List[str]], c: int, r: int, which: List[str]) -> int:
        span = 0
        ri = r
        while ri < len(tokens_2d) and c < len(tokens_2d[ri]) and tokens_2d[ri][c] in which:
            ri += 1
            span += 1
        return span

    table_cells: List[TableCell] = []
    r_idx = 0
    c_idx = 0

    for i, text in enumerate(texts):
        if text in [OTSL_FCEL, OTSL_ECEL]:
            row_span = 1
            col_span = 1
            right_offset = 1
            cell_text = ""

            if text != OTSL_ECEL:
                cell_text = texts[i + 1] if i + 1 < len(texts) else ""
                right_offset = 2

            next_right = texts[i + right_offset] if i + right_offset < len(texts) else ""
            next_bottom = ""
            if r_idx + 1 < len(split_row_tokens) and c_idx < len(split_row_tokens[r_idx + 1]):
                next_bottom = split_row_tokens[r_idx + 1][c_idx]

            if next_right in [OTSL_LCEL, OTSL_XCEL]:
                col_span += _count_right(split_row_tokens, c_idx + 1, r_idx, [OTSL_LCEL, OTSL_XCEL])
            if next_bottom in [OTSL_UCEL, OTSL_XCEL]:
                row_span += _count_down(split_row_tokens, c_idx, r_idx + 1, [OTSL_UCEL, OTSL_XCEL])

            table_cells.append(
                TableCell(
                    text=cell_text.strip(),
                    row_span=row_span,
                    col_span=col_span,
                    start_row_offset_idx=r_idx,
                    end_row_offset_idx=r_idx + row_span,
                    start_col_offset_idx=c_idx,
                    end_col_offset_idx=c_idx + col_span,
                )
            )

        if text in [OTSL_FCEL, OTSL_ECEL, OTSL_LCEL, OTSL_UCEL, OTSL_XCEL]:
            c_idx += 1
        if text == OTSL_NL:
            r_idx += 1
            c_idx = 0

    return table_cells, split_row_tokens


def convert_otsl_to_html(otsl_content: str) -> str:
    'Convert an OTSL-v1.0 string to an HTML ``<table>``.'


    otsl_content = otsl_pad_to_sqr_v2(html.unescape(otsl_content))
    tokens, mixed_texts = otsl_extract_tokens_and_text(otsl_content)
    table_cells, split_row_tokens = otsl_parse_texts(mixed_texts, tokens)
    table_data = TableData(
        num_rows=len(split_row_tokens),
        num_cols=(max(len(row) for row in split_row_tokens) if split_row_tokens else 0),
        table_cells=table_cells,
    )
    return export_to_html(table_data)
