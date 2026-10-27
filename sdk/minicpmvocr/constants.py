from __future__ import annotations

from typing import Dict, List, Set, Tuple


MODEL_NAME = "PP-DocLayoutV3"


PX_LABELS: List[str] = [
    "abstract", "algorithm", "aside_text", "chart", "content",
    "display_formula", "doc_title", "figure_title", "footer",
    "footer_image", "footnote", "formula_number", "header",
    "header_image", "image", "inline_formula", "number",
    "paragraph_title", "reference", "reference_content", "seal",
    "table", "text", "vertical_text", "vision_footnote",
]


MERGE_BBOXES_MODE: Dict[int, str] = {
    3: "large",
    5: "large",
    6: "large",
    15: "large",
    17: "large",
}


NON_MERGE_LABELS: List[str] = [
    "image", "header_image", "footer_image", "chart", "seal", "table",
]


LAYOUT_SHAPE_MODE = "auto"


IMAGE_LABELS: Tuple[str, ...] = ("image", "header_image", "footer_image")


PARAMS_FILENAME = "inference.pdiparams"
CONFIG_FILENAME = "inference.yml"


SUPPORTED_IMAGE_SUFFIXES: Set[str] = {
    ".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff",
}
SUPPORTED_INPUT_SUFFIXES: Set[str] = SUPPORTED_IMAGE_SUFFIXES | {".pdf"}


OTSL_LABELS: Set[str] = {"table", "chart"}


PDF_RENDER_ZOOM = 2.0


PDF_RENDER_PAGES_PER_JOB = 16
