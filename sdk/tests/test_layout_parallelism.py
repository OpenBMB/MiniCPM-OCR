import threading
from copy import deepcopy

import numpy as np
import pytest
from PIL import Image

from minicpmvocr import pipeline
from minicpmvocr.pipeline import overlapped
from minicpmvocr.config import DEFAULT_CONFIG

PAGES = 8


class FakeDetector:


    name = "fake"

    def __init__(self, config):
        self.config = config
        self.device = "cpu"
        self.model_load_sec = 0.0
        self.pages = []

    def start(self):
        pass

    def stop(self):
        pass

    def model_ref(self):
        return "fake"

    def detect(self, images):
        image = images[0]
        self.pages.append((image.width, image.height))
        return [[{
            "index": 0, "label": "text", "class_id": 0, "score": 0.9,
            "bbox": [0.0, 0.0, float(image.width), float(image.height)], "polygon": None,
        }]]

    def crop(self, image, detections):

        return [{
            "label": "text", "score": 0.9, "order": 0,
            "bbox": [0, 0, image.width, image.height],
            "image": np.asarray(image.convert("RGB")),
            "polygon": None,
        }]


class RecordingEngine:
    name = "fake"

    def __init__(self):
        self.lock = threading.Lock()
        self.calls = []

    def start(self):
        pass

    def stop(self):
        pass

    def recognize(self, image, prompt, max_new_tokens, slice_nums=None):
        with self.lock:
            self.calls.append(image.size)
        return {"text": f"w{image.size[0]}", "output_token_count": 1}


def _make_pages(tmp_path):
    src = tmp_path / "src"
    src.mkdir(parents=True, exist_ok=True)
    for i in range(PAGES):

        Image.fromarray(np.full((40, 60 + i, 3), 200, dtype=np.uint8)).save(src / f"p{i:02d}.png")
    return src


def _cfg(tmp_path, src, layout_workers):

    run_dir = tmp_path / f"run{layout_workers}"
    cfg = deepcopy(DEFAULT_CONFIG)
    cfg["run"].update({"run_tag": "t", "run_root": str(tmp_path), "mode": "full"})
    cfg["input"].update({"image_dir": str(src)})
    cfg["layout"].update({"provider": "fake", "device": "cpu"})
    cfg["pipeline"].update({"max_workers": 4, "layout_workers": layout_workers, "overlap_layout": True})
    cfg["logging"]["progress_log_every"] = 1000
    cfg["_meta"] = {
        "run_dir": str(run_dir),
        "runtime_intermediate_dir": str(run_dir / "runtime" / "intermediate"),
    }
    return cfg


def _run(tmp_path, monkeypatch, layout_workers):
    src = _make_pages(tmp_path)
    made = []

    def fake_factory(layout_cfg):
        det = FakeDetector(layout_cfg)
        made.append(det)
        return det

    engine = RecordingEngine()
    monkeypatch.setattr(overlapped, "create_layout_detector", fake_factory)
    monkeypatch.setattr(overlapped, "create_backend", lambda cfg: engine)

    cfg = _cfg(tmp_path, src, layout_workers)
    summary = pipeline.pipelined_run(cfg)
    return cfg, summary, made, engine


@pytest.mark.parametrize("layout_workers", [1, 4])
def test_every_page_is_detected_exactly_once(tmp_path, monkeypatch, layout_workers):
    cfg, summary, made, engine = _run(tmp_path, monkeypatch, layout_workers)

    assert summary["counts"] == {
        "planned": PAGES,
        "ok": PAGES,
        "failed": 0,
        "blocks": PAGES,
        "vlm_blocks": PAGES,
        "failed_blocks": 0,
        "pages_with_failed_blocks": 0,
    }

    handled = [p for det in made for p in det.pages]
    assert sorted(handled) == sorted([(60 + i, 40) for i in range(PAGES)])
    assert len(engine.calls) == PAGES


def test_parallel_layout_matches_serial_output(tmp_path, monkeypatch):

    cfg1, _, _, _ = _run(tmp_path / "a", monkeypatch, 1)
    cfg4, _, _, _ = _run(tmp_path / "b", monkeypatch, 4)

    for i in range(PAGES):
        one = (pytest.importorskip("pathlib").Path(cfg1["_meta"]["run_dir"]) / "output" / f"p{i:02d}.md").read_text()
        four = (pytest.importorskip("pathlib").Path(cfg4["_meta"]["run_dir"]) / "output" / f"p{i:02d}.md").read_text()
        assert one == four


def test_layout_workers_controls_detector_count(tmp_path, monkeypatch):

    _, _, made_one, _ = _run(tmp_path / "a", monkeypatch, 1)
    _, _, made_four, _ = _run(tmp_path / "b", monkeypatch, 4)

    assert len(made_one) == 1
    assert len(made_four) == 4


def test_layout_timing_keeps_input_order(tmp_path, monkeypatch):

    import json
    from pathlib import Path

    cfg, _, _, _ = _run(tmp_path, monkeypatch, 4)
    path = Path(cfg["_meta"]["run_dir"]) / "runtime" / "layout_timing.jsonl"
    ids = [json.loads(line)["image_id"] for line in path.read_text().splitlines() if line.strip()]

    assert ids == [f"p{i:02d}" for i in range(PAGES)]
