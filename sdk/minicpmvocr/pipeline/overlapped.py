from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections import deque
from itertools import count
from queue import Empty, PriorityQueue, Queue
from pathlib import Path
from typing import Dict, List, Optional

from ._blocks import (
    _block_priority,
    _execute_block,
    _failed_block_output,
    _failed_page_result,
    _finalize_page,
    _skipped_page_result,
)
from ._inputs import _iter_source_pages, _open_page_image
from ._layout_record import _parse_one_page
from ._metrics import build_summary, write_per_page_metrics, write_summary
from .upright import build_upright_corrector, upright_enabled
from .._utils import append_jsonl, ensure_dir, now_iso, read_json, write_json
from ..backends import create_backend
from ..layouts import create_layout_detector
from ..prompts import load_prompt_map
from .rm_client import RMClient, build_rm_caller


LOGGER = logging.getLogger(__name__)

_CROP_POOL = None
_CROP_POOL_LOCK = threading.Lock()


class _CropPool:


    def __init__(self, workers: int) -> None:
        self._queue: PriorityQueue = PriorityQueue()
        self._tie = count()
        for index in range(workers):
            threading.Thread(
                target=self._loop, name=f"crop-pool-{index}", daemon=True,
            ).start()

    def submit(self, priority: tuple, fn) -> None:
        self._queue.put((priority[0], priority[1], next(self._tie), fn))

    def _loop(self) -> None:
        while True:
            _, _, _, fn = self._queue.get()
            try:
                fn()
            except Exception:
                LOGGER.exception("crop pool worker failed")


def shared_crop_pool() -> Optional[_CropPool]:
    'OCR_SHARED_CROP_POOL=1 时才启用，命令行单次运行仍用自己的线程。'
    if os.environ.get("OCR_SHARED_CROP_POOL", "") != "1":
        return None
    global _CROP_POOL
    with _CROP_POOL_LOCK:
        if _CROP_POOL is None:
            workers = max(1, int(os.environ.get("OCR_CROP_WORKERS", "112") or 112))
            LOGGER.info("shared crop pool workers=%s", workers)
            _CROP_POOL = _CropPool(workers)
        return _CROP_POOL


def _failed_layout_row(entry: Dict, error: str, started: float) -> Dict:
    return {
        "image_id": entry.get("image_id", ""),
        "status": "failed",
        "source_path": entry.get("source_path", ""),
        "page_index": entry.get("page_index"),
        "num_blocks": 0,
        "duration_sec": round(time.time() - started, 6),
        "image_load_sec": 0.0,
        "upright_sec": 0.0,
        "detect_sec": 0.0,
        "crop_sec": 0.0,
        "page_save_sec": 0.0,
        "write_sec": 0.0,
        "error": error,
    }


