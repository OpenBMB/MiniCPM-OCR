from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List, Optional

from ..config import DEFAULT_CONFIG
from ._blocks import (
    _block_priority,
    _execute_block,
    _failed_block_output,
    _failed_page_result,
    _finalize_page,
    _skipped_page_result,
)
from ._inputs import _iter_source_pages, _load_manifest_filter, _mode_limit
from ._layout_record import _parse_one_page
from ..prompts import load_prompt_map
from ..backends import create_backend
from ..layouts import create_layout_detector
from ._metrics import build_summary, write_per_page_metrics, write_summary
from .upright import build_upright_corrector
from .rm_client import RMClient, build_rm_caller
from .._utils import (
    append_jsonl,
    ensure_dir,
    now_iso,
    read_json,
    read_jsonl,
    write_json,
)


LOGGER = logging.getLogger(__name__)


def _update_run_meta(run_meta_path: Path, updates: Dict) -> None:
    meta = read_json(run_meta_path, default={}) or {}
    meta.update(updates)
    write_json(run_meta_path, meta)


def parse_layout_run(cfg: Dict) -> Dict:
    _stage_t0 = time.time()
    run_dir = Path(cfg["_meta"]["run_dir"])
    runtime_dir = run_dir / "runtime"
    runtime_intermediate = Path(cfg["_meta"]["runtime_intermediate_dir"])
    layouts_dir = runtime_intermediate / "layouts"
    crops_root = runtime_intermediate / "crops"

    ensure_dir(run_dir)
    ensure_dir(runtime_dir)
    ensure_dir(layouts_dir)
    ensure_dir(crops_root)
    ensure_dir(run_dir / "logs")

    layout_detector = create_layout_detector(cfg["layout"])
    layout_detector.start()
    provider = layout_detector.name

    upright_corrector = build_upright_corrector(cfg)

    page_entries = _iter_source_pages(cfg, runtime_intermediate)
    if not page_entries:
        raise ValueError("No input pages found. Provide input.file_path or input.image_dir or input.files_dir with png/jpg/pdf files.")

    parse_rows = []
    errors = []
    raw_result_dir = runtime_intermediate / "layout_raw"
    ensure_dir(raw_result_dir)

    layout_loop_t0 = time.time()
    for entry in page_entries:
        row = _parse_one_page(cfg, layout_detector, entry, runtime_intermediate, upright_corrector=upright_corrector)
        if row["status"] != "ok":
            errors.append({"image_id": row["image_id"], "error": row.get("error", "")})
        parse_rows.append(row)
    layout_loop_sec = time.time() - layout_loop_t0

    layout_detector.stop()

    layout_timing_path = runtime_dir / "layout_timing.jsonl"
    with layout_timing_path.open("w", encoding="utf-8") as f:
        for row in parse_rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    cfg["_meta"]["active_intermediate_dir"] = str(runtime_intermediate)

    phase_fields = ("image_load_sec", "upright_sec", "detect_sec", "crop_sec", "png_save_sec", "page_save_sec", "write_sec")
    page_work_sec = sum(float(r.get("duration_sec", 0.0)) for r in parse_rows)
    phase_totals = {
        k: round(sum(float(r.get(k, 0.0)) for r in parse_rows), 3) for k in phase_fields
    }

    summary = {
        "status": "ok" if not errors else "partial_failed",
        "provider": provider,
        "device": layout_detector.device,
        "model_dir": cfg["layout"].get("model_dir", ""),
        "model_ref": layout_detector.model_ref(),
        "active_intermediate_dir": str(runtime_intermediate),
        "num_pages": len(page_entries),
        "ok_pages": sum(1 for x in parse_rows if x["status"] == "ok"),
        "failed_pages": sum(1 for x in parse_rows if x["status"] != "ok"),
        "model_load_sec": round(layout_detector.model_load_sec, 6),


        "timing_sec": {
            "stage_sec": round(time.time() - _stage_t0, 3),
            "loop_sec": round(layout_loop_sec, 3),
            "page_work_sec": round(page_work_sec, 3),
            "loop_overhead_sec": round(layout_loop_sec - page_work_sec, 3),
            "phase_totals": phase_totals,
        },
    }
    if errors:
        summary["errors"] = errors[:20]

    _update_run_meta(
        run_dir / "run_meta.json",
        {
            "parse_layout_finished_at": now_iso(),
            "layout": cfg["layout"],
            "parse_layout_summary": summary,
            "active_intermediate_dir": str(runtime_intermediate),
        },
    )
    return summary


