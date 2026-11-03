"Behaviour ported from PaddleOCR-VL 1.6 (PaddleX 3.7.2): layout input channels, table figures, Markdown assembly."
import copy
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

import minicpmvocr

from minicpmvocr.pipeline._layout_record import _build_layout_from_blocks
from minicpmvocr.pipeline._table_figures import tokenize_page_tables, untokenize_table_figures
from minicpmvocr.pipeline._text import _normalize_and_dedupe_blocks
from minicpmvocr.postprocess.markdown import assemble_markdown, format_numbered_title, postprocess_content
from minicpmvocr.prompts import DEFAULT_PROMPT_MAP


def _prompt_map(**assembly):
    prompt_map = copy.deepcopy(DEFAULT_PROMPT_MAP)
    prompt_map["markdown_assembly"].update(assembly)
    return prompt_map


def _md(blocks, **assembly):
    return assemble_markdown(blocks, _prompt_map(**assembly))


# ---- layout input channels -------------------------------------------------


def test_paddlex_provider_hands_paddlex_bgr():
    from minicpmvocr.layouts.ppdoclayout3_paddlex import PPDocLayoutV3PaddleXDetector

    seen = []

    class FakeModel:
        def predict(self, array, **kwargs):
            seen.append(array)
            return [{"boxes": []}]

    detector = PPDocLayoutV3PaddleXDetector({"model_dir": "", "device": "cpu"})
    detector._model = FakeModel()
    detector.detect([Image.new("RGB", (4, 3), (255, 0, 0))])
    # PaddleX treats ndarrays as BGR (cv2.imread order) and converts to RGB itself.
    assert seen[0].shape == (3, 4, 3)
    assert seen[0][0, 0].tolist() == [0, 0, 255]
    assert seen[0].flags["C_CONTIGUOUS"]


# ---- titles, abstract / references, formula numbers ------------------------


@pytest.mark.parametrize(
    "content, expected",
    [
        ("Introduction", "## Introduction"),
        ("2 Method", "## 2 Method"),
        ("2.1 Data", "### 2.1 Data"),
        ("2.1.3 Setup.", "#### 2.1.3 Setup"),
        # PaddleX keeps the numbering's trailing dot, and counts it as one more level.
        ("2.1.3. Setup.", "##### 2.1.3. Setup"),
        ("(一)总体要求", "## (一) 总体要求"),
        ("5.", "### 5."),
        ("3.3. Compatibility. Throughout", "#### 3.3. Compatibility. Throughout"),
        # Dots outside the leading numbering do not deepen the title.
        ("Vol. 17: Cumulative Index", "## Vol. 17: Cumulative Index"),
        ("Diane S. Rosenberg, Mark D. Meyer, et al., Trustees", "## Diane S. Rosenberg, Mark D. Meyer, et al., Trustees"),
        ("1、关于支持新能源商品汽车铁路运输 2023.01.30", "## 1、 关于支持新能源商品汽车铁路运输 2023.01.30"),
        ("Related\nWork", "## Related Work"),
    ],
)
def test_paragraph_title_depth_follows_numbering(content, expected):
    assert format_numbered_title(content) == expected
    assert _md([{"order": 0, "label": "paragraph_title", "content": content}]) == expected


def test_template_title_style_keeps_title_format():
    blocks = [{"order": 0, "label": "paragraph_title", "content": "2.1 Data"}]
    assert _md(blocks, title_style="template") == "## 2.1 Data"


def test_doc_title_folds_newlines():
    assert _md([{"order": 0, "label": "doc_title", "content": "A Long\nTitle"}]) == "# A Long Title"


def test_abstract_and_reference_first_line_become_headings():
    blocks = [
        {"order": 0, "label": "abstract", "content": "Abstract We study OCR."},
        {"order": 1, "label": "reference", "content": "References\n[1] A. Author."},
    ]
    assert _md(blocks) == "## Abstract\n We study OCR.\n\n## References\n[1] A. Author."
    # Only an exact first line counts.
    assert _md([{"order": 0, "label": "abstract", "content": "Abstract: We study OCR."}]) == "Abstract: We study OCR."
    assert _md(blocks, first_line_headings=False) == "Abstract We study OCR.\n\nReferences\n[1] A. Author."


def test_formula_number_dropped_by_default_and_folded_on_request():
    blocks = [
        {"order": 0, "label": "display_formula", "content": "E=mc^2"},
        {"order": 1, "label": "formula_number", "content": "(1)"},
        {"order": 2, "label": "text", "content": "where"},
    ]
    assert _md(blocks) == "$$\nE=mc^2\n$$\n\nwhere"
    assert _md(blocks, show_formula_number=True) == "$$\nE=mc^2 \\tag*{(1)}\n$$\n\nwhere"


