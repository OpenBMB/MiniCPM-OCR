import numpy as np
import pytest
from PIL import Image

from minicpmvocr import pipeline, prompts
from minicpmvocr.pipeline import _text
from minicpmvocr.config import DEFAULT_CONFIG
from minicpmvocr.layouts import (
    DEFAULT_SKIP_VLM_LABELS,
    IMAGE_LABELS,
    resolve_skip_vlm_labels,
)
from minicpmvocr.layouts.base import BaseLayoutDetector


class _Detector(BaseLayoutDetector):


    name = "test"

    def _start(self) -> None:
        return None

    def detect(self, images):
        return [[] for _ in images]

    def model_ref(self) -> str:
        return "test"


def _detections():
    return [
        {"label": label, "class_id": i, "score": 0.9, "bbox": [0, 0, 10, 10], "polygon": []}
        for i, label in enumerate(["text", "image", "chart", "seal", "table"])
    ]


def _crop_flags(layout_cfg):
    detector = _Detector(layout_cfg)
    image = Image.fromarray(np.zeros((20, 40, 3), dtype=np.uint8))
    blocks = detector.crop(image, _detections())
    return {b["label"]: b["skip_vlm"] for b in blocks}


def _prompt_map(layout_cfg):
    return prompts.load_prompt_map(
        {"prompt": {"prompt_map": "", "override_mode": "legacy"}, "layout": layout_cfg}
    )


def test_default_skips_match_between_both_gates():
    layout_cfg = DEFAULT_CONFIG["layout"]
    flags = _crop_flags(layout_cfg)
    prompt_map = _prompt_map(layout_cfg)
    skipped = resolve_skip_vlm_labels(layout_cfg)
    for label in DEFAULT_SKIP_VLM_LABELS:
        if label in flags:
            assert flags[label] is (label in skipped), label
        assert (prompts.get_element_cfg(prompt_map, label) is None) is (label in skipped), label
    assert flags["text"] is False
    assert prompts.get_element_cfg(prompt_map, "text") is not None


def test_removing_a_label_enables_it_on_both_gates():

    layout_cfg = dict(DEFAULT_CONFIG["layout"])
    layout_cfg["skip_vlm_labels"] = [x for x in DEFAULT_SKIP_VLM_LABELS if x != "seal"]

    flags = _crop_flags(layout_cfg)
    assert flags["seal"] is False
    assert flags["image"] is True

    elem = prompts.get_element_cfg(_prompt_map(layout_cfg), "seal")
    assert elem is not None

    assert elem["prompt"] == "Seal Recognition:"


def test_empty_list_sends_everything():
    layout_cfg = dict(DEFAULT_CONFIG["layout"])
    layout_cfg["skip_vlm_labels"] = []
    assert not any(_crop_flags(layout_cfg).values())


def test_config_validation_rejects_a_bare_string(tmp_path):

    from minicpmvocr.config import _validate_config

    page = tmp_path / "x.png"
    Image.fromarray(np.zeros((8, 8, 3), dtype=np.uint8)).save(page)
    cfg = {
        "engine": dict(DEFAULT_CONFIG["engine"], type="vllm", model_name="test-ocr", server_urls=["http://x:1"]),
        "input": {"image_dir": "", "files_dir": "", "file_path": str(page)},
        "layout": dict(DEFAULT_CONFIG["layout"], skip_vlm_labels="seal"),
        "pipeline": DEFAULT_CONFIG["pipeline"],
    }
    with pytest.raises(ValueError, match="skip_vlm_labels"):
        _validate_config(cfg)