def prepare_run(cfg: Dict) -> Dict:
    run_dir = Path(cfg["_meta"]["run_dir"])
    runtime_dir = run_dir / "runtime"
    ensure_dir(run_dir)
    ensure_dir(runtime_dir)
    ensure_dir(run_dir / "output")
    ensure_dir(run_dir / "results_json")
    ensure_dir(run_dir / "logs")

    active_intermediate = cfg["_meta"].get("active_intermediate_dir")
    if not active_intermediate:
        raise ValueError("No runtime intermediate dir available in config metadata")

    layouts_dir = Path(active_intermediate) / "layouts"
    if not layouts_dir.exists() or not list(layouts_dir.glob("*.json")):
        parse_layout_run(cfg)
        active_intermediate = cfg["_meta"].get("active_intermediate_dir")
        layouts_dir = Path(active_intermediate) / "layouts"

    if not layouts_dir.exists():
        raise FileNotFoundError(f"Layout dir not found: {layouts_dir}")

    layout_files = sorted(layouts_dir.glob("*.json"))
    selected = _load_manifest_filter(cfg["input"].get("manifest", ""))
    if selected:
        layout_files = [p for p in layout_files if p.stem in selected or p.name in selected]

    limit = _mode_limit(cfg)
    if limit > 0:
        layout_files = layout_files[:limit]

    tasks = []
    for layout_path in layout_files:
        image_id = layout_path.stem
        tasks.append(
            {
                "image_id": image_id,
                "layout_path": str(layout_path),
                "crop_dir": str(Path(active_intermediate) / "crops" / image_id),
                "source_path": "",
            }
        )

    tasks_path = runtime_dir / "page_tasks.jsonl"
    with tasks_path.open("w", encoding="utf-8") as f:
        for row in tasks:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    metric_definition = {
        "pipeline_mode": cfg["run"]["mode"],
        "page_metric": ["page_total_wall_sec", "layout_stage_sec", "extract_prep_sec", "extract_infer_sec", "post_process_sec", "queue_wait_sec"],
        "crop_metric": ["label", "duration_sec", "status", "queue_wait_sec"],
        "ae_metric": ["image_encode_time_sec", "prefill_time_sec", "decode_time_sec", "decode_speed_tps", "output_token_count"],
        "tts_metric": ["raw_candidate_count", "n_candidates", "best_index", "rm_used", "rm_error", "greedy_sec", "sample_sec", "rm_sec", "rm_wait_sec", "rm_call_sec", "rm_stage_sec", "rm_batch_size", "rm_batch_items"],

        "adaptive_metric": ["rounds_used", "stop_reason", "exhausted", "best_score", "rm_calls", "round_log"],
    }

    prior_meta = read_json(run_dir / "run_meta.json", default={}) or {}
    run_meta = {
        "run_tag": cfg["run"]["run_tag"],
        "run_root": cfg["run"]["run_root"],
        "run_dir": str(run_dir),
        "created_at": prior_meta.get("created_at", now_iso()),
        "mode": cfg["run"]["mode"],
        "seed": cfg["run"]["seed"],
        "engine": cfg["engine"],
        "layout": cfg["layout"],
        "pipeline": cfg["pipeline"],
        "mm": cfg["mm"],
        "decode": cfg["decode"],
        "prompt": cfg["prompt"],
        "input": cfg["input"],
        "active_intermediate_dir": str(active_intermediate),
        "counts": {"planned_pages": len(tasks)},
        "metric_definition": metric_definition,
    }
    if "parse_layout_summary" in prior_meta:
        run_meta["parse_layout_summary"] = prior_meta["parse_layout_summary"]
    if "parse_layout_finished_at" in prior_meta:
        run_meta["parse_layout_finished_at"] = prior_meta["parse_layout_finished_at"]

    write_json(run_dir / "run_meta.json", run_meta)
    return run_meta