# ---- algorithm blocks stay verbatim -----------------------------------------


def test_algorithm_keeps_indentation_and_lines():
    raw = "\ndef f(x):\n    if x:\n        return  x\n    return 0\n"
    content = postprocess_content(raw, "text", label="algorithm")
    blocks = _normalize_and_dedupe_blocks([{"order": 0, "label": "algorithm", "content": content}])
    assert _md(blocks) == "def f(x):\n    if x:\n        return  x\n    return 0"


# ---- figures inside tables ---------------------------------------------------


def _block(label, bbox, image):
    return {"label": label, "class_id": 0, "score": 0.9, "bbox": list(bbox), "image": image,
            "polygon": [], "skip_vlm": label == "image", "group_id": None}


def _det(label, bbox):
    return {"label": label, "class_id": 0, "score": 0.9, "bbox": [float(v) for v in bbox], "polygon": []}


def _table_page():
    table = np.full((200, 300, 3), 128, dtype=np.uint8)
    blocks = [
        _block("table", (100, 100, 400, 300), table),
        _block("image", (150, 150, 250, 250), np.zeros((100, 100, 3), dtype=np.uint8)),
        _block("image", (500, 500, 600, 600), np.zeros((100, 100, 3), dtype=np.uint8)),
        _block("image", (300, 120, 310, 130), np.zeros((10, 10, 3), dtype=np.uint8)),
    ]
    detections = [_det(b["label"], b["bbox"]) for b in blocks]
    return blocks, detections


def test_figures_inside_a_table_are_tokenized():
    blocks, detections = _table_page()
    painted, tokens, in_table = tokenize_page_tables(blocks, detections, 800, 1000)
    # The big figure is painted with a token; the tiny one (<25 px) is dropped without one; the outside one stays.
    assert list(tokens) == [0] and len(tokens[0]) == 1
    token, figure_order = next(iter(tokens[0].items()))
    assert figure_order == 1 and token.startswith("[F")
    assert in_table == {1, 3}
    region = painted[0][50:150, 50:150]
    assert region.min() == 0 and region.max() == 255  # white box with black text
    assert (blocks[0]["image"] == 128).all()  # the provider's crop is not modified


def test_layout_record_carries_tokens_and_paints_crop(tmp_path):
    blocks, detections = _table_page()
    sink = {}
    layout, _ = _build_layout_from_blocks(
        image=Image.new("RGB", (800, 1000)), image_id="p", source_path="p.png", source_type="image",
        page_index=None, detections=detections, blocks=blocks, crops_root=tmp_path, crop_sink=sink,
    )
    by_order = {b["order"]: b for b in layout["blocks"]}
    assert set(by_order[0]["figure_tokens"].values()) == {1}
    assert by_order[1]["in_table"] and by_order[3]["in_table"] and "in_table" not in by_order[2]
    assert not (sink["000_table.png"] == 128).all()


def _figure_table_blocks():
    return [
        {"order": 0, "label": "table", "content": "<table><tr><td>[F23]</td><td>[F99]</td></tr></table>",
         "figure_tokens": {"[F23]": 1}},
        {"order": 1, "label": "image", "content": "", "image_path": "imgs/p/001.png", "in_table": True},
        {"order": 2, "label": "image", "content": "", "image_path": "imgs/p/002.png"},
    ]


def test_inline_table_figures_go_into_the_cell_by_default():
    blocks = _figure_table_blocks()
    by_order = {b["order"]: b for b in blocks}
    blocks[0]["content"] = untokenize_table_figures(blocks[0]["content"], blocks[0]["figure_tokens"], by_order, inline=True)
    assert blocks[0]["content"] == '<table><tr><td><img src="imgs/p/001.png" alt="Image" /></td><td>[F99]</td></tr></table>'
    md = _md(blocks)
    assert md.count("001.png") == 1 and "![image](imgs/p/001.png)" not in md and "![image](imgs/p/002.png)" in md


def test_separate_table_figures_leave_the_cell_empty():
    blocks = _figure_table_blocks()
    by_order = {b["order"]: b for b in blocks}
    blocks[0]["content"] = untokenize_table_figures(blocks[0]["content"], blocks[0]["figure_tokens"], by_order, inline=False)
    # OmniDocBench ground truth leaves a figure's cell empty; the figure keeps its own place in the page.
    assert blocks[0]["content"] == "<table><tr><td></td><td>[F99]</td></tr></table>"
    md = _md(blocks, table_figures="separate")
    assert "<img" not in md and "![image](imgs/p/001.png)" in md and "![image](imgs/p/002.png)" in md