@pytest.mark.parametrize(
    "switches,expected",
    [
        ({}, set(IMAGE_LABELS)),
        ({"use_chart_recognition": False}, set(IMAGE_LABELS) | {"chart"}),
        ({"use_seal_recognition": False}, set(IMAGE_LABELS) | {"seal"}),
        (
            {"use_chart_recognition": False, "use_seal_recognition": False},
            set(DEFAULT_SKIP_VLM_LABELS),
        ),
        ({"use_ocr_for_image_block": True}, set()),
        (
            {
                "use_chart_recognition": True,
                "use_seal_recognition": True,
                "use_ocr_for_image_block": True,
            },
            set(),
        ),
    ],
)
def test_switches_derive_the_skip_list(switches, expected):

    cfg = dict(DEFAULT_CONFIG["layout"], **switches)
    assert resolve_skip_vlm_labels(cfg) == frozenset(expected)

    flags = _crop_flags(cfg)
    for label, flag in flags.items():
        assert flag is (label in expected), label


def test_defaults_recognize_chart_and_seal():

    assert resolve_skip_vlm_labels(DEFAULT_CONFIG["layout"]) == frozenset(IMAGE_LABELS)


def test_explicit_list_overrides_the_switches():

    cfg = dict(
        DEFAULT_CONFIG["layout"],
        use_chart_recognition=True,
        use_seal_recognition=True,
        skip_vlm_labels=["table"],
    )
    assert resolve_skip_vlm_labels(cfg) == frozenset({"table"})

    cfg = dict(DEFAULT_CONFIG["layout"], skip_vlm_labels=[])
    assert resolve_skip_vlm_labels(cfg) == frozenset()


def test_enabled_chart_and_seal_use_their_trained_prompts():

    cfg = dict(
        DEFAULT_CONFIG["layout"], use_chart_recognition=True, use_seal_recognition=True
    )
    prompt_map = _prompt_map(cfg)
    assert prompts.get_element_cfg(prompt_map, "chart")["prompt"] == "Chart to Table:"
    assert prompts.get_element_cfg(prompt_map, "seal")["prompt"] == "Seal Recognition:"


def test_chart_otsl_is_converted_to_html():

    otsl = "<otsl><fcel>Region<fcel>Share<nl><fcel>Japan<fcel>7%<nl></otsl>"
    out = _text._normalize_crop_text(otsl, "chart")
    assert "<table" in out and "<fcel>" not in out
    assert "Japan" in out and "7%" in out


@pytest.mark.parametrize("label", ["header_image", "footer_image"])
@pytest.mark.parametrize("image_path", ["", "imgs/page/header-footer.png"])
def test_recognized_header_footer_images_are_kept_in_markdown(label, image_path):
    from minicpmvocr.postprocess.markdown import assemble_markdown

    prompt_map = _prompt_map({"skip_vlm_labels": ["image"]})
    prompt_map["markdown_assembly"]["ignore_labels"] = []
    assert prompts.get_element_cfg(prompt_map, label) is not None
    blocks = [
        {"order": 0, "label": label, "content": "COURT OFFICE / Page 12", "image_path": image_path},
        {"order": 1, "label": "text", "content": "Body text"},
    ]
    assert assemble_markdown(blocks, prompt_map) == (
        f"![image]({image_path})\n\nCOURT OFFICE / Page 12\n\nBody text"
    )


@pytest.mark.parametrize("label", ["header_image", "footer_image"])
def test_header_footer_images_without_text_keep_the_placeholder(label):
    from minicpmvocr.postprocess.markdown import assemble_markdown

    prompt_map = _prompt_map({})
    prompt_map["markdown_assembly"]["ignore_labels"] = []
    assert assemble_markdown(
        [{"label": label, "content": ""}], prompt_map
    ) == "![image]()"


@pytest.mark.parametrize("label", ["header_image", "footer_image"])
def test_explicitly_ignored_header_footer_images_stay_hidden(label):
    from minicpmvocr.postprocess.markdown import assemble_markdown

    prompt_map = _prompt_map({"skip_vlm_labels": ["image"]})
    prompt_map["markdown_assembly"]["ignore_labels"] = [label]
    assert assemble_markdown(
        [{"label": label, "content": "COURT OFFICE"}], prompt_map
    ) == ""