def pipelined_run(cfg: Dict, resources: Dict | None = None, on_layout_idle=None) -> Dict:
    'Run layout detection and VLM inference concurrently when pipeline.overlap_layout is enabled.'
    run_dir = Path(cfg["_meta"]["run_dir"])
    runtime_dir = run_dir / "runtime"
    runtime_intermediate = Path(cfg["_meta"]["runtime_intermediate_dir"])
    for d in (
        run_dir,
        runtime_dir,
        run_dir / "output",
        run_dir / "results_json",
        run_dir / "logs",
        runtime_intermediate / "layouts",
        runtime_intermediate / "crops",
        runtime_intermediate / "layout_raw",
    ):
        ensure_dir(d)

    prompt_map = load_prompt_map(cfg)
    request_workers = max(1, int(cfg["pipeline"].get("max_workers", 1) or 1))
    progress_every = max(1, int(cfg["logging"].get("progress_log_every", 20)))


    save_crops = bool(cfg["pipeline"].get("save_crops", False))
    crop_timing_path = runtime_dir / "crop_timing.jsonl"
    page_timing_path = runtime_dir / "page_timing.jsonl"
    tasks_path = runtime_dir / "page_tasks.jsonl"
    tts_dump_path = runtime_dir / "tts_candidates.jsonl"

    _boot_t0 = time.time()
    resources = resources or {}


    owns_detectors = not resources.get("detectors")
    owns_engine = resources.get("engine") is None


    layout_workers = max(1, int(cfg["pipeline"].get("layout_workers", 1) or 1))
    _ld_t0 = time.time()
    if owns_detectors:
        detectors = [create_layout_detector(cfg["layout"]) for _ in range(layout_workers)]
        for detector in detectors:
            detector.start()
    else:
        detectors = list(resources["detectors"])

        layout_workers = len(detectors)
    layout_start_sec = time.time() - _ld_t0


    upright_corrector = resources.get("upright")
    if upright_corrector is None:
        upright_corrector = build_upright_corrector(cfg)
    if not upright_enabled(cfg):

        upright_corrector = None

    engine = resources.get("engine") or create_backend(cfg)
    _en_t0 = time.time()
    if owns_engine:
        engine.start()
    engine_start_sec = time.time() - _en_t0


    tts_cfg = cfg.get("tts") or {}
    rm_client = RMClient(tts_cfg) if tts_cfg.get("enabled") else None


    rm_caller, rm_batcher = build_rm_caller(tts_cfg, rm_client) if rm_client is not None else (None, None)
    if rm_client is not None:
        LOGGER.info("TTS enabled: n=%s rm_url=%s rm_batch=%s",
                    tts_cfg.get("n"), tts_cfg.get("rm_url"), tts_cfg.get("rm_batch") or "off")


    _enum_t0 = time.time()
    page_entries = _iter_source_pages(cfg, runtime_intermediate)
    enumerate_sec = time.time() - _enum_t0
    boot_sec = time.time() - _boot_t0
    if not page_entries:
        raise ValueError("No input pages found. Provide input.file_path or input.image_dir or input.files_dir with png/jpg/pdf files.")

    events: Queue = Queue()


    page_queue: Queue = Queue()
    for indexed_entry in enumerate(page_entries):
        page_queue.put(indexed_entry)
    parse_rows: Dict[int, Dict] = {}
    layout_wall = {"sec": 0.0}

    def _producer(detector) -> None:


        if upright_corrector is not None and hasattr(upright_corrector, "submit"):
            _producer_prefetched(detector)
            return
        while True:
            try:
                index, entry = page_queue.get_nowait()
            except Empty:
                return
            crops: Dict | None = None if save_crops else {}
            row = _parse_one_page(cfg, detector, entry, runtime_intermediate, crop_sink=crops, upright_corrector=upright_corrector)
            parse_rows[index] = row
            events.put(("page", (row, crops)))

    def _producer_prefetched(detector) -> None:
        import numpy as np
        pending: deque = deque()
        exhausted = False

        def fill() -> None:
            nonlocal exhausted
            window = max(1, int(getattr(upright_corrector, "workers", 1)))
            while not exhausted and len(pending) < window:
                try:
                    index, entry = page_queue.get_nowait()
                except Empty:
                    exhausted = True
                    return
                started = time.time()
                try:
                    image = _open_page_image(entry)
                    future = upright_corrector.submit(np.asarray(image))
                except Exception as exc:
                    row = _failed_layout_row(entry, str(exc), started)
                    parse_rows[index] = row
                    events.put(("page", (row, {} if not save_crops else None)))
                    continue
                pending.append((index, entry, image, started, future))

        fill()
        while pending:
            index, entry, image, started, future = pending.popleft()
            crops: Dict | None = None if save_crops else {}
            try:
                corrected, record, _wait = future.result()
                upright_sec = float(record.get("upright_sec", _wait))
                row = _parse_one_page(
                    cfg, detector, entry, runtime_intermediate, crop_sink=crops,
                    page_image=image,
                    upright_ready=(corrected, record, upright_sec),
                    clock_start=started,
                )
            except Exception as exc:
                image.close()
                row = _failed_layout_row(entry, str(exc), started)
            parse_rows[index] = row
            events.put(("page", (row, crops)))
            fill()

    layout_t0 = time.time()
    producers = [
        threading.Thread(target=_producer, args=(detector,), name=f"layout-producer-{i}", daemon=True)
        for i, detector in enumerate(detectors)
    ]
    started = time.time()
    for producer in producers:
        producer.start()

    def _await_layout() -> None:

        for producer in producers:
            producer.join()
        layout_wall["sec"] = time.time() - layout_t0

        if on_layout_idle is not None:
            on_layout_idle()
        events.put(("layout_done", None))

    threading.Thread(target=_await_layout, name="layout-done", daemon=True).start()

    page_states: List[Dict] = []
    per_page: List[Dict] = []
    pages_done = 0
    open_pages = 0
    layout_done = False

    def _finish(state_result: Dict) -> None:
        nonlocal pages_done
        per_page.append(state_result["page_row"])
        for crop_row in state_result.get("crop_rows", []):
            append_jsonl(crop_timing_path, crop_row)
        for dump in state_result.get("tts_dumps", []):
            append_jsonl(tts_dump_path, dump)
        append_jsonl(page_timing_path, state_result["page_timing"])
        pages_done += 1
        if pages_done % progress_every == 0:
            print(f"[pipelined] pages done {pages_done}", flush=True)


    work_queue: PriorityQueue = PriorityQueue()
    tie = count()
    crop_pool = shared_crop_pool()
    pending_cv = threading.Condition()
    pending = [0]

    def _enqueue(item: tuple) -> None:
        if crop_pool is None:
            work_queue.put(item)
            return
        _, _, _, pos, bpos, work = item

        def _wrapped(pos=pos, bpos=bpos, work=work) -> None:
            try:
                try:
                    output = work()
                except BaseException as exc:
                    state = page_states[pos] if pos < len(page_states) else None
                    block = {}
                    image_id = "page"
                    if state is not None and bpos < len(state["blocks"]):
                        image_id = state["image_id"]
                        block = state["blocks"][bpos]
                    output = _failed_block_output(image_id, block, f"worker died: {exc}")
                events.put(("block", (pos, bpos, output)))
            finally:
                with pending_cv:
                    pending[0] -= 1
                    pending_cv.notify_all()

        with pending_cv:
            pending[0] += 1
        crop_pool.submit(item, _wrapped)

    def _consume() -> None:
        while True:
            item = work_queue.get()
            _, _, _, pos, bpos, work = item
            if work is None:
                return
            try:
                events.put(("block", (pos, bpos, work())))
            except BaseException as e:


                events.put(("block", (pos, bpos, _failed_block_output(
                    page_states[pos]["image_id"],
                    page_states[pos]["blocks"][bpos],
                    f"worker died: {e}",
                ))))
                raise

    workers = []
    if crop_pool is None:
        workers = [
            threading.Thread(target=_consume, name=f"ocr-worker-{i}", daemon=True)
            for i in range(request_workers)
        ]
        for worker in workers:
            worker.start()
    try:
        while not (layout_done and open_pages == 0):
            kind, payload = events.get()
            if kind == "layout_done":
                layout_done = True
                continue
            if kind == "page":
                row, crops = payload
                crops = crops or {}
                image_id = row["image_id"]
                page_started = time.time()
                layout_stage_sec = float(row.get("duration_sec", 0.0))
                if row["status"] != "ok":
                    _finish(_failed_page_result(image_id, page_started, layout_stage_sec, row.get("error", "layout failed")))
                    continue
                layout_path = runtime_intermediate / "layouts" / f"{image_id}.json"
                crop_dir = runtime_intermediate / "crops" / image_id
                append_jsonl(tasks_path, {
                    "image_id": image_id,
                    "layout_path": str(layout_path),
                    "crop_dir": str(crop_dir),
                    "source_path": row.get("source_path", ""),
                })
                try:
                    layout = read_json(layout_path, default={}) or {}
                    blocks = layout.get("blocks", [])
                    md_path = run_dir / "output" / f"{image_id}.md"
                    json_path = run_dir / "results_json" / f"{image_id}.json"
                    if md_path.exists() and json_path.exists():
                        _finish(_skipped_page_result(image_id, page_started, layout_stage_sec, len(blocks), md_path))
                        continue
                    if not blocks:
                        _finish(_finalize_page(
                            run_dir=run_dir, image_id=image_id, layout=layout, blocks=blocks,
                            block_outputs=[], prompt_map=prompt_map,
                            page_started=page_started, layout_stage_sec=layout_stage_sec,
                        ))
                        continue
                    pos = len(page_states)

                    def _make_work(block, image_id=image_id, crop_dir=crop_dir, crops=crops):
                        crop_array = crops.get(block.get("crop_filename", ""))


                        submitted_at = time.time()

                        def _work():
                            try:
                                return _execute_block(engine, prompt_map, image_id, crop_dir, block,
                                                      crop_array, rm_client=rm_caller, tts_cfg=tts_cfg,
                                                      submitted_at=submitted_at)
                            except Exception as e:
                                return _failed_block_output(image_id, block, str(e))

                        return _work


                    items = [
                        _block_priority(prompt_map, block)
                        + (next(tie), pos, bpos, _make_work(block))
                        for bpos, block in enumerate(blocks)
                    ]
                    page_states.append({
                        "image_id": image_id, "layout": layout, "blocks": blocks,
                        "crop_dir": crop_dir, "page_started": page_started,
                        "layout_stage_sec": layout_stage_sec,
                        "outputs": [None] * len(blocks), "remaining": len(blocks),
                    })
                    open_pages += 1


                    for item in items:
                        _enqueue(item)
                except Exception as e:
                    _finish(_failed_page_result(image_id, page_started, layout_stage_sec, str(e)))
                continue
            if kind == "block":
                pos, bpos, output = payload
                state = page_states[pos]
                state["outputs"][bpos] = output
                state["remaining"] -= 1
                if state["remaining"] > 0:
                    continue
                try:
                    result = _finalize_page(
                        run_dir=run_dir, image_id=state["image_id"], layout=state["layout"],
                        blocks=state["blocks"], block_outputs=state["outputs"], prompt_map=prompt_map,
                        page_started=state["page_started"], layout_stage_sec=state["layout_stage_sec"],
                    )
                except Exception as e:
                    result = _failed_page_result(state["image_id"], state["page_started"], state["layout_stage_sec"], str(e))
                open_pages -= 1
                _finish(result)
    finally:

        if crop_pool is None:
            for _ in workers:
                work_queue.put((float("inf"), 0, 0, -1, -1, None))
            for worker in workers:
                worker.join()
        else:
            with pending_cv:
                while pending[0]:
                    pending_cv.wait()
        if owns_engine:
            engine.stop()
        if owns_detectors:
            for detector in detectors:
                detector.stop()
        for producer in producers:
            producer.join(timeout=10)
        if rm_batcher is not None:
            rm_batcher.flush()
        if rm_client is not None:
            rm_client.close()

    layout_timing_path = runtime_dir / "layout_timing.jsonl"
    with layout_timing_path.open("w", encoding="utf-8") as f:
        for index in sorted(parse_rows):
            f.write(json.dumps(parse_rows[index], ensure_ascii=False) + "\n")

    metric_definition = {
        "pipeline_mode": cfg["run"]["mode"],
        "page_metric": ["page_total_wall_sec", "layout_stage_sec", "extract_prep_sec", "extract_infer_sec", "post_process_sec", "queue_wait_sec"],
        "crop_metric": ["label", "duration_sec", "status", "queue_wait_sec"],
        "ae_metric": ["image_encode_time_sec", "prefill_time_sec", "decode_time_sec", "decode_speed_tps", "output_token_count"],
        "tts_metric": ["raw_candidate_count", "n_candidates", "best_index", "rm_used", "rm_error", "greedy_sec", "sample_sec", "rm_sec", "rm_wait_sec", "rm_call_sec", "rm_stage_sec", "rm_batch_size", "rm_batch_items"],

        "adaptive_metric": ["rounds_used", "stop_reason", "exhausted", "best_score", "rm_calls", "round_log"],
    }
    write_per_page_metrics(run_dir, per_page)
    summary = build_summary(per_page, planned_count=len(page_entries), metric_definition=metric_definition)


    phase_fields = ("image_load_sec", "upright_sec", "detect_sec", "crop_sec", "png_save_sec", "page_save_sec", "write_sec")
    page_work_sec = sum(float(r.get("duration_sec", 0.0)) for r in parse_rows.values())
    summary["layout_phase"] = {
        "pages": len(parse_rows),
        "layout_wall_sec": round(layout_wall["sec"], 3),
        "page_work_sec": round(page_work_sec, 3),
        "producer_overhead_sec": round(layout_wall["sec"] - page_work_sec, 3),
        "phase_totals": {
            k: round(sum(float(r.get(k, 0.0)) for r in parse_rows.values()), 3) for k in phase_fields
        },
    }
    summary["pipelined"] = {
        "overlap_layout": True,
        "save_crops": save_crops,
        "layout_workers": layout_workers,
        "total_wall_sec": round(time.time() - started, 2),
        "layout_wall_sec": round(layout_wall["sec"], 2),


        "boot": {
            "boot_sec": round(boot_sec, 3),
            "layout_start_sec": round(layout_start_sec, 3),
            "engine_start_sec": round(engine_start_sec, 3),
            "enumerate_pages_sec": round(enumerate_sec, 3),


            "render_sec": float(cfg["_meta"].get("render_sec", 0.0) or 0.0),
            "render_workers": cfg["_meta"].get("render_workers", 1),
        },
    }
    write_summary(run_dir, summary)

    run_meta = {
        "run_tag": cfg["run"]["run_tag"],
        "run_root": cfg["run"]["run_root"],
        "run_dir": str(run_dir),
        "created_at": now_iso(),
        "mode": cfg["run"]["mode"],
        "seed": cfg["run"]["seed"],
        "engine": cfg["engine"],
        "layout": cfg["layout"],
        "pipeline": cfg["pipeline"],
        "mm": cfg["mm"],
        "decode": cfg["decode"],
        "prompt": cfg["prompt"],
        "input": cfg["input"],
        "active_intermediate_dir": str(runtime_intermediate),
        "counts": {
            "planned_pages": len(page_entries),
            "ok_pages": sum(1 for x in per_page if x["status"] == "ok"),
            "failed_pages": sum(1 for x in per_page if x["status"] != "ok"),
            "blocks": sum(int(x.get("num_blocks", 0) or 0) for x in per_page),
            "vlm_blocks": sum(int(x.get("num_vlm_blocks", 0) or 0) for x in per_page),
            "failed_blocks": sum(int(x.get("num_failed_blocks", 0) or 0) for x in per_page),
            "pages_with_failed_blocks": sum(
                1 for x in per_page if int(x.get("num_failed_blocks", 0) or 0) > 0
            ),
        },
        "metric_definition": metric_definition,
        "infer_finished_at": now_iso(),
        "infer_summary": summary,
    }
    write_json(run_dir / "run_meta.json", run_meta)
    return summary
