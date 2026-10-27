import threading
from copy import deepcopy

import numpy as np
import pytest
from PIL import Image

from minicpmvocr import pipeline
from minicpmvocr.pipeline import _blocks, overlapped, staged
from minicpmvocr.config import DEFAULT_CONFIG

from tests.test_crop_priority import (  # noqa: E402
    _MultiLabelDetector,
    _OrderRecordingEngine,
)
from tests.test_infer_scheduling import (  # noqa: E402
    BLOCKS_PER_PAGE,
    PAGES,
    RecordingEngine,
    _build_run,
)


def _config(tmp_path, src, **pipeline_overrides):
    run_dir = tmp_path / "run"
    cfg = deepcopy(DEFAULT_CONFIG)
    cfg["run"].update({"run_tag": "t", "run_root": str(tmp_path), "mode": "full"})
    cfg["input"].update({"image_dir": str(src)})
    cfg["layout"].update({"provider": "fake", "device": "cpu"})
    cfg["pipeline"].update({"max_workers": 1, "layout_workers": 1})
    cfg["pipeline"].update(pipeline_overrides)
    cfg["logging"]["progress_log_every"] = 1000
    cfg["_meta"] = {
        "run_dir": str(run_dir),
        "runtime_intermediate_dir": str(run_dir / "runtime" / "intermediate"),
    }
    return cfg


def _pages(tmp_path, count=2):
    src = tmp_path / "src"
    src.mkdir(parents=True, exist_ok=True)
    for i in range(count):
        Image.fromarray(np.full((40, 60, 3), 200, dtype=np.uint8)).save(src / f"p{i}.png")
    return src


def test_the_non_overlapped_path_uses_the_shared_dispatch_key(tmp_path, monkeypatch):

    run_dir = _build_run(tmp_path)
    engine = RecordingEngine()
    monkeypatch.setattr(staged, "create_backend", lambda c: engine)

    seen = []
    real = _blocks._block_priority

    def _spy(prompt_map, block):
        seen.append(block)
        return real(prompt_map, block)

    monkeypatch.setattr(staged, "_block_priority", _spy)

    cfg = {
        "run": {"run_tag": "t", "run_root": str(tmp_path), "mode": "full", "seed": 42},
        "prompt": {"prompt_map": "", "override_mode": "legacy"},
        "pipeline": {"page_workers": 1, "max_workers": 8},
        "logging": {"progress_log_every": 1000},
        "_meta": {"run_dir": str(run_dir)},
    }
    summary = pipeline.infer_run(cfg)

    assert summary["counts"]["ok"] == PAGES
    assert seen, "the non-overlapped path did not use the shared dispatch key"

    assert len(seen) == PAGES * BLOCKS_PER_PAGE


def test_a_failure_while_queueing_a_page_does_not_hang(tmp_path, monkeypatch):

    src = _pages(tmp_path)
    engine = _OrderRecordingEngine()
    monkeypatch.setattr(overlapped, "create_layout_detector", lambda c: _MultiLabelDetector(c))
    monkeypatch.setattr(overlapped, "create_backend", lambda c: engine)

    def _boom(prompt_map, block):
        raise ValueError("bad max_new_tokens")

    monkeypatch.setattr(overlapped, "_block_priority", _boom)

    cfg = _config(tmp_path, src, overlap_layout=True)
    box = {}

    def _run():
        box["summary"] = pipeline.pipelined_run(cfg)

    worker = threading.Thread(target=_run, daemon=True)
    worker.start()
    worker.join(timeout=60)
    assert not worker.is_alive(), "pipelined_run did not return; open_pages stranded"
    assert box["summary"]["counts"]["failed"] == 2
