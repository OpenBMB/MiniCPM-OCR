from pathlib import Path

import pytest

from minicpmvocr import assemble_document_json, prompts
from minicpmvocr.pipeline._blocks import _execute_block
from minicpmvocr.pipeline._response import (
    RESPONSE_DIRNAME,
    page_response,
    public_block_status,
    rotation_record,
)
from minicpmvocr._utils import append_jsonl, write_json


@pytest.mark.parametrize("status,expected", [
    ("ok", "ok"),
    ("skipped_no_vlm", "skipped_no_vlm"),
    ("skipped_seal", "skipped_seal"),
    ("failed", "failed"),
    ("missing_crop", "failed"),
    ("vllm_error", "failed"),
    ("openai_error", "failed"),
])
def test_block_status_follows_online_contract(status, expected):
    assert public_block_status(status) == expected


def test_missing_crop_block_reports_failed_and_keeps_reason_in_crop_row():
    out = _execute_block(None, prompts.DEFAULT_PROMPT_MAP, "img", Path("/nonexistent"), {
        "label": "text", "order": 0, "bbox": [0, 0, 1, 1], "crop_filename": "000_text.png",
    })
    assert out["result_block"]["status"] == "failed"
    assert out["crop_row"]["status"] == "missing_crop"


# Expected values are the ocr.rotation objects returned by the online API for the
# same kinds of page: disabled, gated (small image), not applied, applied 270.
def test_rotation_disabled():
    assert rotation_record(None) == {
        "enabled": False, "applied": False, "predicted_angle": None,
        "predicted_score": None, "confirmed": None, "orientation_angle": 0,
        "deskew_angle": 0.0, "total_angle": 0.0, "skipped_reason": None,
    }


def test_rotation_gated():
    assert rotation_record({"gated": True}) == {
        "enabled": True, "applied": False, "predicted_angle": None,
        "predicted_score": None, "confirmed": None, "orientation_angle": 0,
        "deskew_angle": 0.0, "total_angle": 0.0, "skipped_reason": "gated",
    }


def test_rotation_below_apply_threshold():
    record = {"deskew": 0.2, "label": 0, "score": 0.9271, "deskew_search": "coarse",
              "correction": 0.2, "applied": False}
    assert rotation_record(record) == {
        "enabled": True, "applied": False, "predicted_angle": 0,
        "predicted_score": 0.9271, "confirmed": None, "orientation_angle": 0,
        "deskew_angle": 0.2, "total_angle": 0.2, "skipped_reason": None,
    }


def test_rotation_confirmed_and_applied():
    record = {"deskew": 0.6, "label": 270, "score": 0.9246, "deskew_search": "refined",
              "vote": 270, "correction": 270.6, "applied": True}
    assert rotation_record(record) == {
        "enabled": True, "applied": True, "predicted_angle": 270,
        "predicted_score": 0.9246, "confirmed": True, "orientation_angle": 270,
        "deskew_angle": 0.6, "total_angle": 270.6, "skipped_reason": None,
    }


def test_rotation_vetoed_prediction():
    record = {"deskew": 0.0, "label": 0, "score": 0.6, "vote": 0, "label_vetoed": 180,
              "correction": 0.0, "applied": False}
    out = rotation_record(record)
    assert out["predicted_angle"] == 180
    assert out["orientation_angle"] == 0
    assert out["confirmed"] is False


def test_rotation_unavailable():
    out = rotation_record({"skipped_reason": "unavailable"})
    assert out["enabled"] is True and out["applied"] is False
    assert out["skipped_reason"] == "unavailable"


def _layout(page_index=None):
    return {
        "image_width": 1700, "image_height": 2200,
        "source": {"page_index": page_index},
        "blocks": [
            {"order": 0, "regions": [[1, 2, 3, 4]]},
            {"order": 16, "regions": [[5, 6, 7, 8], [9, 10, 11, 12]]},
        ],
    }


def test_page_response_shape():
    blocks = [
        {"order": 0, "label": "number", "bbox": [1, 2, 3, 4], "content": "6", "status": "ok",
         "raw_content": "6", "crop_filename": "000_number.png"},
        {"order": 16, "label": "text", "bbox": [5, 6, 7, 8], "content": "", "status": "vllm_error"},
    ]
    page = page_response(layout=_layout(), blocks=blocks, markdown="md",
                         usage={"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3})
    assert set(page) == {"metadata", "choices", "ocr", "usage"}
    assert page["metadata"] == {"page_index": 0}
    assert page["choices"] == [{"message": {"content": "md"}}]
    ocr = page["ocr"]
    assert (ocr["image_width"], ocr["image_height"]) == (1700, 2200)
    assert ocr["rotation"]["enabled"] is False
    assert ocr["blocks"][0] == {
        "order": 0, "label": "number", "bbox": [1, 2, 3, 4], "regions": [[1, 2, 3, 4]],
        "content": "6", "status": "ok", "inline_formula_mixed": False,
    }
    assert ocr["blocks"][1]["regions"] == [[5, 6, 7, 8], [9, 10, 11, 12]]
    assert ocr["blocks"][1]["status"] == "failed"


def test_document_json_orders_pages_and_joins_markdown(tmp_path):
    for idx, image_id in [(1, "doc_page_002"), (0, "doc_page_001")]:
        append_jsonl(tmp_path / "runtime" / "page_tasks.jsonl", {"image_id": image_id})
        write_json(tmp_path / RESPONSE_DIRNAME / f"{image_id}.json",
                   page_response(layout=_layout(idx), blocks=[], markdown=f"page {idx}"))
    doc = assemble_document_json(tmp_path)
    assert doc["status"] == "Success"
    assert (doc["pages_done"], doc["pages_total"]) == (2, 2)
    assert [p["metadata"]["page_index"] for p in doc["pages"]] == [0, 1]
    assert doc["markdown"] == "page 0\n\npage 1"


def test_document_json_missing_page_is_failed(tmp_path):
    append_jsonl(tmp_path / "runtime" / "page_tasks.jsonl", {"image_id": "a"})
    append_jsonl(tmp_path / "runtime" / "page_tasks.jsonl", {"image_id": "b"})
    write_json(tmp_path / RESPONSE_DIRNAME / "a.json",
               page_response(layout=_layout(), blocks=[], markdown="a"))
    doc = assemble_document_json(tmp_path)
    assert doc["status"] == "Failed"
    assert (doc["pages_done"], doc["pages_total"]) == (1, 2)