def _infer_concurrent(
    *,
    run_dir: Path,
    tasks: List[Dict],
    engine,
    prompt_map: Dict,
    request_workers: int,
    progress_every: int,
    rm_client=None,
    tts_cfg: Optional[Dict] = None,
) -> Dict[int, Dict]:

    page_states: List[Dict] = []
    flat: List[tuple] = []

    for pos, task in enumerate(tasks):
        image_id = task["image_id"]
        page_started = time.time()
        layout_stage_sec = 0.0
        state: Dict = {"image_id": image_id, "result": None}
        try:
            layout_t0 = time.time()
            layout = read_json(Path(task["layout_path"]), default={}) or {}
            blocks = layout.get("blocks", [])
            layout_stage_sec = time.time() - layout_t0

            md_path = run_dir / "output" / f"{image_id}.md"
            json_path = run_dir / "results_json" / f"{image_id}.json"
            if md_path.exists() and json_path.exists():
                state["result"] = _skipped_page_result(image_id, page_started, layout_stage_sec, len(blocks), md_path)
            elif not blocks:
                state["result"] = _finalize_page(
                    run_dir=run_dir,
                    image_id=image_id,
                    layout=layout,
                    blocks=blocks,
                    block_outputs=[],
                    prompt_map=prompt_map,
                    page_started=page_started,
                    layout_stage_sec=layout_stage_sec,
                )
            else:
                state.update(
                    {
                        "layout": layout,
                        "blocks": blocks,
                        "crop_dir": Path(task["crop_dir"]),
                        "page_started": page_started,
                        "layout_stage_sec": layout_stage_sec,
                        "outputs": [None] * len(blocks),
                        "remaining": len(blocks),
                    }
                )
                for bpos, block in enumerate(blocks):
                    flat.append((pos, bpos, block))
        except Exception as e:
            state["result"] = _failed_page_result(image_id, page_started, layout_stage_sec, str(e))
        page_states.append(state)


    flat.sort(key=lambda item: _block_priority(prompt_map, item[2]))

    total_pages = len(tasks)
    completed_pages = sum(1 for s in page_states if s["result"] is not None)

    def _run_one(pos: int, block: Dict, submitted_at: float = 0.0) -> Dict:
        state = page_states[pos]
        try:
            return _execute_block(engine, prompt_map, state["image_id"], state["crop_dir"], block,
                                  rm_client=rm_client, tts_cfg=tts_cfg,
                                  submitted_at=submitted_at or None)
        except Exception as e:
            return _failed_block_output(state["image_id"], block, str(e))

    if flat:
        with ThreadPoolExecutor(max_workers=min(request_workers, len(flat))) as executor:
            _now = time.time()
            futures = {executor.submit(_run_one, pos, block, _now): (pos, bpos) for pos, bpos, block in flat}
            for future in as_completed(futures):
                pos, bpos = futures[future]
                state = page_states[pos]
                state["outputs"][bpos] = future.result()
                state["remaining"] -= 1
                if state["remaining"] > 0:
                    continue
                try:
                    state["result"] = _finalize_page(
                        run_dir=run_dir,
                        image_id=state["image_id"],
                        layout=state["layout"],
                        blocks=state["blocks"],
                        block_outputs=state["outputs"],
                        prompt_map=prompt_map,
                        page_started=state["page_started"],
                        layout_stage_sec=state["layout_stage_sec"],
                    )
                except Exception as e:
                    state["result"] = _failed_page_result(
                        state["image_id"], state["page_started"], state["layout_stage_sec"], str(e)
                    )
                completed_pages += 1
                if completed_pages % progress_every == 0 or completed_pages == total_pages:
                    print(f"[infer] progress {completed_pages}/{total_pages}")

    return {pos: state["result"] for pos, state in enumerate(page_states)}