def test_unknown_table_figure_mode_is_rejected():
    with pytest.raises(ValueError):
        _md(_figure_table_blocks(), table_figures="cell")


# ---- repetition truncation -------------------------------------------------


def _clean(raw, label, output_format):
    block = {"order": 0, "label": label, "content": postprocess_content(raw, output_format, label=label)}
    return _normalize_and_dedupe_blocks([block])[0]["content"]


def test_repeated_matrix_rows_are_not_taken_for_a_loop():
    # OmniDocBench page-b4b6b1d1: six identical rows of a 10x10 block matrix were cut as a "loop" (CDM 0.995 -> 0.722).
    row = r"\chi_{20}^{5} & \chi_{20}^{5} & & & & & & & 0 & 0 \\ "
    last = r"\chi_{80}^{8} & -\chi_{80}^{8} & 0 & 0 & 0 & 0 & 0 & 0 & \chi_{180}^{14} & -\chi_{20}^{6}"
    raw = "\\[\n\\begin{pmatrix} 1 & x \\\\ " + row * 6 + last + " \\end{pmatrix}\n\\]"
    out = _clean(raw, "display_formula", "latex")
    assert out.count(r"\chi_{20}^{5} & \chi_{20}^{5}") == 6
    assert out.endswith(last + r" \end{pmatrix}")


def test_repetition_loops_are_still_cut_as_paddleocr_vl_does():
    out = _clean("Intro sentence. " + "the same phrase " * 40, "text", "text")
    assert out.startswith("Intro sentence.") and len(out) < 100


# ---- rendering -------------------------------------------------------------


def test_image_links_with_spaces_and_parentheses_stay_links():
    block = {"order": 0, "label": "image", "content": "", "image_path": "imgs/Daily Star (2025) a%2Fb/001.png"}
    assert "![image](imgs/Daily%20Star%20%282025%29%20a%252Fb/001.png)" in _md([block])


def test_table_cells_keep_line_breaks_and_inline_formatting():
    from minicpmvocr.postprocess.otsl import convert_otsl_to_html

    html = convert_otsl_to_html("<fcel>a<br>b<fcel>H<sub>2</sub>O<fcel>x < y & <script><nl>")
    assert "a<br>b" in html and "H<sub>2</sub>O" in html
    assert "x &lt; y &amp; &lt;script&gt;" in html


# ---- markdown config -------------------------------------------------------


def _cfg(tmp_path, **overrides):
    from minicpmvocr.config import load_config

    model_dir = tmp_path / "layout"
    model_dir.mkdir(exist_ok=True)
    (model_dir / "inference.pdiparams").write_bytes(b"")
    (model_dir / "inference.json").write_text("{}")
    base = {"input": {"image_dir": str(tmp_path)}, "layout": {"model_dir": str(model_dir)}}
    for key, value in overrides.items():
        section, name = key.split("__")
        base.setdefault(section, {})[name] = value
    return load_config(str(Path(minicpmvocr.__file__).parent / "configs/minicpmvocr.yaml"), base)


def test_markdown_settings_come_from_the_config(tmp_path):
    from minicpmvocr.prompts import load_prompt_map

    default = load_prompt_map(_cfg(tmp_path))["markdown_assembly"]
    assert default["table_figures"] == "inline"
    assert default["formula_format"]["inline_formula"] == "${content}$"  # not taken for an environment variable
    assembly = load_prompt_map(_cfg(tmp_path, markdown__table_figures="separate"))["markdown_assembly"]
    assert assembly["table_figures"] == "separate" and assembly["title_style"] == "numbered"


def test_unknown_markdown_mode_is_rejected_when_the_config_loads(tmp_path):
    with pytest.raises(ValueError, match="markdown.table_figures"):
        _cfg(tmp_path, markdown__table_figures="cell")


def test_legacy_prompt_map_markdown_assembly_still_applies(tmp_path):
    from minicpmvocr.prompts import load_prompt_map

    legacy = tmp_path / "prompt_map.yaml"
    legacy.write_text("markdown_assembly:\n  table_figures: separate\n")
    cfg = _cfg(tmp_path, prompt__prompt_map=str(legacy))
    assert load_prompt_map(cfg)["markdown_assembly"]["table_figures"] == "separate"
