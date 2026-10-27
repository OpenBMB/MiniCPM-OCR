import threading
from copy import deepcopy

import numpy as np
from PIL import Image

from minicpmvocr import pipeline, prompts
from minicpmvocr.pipeline import overlapped
from minicpmvocr.pipeline._blocks import _block_priority
from minicpmvocr.config import DEFAULT_CONFIG
from minicpmvocr.prompts import DEFAULT_PROMPT_MAP


LABELS = ["doc_title", "text", "table", "header"]


def _block(label, width=10, height=10):
    return {"label": label, "crop_width": width, "crop_height": height}


def test_label_with_larger_token_cap_goes_first():
    table = _block_priority(DEFAULT_PROMPT_MAP, _block("table"))
    text = _block_priority(DEFAULT_PROMPT_MAP, _block("text"))
    title = _block_priority(DEFAULT_PROMPT_MAP, _block("doc_title"))
    assert table < text < title


def test_bigger_crop_wins_within_one_label():
    big = _block_priority(DEFAULT_PROMPT_MAP, _block("text", 200, 100))
    small = _block_priority(DEFAULT_PROMPT_MAP, _block("text", 50, 50))
    assert big < small


def test_label_cap_outranks_crop_area():

    tiny_table = _block_priority(DEFAULT_PROMPT_MAP, _block("table", 5, 5))
    huge_title = _block_priority(DEFAULT_PROMPT_MAP, _block("doc_title", 3000, 3000))
    assert tiny_table < huge_title


def test_unknown_label_falls_back_to_the_default_cap():

    unknown = _block_priority(DEFAULT_PROMPT_MAP, _block("no_such_label"))
    default_cap = DEFAULT_PROMPT_MAP["default"]["max_new_tokens"]
    assert unknown[0] == -default_cap


class _MultiLabelDetector:


    name = "fake"

    def __init__(self, config):
        self.config = config
        self.device = "cpu"
        self.model_load_sec = 0.0

    def start(self):
        pass

    def stop(self):
        pass

    def model_ref(self):
        return "fake"

    def detect(self, images):
        return [[{"index": i, "label": lab, "class_id": i, "score": 0.9,
                  "bbox": [0.0, 0.0, 10.0, 10.0], "polygon": None}
                 for i, lab in enumerate(LABELS)]]

    def crop(self, image, detections):
        return [{"label": lab, "score": 0.9, "order": i,
                 "bbox": [0, 0, 10, 10],
                 "image": np.full((10, 10, 3), 200, dtype=np.uint8),
                 "polygon": None}
                for i, lab in enumerate(LABELS)]


class _OrderRecordingEngine:


    name = "fake"

    def __init__(self):
        self.lock = threading.Lock()
        self.caps = []

    def start(self):
        pass

    def stop(self):
        pass

    def recognize(self, image, prompt, max_new_tokens, slice_nums=None):
        with self.lock:
            self.caps.append(max_new_tokens)
        return {"text": "x", "output_token_count": 1}


def test_dispatch_order_is_longest_first(tmp_path, monkeypatch):

    src = tmp_path / "src"
    src.mkdir(parents=True, exist_ok=True)
    for i in range(3):
        Image.fromarray(np.full((40, 60, 3), 200, dtype=np.uint8)).save(src / f"p{i}.png")

    engine = _OrderRecordingEngine()
    monkeypatch.setattr(overlapped, "create_layout_detector", lambda c: _MultiLabelDetector(c))
    monkeypatch.setattr(overlapped, "create_backend", lambda c: engine)

    run_dir = tmp_path / "run"
    cfg = deepcopy(DEFAULT_CONFIG)
    cfg["run"].update({"run_tag": "t", "run_root": str(tmp_path), "mode": "full"})
    cfg["input"].update({"image_dir": str(src)})
    cfg["layout"].update({"provider": "fake", "device": "cpu"})

    cfg["pipeline"].update({"max_workers": 1, "layout_workers": 1, "overlap_layout": True})
    cfg["logging"]["progress_log_every"] = 1000
    cfg["_meta"] = {
        "run_dir": str(run_dir),
        "runtime_intermediate_dir": str(run_dir / "runtime" / "intermediate"),
    }
    summary = pipeline.pipelined_run(cfg)

    assert summary["counts"] == {
        "planned": 3,
        "ok": 3,
        "failed": 0,
        "blocks": len(LABELS) * 3,
        "vlm_blocks": len(LABELS) * 3,
        "failed_blocks": 0,
        "pages_with_failed_blocks": 0,
    }

    assert len(engine.caps) == len(LABELS) * 3
    caps = [DEFAULT_PROMPT_MAP["element_prompts"][lab]["max_new_tokens"] for lab in LABELS]


    first = engine.caps[: len(LABELS)]
    assert first == sorted(caps, reverse=True)


def test_skipped_labels_sort_to_the_back():

    prompt_map = prompts.load_prompt_map(
        {
            "prompt": {"prompt_map": "", "override_mode": "legacy"},
            "layout": dict(DEFAULT_CONFIG["layout"], use_chart_recognition=False),
        }
    )
    text = _block_priority(prompt_map, _block("text"))
    for label in ("image", "chart", "header_image", "footer_image"):
        skipped = _block_priority(prompt_map, _block(label))
        assert skipped[0] == 0, label
        assert text < skipped, label
