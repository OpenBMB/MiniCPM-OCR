from pathlib import Path

import numpy as np
from PIL import Image

from minicpmvocr.pipeline._layout_record import _build_layout_from_blocks


def _block(label, bbox, image=None, group_id=None):
    return {
        "label": label,
        "class_id": 0,
        "score": 0.9,
        "bbox": list(bbox),
        "image": image,
        "polygon": [],
        "skip_vlm": False,
        "group_id": group_id,
    }


def _crop(h, w):
    return np.zeros((h, w, 3), dtype=np.uint8)


def _layout(blocks, tmp_path=None):
    layout, _ = _build_layout_from_blocks(
        image=Image.new("RGB", (800, 1000)),
        image_id="t",
        source_path="t.png",
        source_type="image",
        page_index=None,
        detections=[],
        blocks=blocks,
        crops_root=Path("/tmp"),
        crop_sink={},
    )
    return layout


def test_unmerged_block_has_one_region():
    layout = _layout([_block("text", [10, 10, 100, 40], _crop(30, 90))])
    block = layout["blocks"][0]
    assert block["regions"] == [[10, 10, 100, 40]]
    assert block["bbox"] == [10, 10, 100, 40]


def test_cross_column_merge_keeps_both_boxes():

    blocks = [

        _block("text", [13, 820, 327, 852], _crop(77, 315)),

        _block("text", [335, 409, 650, 454], None, group_id=0),
    ]
    layout = _layout(blocks)
    assert len(layout["blocks"]) == 1
    regions = layout["blocks"][0]["regions"]
    assert regions == [[13, 820, 327, 852], [335, 409, 650, 454]]

    assert layout["blocks"][0]["bbox"] == [13, 820, 327, 852]


def test_group_id_assigns_folded_boxes_to_the_right_leader():

    blocks = [
        _block("text", [0, 0, 100, 20], _crop(40, 100)),
        _block("text", [0, 30, 100, 50], None, group_id=0),
        _block("text", [200, 0, 300, 20], _crop(40, 100)),
        _block("text", [200, 30, 300, 50], None, group_id=2),
    ]
    out = {b["order"]: b["regions"] for b in _layout(blocks)["blocks"]}
    assert out[0] == [[0, 0, 100, 20], [0, 30, 100, 50]]
    assert out[2] == [[200, 0, 300, 20], [200, 30, 300, 50]]


def test_missing_group_id_falls_back_to_preceding_leader():

    blocks = [
        _block("text", [0, 0, 100, 20], _crop(40, 100)),
        _block("text", [0, 30, 100, 50], None),
    ]
    block = _layout(blocks)["blocks"][0]
    assert block["regions"] == [[0, 0, 100, 20], [0, 30, 100, 50]]


def test_three_way_merge_keeps_all_three():
    blocks = [
        _block("text", [0, 0, 100, 20], _crop(60, 100)),
        _block("text", [0, 30, 100, 50], None, group_id=0),
        _block("text", [0, 60, 100, 80], None, group_id=0),
    ]
    assert len(_layout(blocks)["blocks"][0]["regions"]) == 3
