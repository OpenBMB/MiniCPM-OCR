"""Figures inside tables, ported from PaddleX paddleocr_vl/uilts.py (Apache-2.0).

PaddleOCR-VL paints every figure that lies wholly inside a table with a ``[F<n>]``
token before the table crop goes to the VLM, drops those figures from the page
flow, and swaps each token in the recognized table back for the figure's image.
"""
from __future__ import annotations

import math
import random
import re
from typing import Dict, List, Sequence, Tuple

import numpy as np

from ..postprocess.markdown import markdown_url

# PaddleX gather_imgs: BLOCK_LABEL_MAP["image_labels"].
TABLE_FIGURE_LABELS = ("image", "figure", "seal")
TOKEN_RE = re.compile(r"\[F(\d+)\]")
MIN_TOKEN_SIDE = 25


def _gen_random_map(num: int) -> List[int]:
    exclude_digits = {"0", "1", "9"}
    seq = []
    i = 0
    while len(seq) < num:
        if not (set(str(i)) & exclude_digits):
            seq.append(i)
        i += 1
    return seq


def _paint_token(image: np.ndarray, box: Sequence[float], token_str: str) -> np.ndarray:
    'White out `box` and write `token_str` centered in it, in place.'
    import cv2

    def optimal_font_scale(text, font_face, square_size, fill_ratio=0.9):
        left, right = 0.2, 10
        scale = left
        while right - left > 1e-2:
            mid = (left + right) / 2
            (w, h), _ = cv2.getTextSize(text, font_face, mid, thickness=1)
            if w < square_size * fill_ratio and h < square_size * fill_ratio:
                scale = mid
                left = mid
            else:
                right = mid
        return scale, w, h

    x1, y1, x2, y2 = [int(v) for v in box]
    box_w, box_h = x2 - x1, y2 - y1
    cv2.rectangle(image, (x1, y1), (x2, y2), color=(255, 255, 255), thickness=-1)
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale, text_w, text_h = optimal_font_scale(token_str, font, min(box_w, box_h))
    thickness = max(1, math.floor(font_scale * 4))
    cv2.putText(
        image,
        token_str,
        (x1 + (box_w - text_w) // 2, y1 + (box_h + text_h) // 2),
        font,
        font_scale,
        (0, 0, 0),
        thickness,
        lineType=cv2.LINE_AA,
    )
    return image


def gather_figures(detections: Sequence[Dict], width: int, height: int) -> List[Dict]:
    'Figure candidates from the raw (unfiltered) detections, clamped like PaddleX gather_imgs.'
    figures = []
    for detection in detections:
        label = detection["label"]
        if label not in TABLE_FIGURE_LABELS:
            continue
        raw = [float(v) for v in detection["bbox"]]
        x1, y1, x2, y2 = (int(v) for v in raw)
        x1, x2 = max(0, min(x1, width)), max(0, min(x2, width))
        y1, y2 = max(0, min(y1, height)), max(0, min(y2, height))
        if x2 <= x1 or y2 <= y1:
            continue
        figures.append({"label": label, "raw_bbox": raw, "coordinate": (x1, y1, x2, y2)})
    return figures


def tokenize_table_figures(
    table_image: np.ndarray, table_box: Sequence[float], figures: Sequence[Dict]
) -> Tuple[np.ndarray, Dict[str, int], List[int]]:
    """Paint the figures inside `table_box` with tokens.

    Returns the painted copy of the table crop, ``{token: figure index}`` and the
    indices of every contained figure (also the ones too small to carry a token).
    """
    random.seed(1024)
    random_map = _gen_random_map(len(figures))
    random.shuffle(random_map)
    tx1, ty1, tx2, ty2 = table_box
    painted = table_image.copy()
    token_map: Dict[str, int] = {}
    contained: List[int] = []
    for index, figure in enumerate(figures):
        fx1, fy1, fx2, fy2 = figure["coordinate"]
        if not (fx1 >= tx1 and fy1 >= ty1 and fx2 <= tx2 and fy2 <= ty2):
            continue
        contained.append(index)
        if min(fx2 - fx1, fy2 - fy1) < MIN_TOKEN_SIDE:
            continue
        token = "[F%d]" % random_map[index]
        _paint_token(painted, [fx1 - tx1, fy1 - ty1, fx2 - tx1, fy2 - ty1], token)
        token_map[token] = index
    return painted, token_map, contained


def tokenize_page_tables(blocks: Sequence[Dict], detections: Sequence[Dict], width: int, height: int):
    """Tokenize every table crop of one page.

    `blocks` are the provider's cropped blocks (their list index is the block
    order); `detections` the raw boxes they were built from. Returns
    ``({table order: painted crop}, {table order: {token: figure block order}},
    {orders of figure blocks that live inside a table})``.
    """
    figures = gather_figures(detections, width, height)
    if not figures:
        return {}, {}, set()

    def rounded(bbox):
        return [int(round(float(v))) for v in bbox]

    # A figure maps to the block cropped from the same detection, as PaddleX keys both by label + box.
    order_by_box = {
        (block["label"], tuple(rounded(block["bbox"]))): order
        for order, block in enumerate(blocks)
        if block.get("image") is not None and block["label"] in TABLE_FIGURE_LABELS
    }
    figure_orders = [order_by_box.get((f["label"], tuple(rounded(f["raw_bbox"])))) for f in figures]
    raw_table_boxes = {
        tuple(rounded(d["bbox"])): [float(v) for v in d["bbox"]] for d in detections if d["label"] == "table"
    }

    painted_by_order: Dict[int, np.ndarray] = {}
    tokens_by_order: Dict[int, Dict[str, int | None]] = {}
    in_table: set = set()
    for order, block in enumerate(blocks):
        if block["label"] != "table" or block.get("image") is None:
            continue
        table_box = raw_table_boxes.get(tuple(rounded(block["bbox"])), [float(v) for v in block["bbox"]])
        painted, token_map, contained = tokenize_table_figures(block["image"], table_box, figures)
        if not contained:
            continue
        painted_by_order[order] = painted
        tokens_by_order[order] = {token: figure_orders[index] for token, index in token_map.items()}
        in_table.update(figure_orders[index] for index in contained if figure_orders[index] is not None)
    return painted_by_order, tokens_by_order, in_table


def untokenize_table_figures(
    content: str, figure_tokens: Dict[str, int | None], blocks_by_order: Dict[int, Dict], inline: bool = True
) -> str:
    """Resolve the figure tokens in a recognized table; unknown tokens stay as text.

    ``inline`` puts the figure's image (and recognized text) in the cell, as
    PaddleOCR-VL does; otherwise the cell is left empty and the figure keeps its
    own place in the page.
    """

    def repl(match: re.Match) -> str:
        order = figure_tokens.get(match.group(0))
        block = blocks_by_order.get(order) if order is not None else None
        if block is None:
            return match.group(0)
        if not inline:
            return ""
        info = '<img src="%s" alt="Image" />' % markdown_url((block.get("image_path") or "").replace("-\n", "").replace("\n", " "))
        if block.get("content"):
            info += "\n\n" + block["content"] + "\n\n"
        return info

    return TOKEN_RE.sub(repl, content)