def infer_run(cfg: Dict) -> Dict:
    run_dir = Path(cfg["_meta"]["run_dir"])
    run_meta_path = run_dir / "run_meta.json"
    if not run_meta_path.exists():
        prepare_run(cfg)

    prompt_map = load_prompt_map(cfg)
    tasks = read_jsonl(run_dir / "runtime" / "page_tasks.jsonl")
    engine = create_backend(cfg)
    engine.start()

    per_page: List[Dict] = []
    progress_every = max(1, int(cfg["logging"].get("progress_log_every", 20)))
    runtime_dir = run_dir / "runtime"
    crop_timing_path = runtime_dir / "crop_timing.jsonl"
    page_timing_path = runtime_dir / "page_timing.jsonl"
    page_workers = max(1, int(cfg["pipeline"].get("page_workers", 1) or 1))
    block_workers = max(1, int(cfg["pipeline"].get("max_workers", 1) or 1))


    queue_mode = str(
        cfg["pipeline"].get("queue_mode") or DEFAULT_CONFIG["pipeline"]["queue_mode"]
    ).lower()


    tts_cfg = cfg.get("tts") or {}
    rm_client = RMClient(tts_cfg) if tts_cfg.get("enabled") else None


    rm_caller, rm_batcher = build_rm_caller(tts_cfg, rm_client) if rm_client is not None else (None, None)
    if rm_client is not None:
        LOGGER.info("TTS enabled: n=%s rm_url=%s rm_batch=%s",
                    tts_cfg.get("n"), tts_cfg.get("rm_url"), tts_cfg.get("rm_batch") or "off")

    try:
        def _process_page(task: Dict) -> Dict:
            image_id = task["image_id"]
            page_started = time.time()
            layout_stage_sec = 0.0
            try:
                layout_t0 = time.time()
                layout = read_json(Path(task["layout_path"]), default={}) or {}
                blocks = layout.get("blocks", [])
                layout_stage_sec = time.time() - layout_t0

                crop_dir = Path(task["crop_dir"])
                md_path = run_dir / "output" / f"{image_id}.md"
                json_path = run_dir / "results_json" / f"{image_id}.json"
                if md_path.exists() and json_path.exists():
                    return _skipped_page_result(image_id, page_started, layout_stage_sec, len(blocks), md_path)

                if block_workers == 1 or len(blocks) <= 1:
                    block_outputs = [
                        _execute_block(engine, prompt_map, image_id, crop_dir, block,
                                       rm_client=rm_caller, tts_cfg=tts_cfg)
                        for block in blocks
                    ]
                else:
                    block_outputs_by_idx = {}
                    with ThreadPoolExecutor(max_workers=min(block_workers, len(blocks))) as executor:
                        _now = time.time()
                        futures = {
                            executor.submit(_execute_block, engine, prompt_map, image_id, crop_dir, block,
                                            rm_client=rm_caller, tts_cfg=tts_cfg,
                                            submitted_at=_now): i
                            for i, block in enumerate(blocks)
                        }
                        for future in as_completed(futures):
                            block_outputs_by_idx[futures[future]] = future.result()
                    block_outputs = [block_outputs_by_idx[i] for i in range(len(blocks))]

                return _finalize_page(
                    run_dir=run_dir,
                    image_id=image_id,
                    layout=layout,
                    blocks=blocks,
                    block_outputs=block_outputs,
                    prompt_map=prompt_map,
                    page_started=page_started,
                    layout_stage_sec=layout_stage_sec,
                )
            except Exception as e:
                return _failed_page_result(image_id, page_started, layout_stage_sec, str(e))

        page_results_by_idx = {}
        if queue_mode == "concurrent":
            page_results_by_idx = _infer_concurrent(
                run_dir=run_dir,
                tasks=tasks,
                engine=engine,
                prompt_map=prompt_map,
                request_workers=block_workers,
                progress_every=progress_every,
                rm_client=rm_caller,
                tts_cfg=tts_cfg,
            )
        elif page_workers == 1 or len(tasks) <= 1:
            for idx, task in enumerate(tasks, start=1):
                page_results_by_idx[idx - 1] = _process_page(task)
                if idx % progress_every == 0:
                    print(f"[infer] progress {idx}/{len(tasks)}")
        else:
            completed = 0
            with ThreadPoolExecutor(max_workers=min(page_workers, len(tasks))) as executor:
                futures = {executor.submit(_process_page, task): i for i, task in enumerate(tasks)}
                for future in as_completed(futures):
                    task_idx = futures[future]
                    try:
                        page_results_by_idx[task_idx] = future.result()
                    except Exception as e:
                        image_id = tasks[task_idx].get("image_id", f"task_{task_idx}")
                        failed_row = {
                            "image_id": image_id,
                            "status": "failed",
                            "page_total_wall_sec": 0.0,
                            "layout_stage_sec": 0.0,
                            "extract_prep_sec": 0.0,
                            "extract_infer_sec": 0.0,
                            "post_process_sec": 0.0,
                            "num_blocks": 0,
                            "num_vlm_blocks": 0,
                            "num_failed_blocks": 1,
                            "output_chars": 0,
                            "error": str(e),
                        }
                        page_results_by_idx[task_idx] = {
                            "page_row": failed_row,
                            "page_timing": {"image_id": image_id, "status": "failed", "duration_sec": 0.0, "error": str(e)},
                            "crop_rows": [],
                        }
                    completed += 1
                    if completed % progress_every == 0 or completed == len(tasks):
                        print(f"[infer] progress {completed}/{len(tasks)}")

        for idx in range(len(tasks)):
            result = page_results_by_idx[idx]
            per_page.append(result["page_row"])
            for crop_row in result.get("crop_rows", []):
                append_jsonl(crop_timing_path, crop_row)
            for dump in result.get("tts_dumps", []):
                append_jsonl(runtime_dir / "tts_candidates.jsonl", dump)
            append_jsonl(page_timing_path, result["page_timing"])
    finally:
        engine.stop()
        if rm_batcher is not None:
            rm_batcher.flush()
        if rm_client is not None:
            rm_client.close()

    metric_definition = read_json(run_meta_path, default={}).get("metric_definition", {})
    write_per_page_metrics(run_dir, per_page)
    summary = build_summary(per_page, planned_count=len(tasks), metric_definition=metric_definition)
    write_summary(run_dir, summary)

    _update_run_meta(
        run_meta_path,
        {
            "infer_finished_at": now_iso(),
            "counts": {
                "planned_pages": len(tasks),
                "ok_pages": sum(1 for x in per_page if x["status"] == "ok"),
                "failed_pages": sum(1 for x in per_page if x["status"] != "ok"),
            },
            "infer_summary": summary,
        },
    )
    return summary
