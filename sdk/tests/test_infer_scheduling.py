import json

import numpy as np
import pytest
from PIL import Image

from minicpmvocr import pipeline
from minicpmvocr.pipeline import staged
from minicpmvocr._utils import ensure_dir, write_json

PAGES = 3
BLOCKS_PER_PAGE = 4


class RecordingEngine:


    name = "fake"

    def __init__(self):
        self.calls = []

    def start(self):
        pass

    def stop(self):
        pass

    def recognize(self, image, prompt, max_new_tokens, slice_nums=None):
        width, height = image.size
        self.calls.append((width, height))

        return {"text": f"w{width}h{height}", "output_token_count": 3}


def _build_run(tmp_path):

    run_dir = tmp_path / "run"
    intermediate = run_dir / "runtime" / "intermediate"
    for page in range(PAGES):
        image_id = f"page{page}"
        crop_dir = intermediate / "crops" / image_id
        ensure_dir(crop_dir)
        blocks = []
        for idx in range(BLOCKS_PER_PAGE):

            w, h = 40 + 10 * idx + page, 20 + page
            crop_name = f"{idx:03d}_text.png"
            Image.fromarray(np.full((h, w, 3), 200, dtype=np.uint8)).save(crop_dir / crop_name)
            blocks.append({
                "block_id": idx, "label": "text", "bbox": [0, idx * 30, w, idx * 30 + h],
                "order": idx, "crop_filename": crop_name,
                "crop_width": w, "crop_height": h, "skip_vlm": False,
            })
        write_json(intermediate / "layouts" / f"{image_id}.json", {
            "image_id": image_id, "image_width": 200, "image_height": 400,
            "num_blocks": len(blocks), "blocks": blocks,
            "source": {"type": "image", "path": f"{image_id}.png"},
        })

    ensure_dir(run_dir / "runtime")
    tasks_path = run_dir / "runtime" / "page_tasks.jsonl"
    with tasks_path.open("w", encoding="utf-8") as f:
        for page in range(PAGES):
            image_id = f"page{page}"
            f.write(json.dumps({
                "image_id": image_id,
                "layout_path": str(intermediate / "layouts" / f"{image_id}.json"),
                "crop_dir": str(intermediate / "crops" / image_id),
                "source_path": "",
            }) + "\n")

    write_json(run_dir / "run_meta.json", {"metric_definition": {}})
    return run_dir


def _cfg(run_dir, queue_mode, page_workers, max_workers):
    return {
        "run": {"run_tag": "t", "run_root": str(run_dir.parent), "mode": "full", "seed": 42},
        "prompt": {"prompt_map": "", "override_mode": "legacy"},
        "pipeline": {"queue_mode": queue_mode, "page_workers": page_workers, "max_workers": max_workers},
        "logging": {"progress_log_every": 1000},
        "_meta": {"run_dir": str(run_dir)},
    }


@pytest.mark.parametrize(
    "queue_mode,page_workers,max_workers",
    [("serial", 1, 1), ("serial", 1, 8), ("serial", 3, 2), ("concurrent", 1, 8)],
)
def test_queue_modes_agree(tmp_path, monkeypatch, queue_mode, page_workers, max_workers):
    run_dir = _build_run(tmp_path)
    engine = RecordingEngine()
    monkeypatch.setattr(staged, "create_backend", lambda cfg: engine)

    summary = pipeline.infer_run(_cfg(run_dir, queue_mode, page_workers, max_workers))

    assert summary["counts"] == {
        "planned": PAGES,
        "ok": PAGES,
        "failed": 0,
        "blocks": PAGES * BLOCKS_PER_PAGE,
        "vlm_blocks": PAGES * BLOCKS_PER_PAGE,
        "failed_blocks": 0,
        "pages_with_failed_blocks": 0,
    }
    assert len(engine.calls) == PAGES * BLOCKS_PER_PAGE

    for page in range(PAGES):
        text = (run_dir / "output" / f"page{page}.md").read_text(encoding="utf-8")
        expected = [f"w{40 + 10 * idx + page}h{20 + page}" for idx in range(BLOCKS_PER_PAGE)]

        assert [line for line in text.split("\n") if line.strip()] == expected


def test_concurrent_mode_uses_the_full_worker_pool(tmp_path, monkeypatch):

    run_dir = _build_run(tmp_path)
    engine = RecordingEngine()
    monkeypatch.setattr(staged, "create_backend", lambda cfg: engine)

    seen = {}
    real_pool = staged.ThreadPoolExecutor

    def spy(max_workers, *a, **kw):
        seen["max_workers"] = max_workers
        return real_pool(max_workers, *a, **kw)

    monkeypatch.setattr(staged, "ThreadPoolExecutor", spy)
    pipeline.infer_run(_cfg(run_dir, "concurrent", 1, 8))


    assert seen["max_workers"] == 8
