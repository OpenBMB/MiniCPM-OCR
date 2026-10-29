from __future__ import annotations

import shutil
import time
from pathlib import Path
from typing import Dict, List, Optional

from PIL import Image

from ._text import _normalize_and_dedupe_blocks
from ._tts import _execute_block_adaptive, _execute_block_tts
from ..backends import PNG_COMPRESS_LEVEL
from ..constants import IMAGE_LABELS
from ..postprocess.markdown import (
    assemble_markdown,
    has_mixed_inline_formula_content,
    image_render_mode,
    postprocess_content,
)
from ..prompts import get_element_cfg
from .._utils import classify_engine_text, ensure_dir, write_json


def _resize_image(image: Image.Image, target_min_side) -> Image.Image:
    if target_min_side is None:
        return image
    w, h = image.size
    if min(w, h) >= target_min_side:
        return image
    scale = target_min_side / min(w, h)
    return image.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)

def _block_priority(prompt_map: Dict, block: Dict) -> tuple:

    elem = get_element_cfg(prompt_map, block.get("label", ""))
    cap = int(elem["max_new_tokens"] or 0) if elem else 0
    area = int(block.get("crop_width", 0) or 0) * int(block.get("crop_height", 0) or 0)
    return (-cap, -area)

def _execute_block(engine, prompt_map: Dict, image_id: str, crop_dir: Path, block: Dict,
                   crop_array=None, rm_client=None, tts_cfg: Optional[Dict] = None,
                   submitted_at: Optional[float] = None,
                   prior_candidate: Optional[Dict] = None) -> Dict:

    label = block.get("label", "")
    elem_cfg = get_element_cfg(prompt_map, label)
    crop_filename = block.get("crop_filename", "")
    crop_path = crop_dir / crop_filename if crop_filename else None
    crop_started = time.time()


    queue_wait_sec = round(crop_started - submitted_at, 6) if submitted_at else 0.0

    if elem_cfg is None or block.get("skip_vlm", False):
        return {
            "result_block": {
                "label": label,
                "order": block.get("order", 0),
                "bbox": block.get("bbox"),
                "crop_filename": crop_filename,
                "status": "skipped_no_vlm",
                "content": "",
                "raw_content": "",
            },
            "crop_row": {
                "image_id": image_id,
                "label": label,
                "crop_filename": crop_filename,
                "status": "skipped_no_vlm",
                "duration_sec": 0.0,
            },
            "prep_sec": 0.0,
            "infer_sec": 0.0,
            "vlm_inc": 0,
            "failed_inc": 0,
        }

    vlm_inc = 1
    if crop_array is None and (not crop_path or not crop_path.exists()):
        return {
            "result_block": {
                "label": label,
                "order": block.get("order", 0),
                "bbox": block.get("bbox"),
                "crop_filename": crop_filename,
                "status": "missing_crop",
                "content": "",
                "raw_content": "",
            },
            "crop_row": {
                "image_id": image_id,
                "label": label,
                "crop_filename": crop_filename,
                "status": "missing_crop",
                "duration_sec": 0.0,
            },
            "prep_sec": 0.0,
            "infer_sec": 0.0,
            "vlm_inc": vlm_inc,
            "failed_inc": 1,
        }

    prep_t0 = time.time()
    if crop_array is not None:
        crop_image = Image.fromarray(crop_array).convert("RGB")
    else:
        crop_image = Image.open(crop_path).convert("RGB")
    model_input_image = _resize_image(crop_image, elem_cfg["resize_min_side"])


    rm_anchor = (tts_cfg or {}).get("rm_anchor_min_side")
    rm_input_image = (model_input_image if rm_anchor is None
                      else _resize_image(crop_image, rm_anchor))
    prep_sec = time.time() - prep_t0

    infer_status = "ok"
    raw_text = ""
    output_tokens = 0
    infer_sec = 0.0
    failed_inc = 0
    error_text = ""
    tts_info: Dict = {}
    request_metrics: Dict = {}
    try:
        infer_t0 = time.time()
        tts_on = bool(tts_cfg and tts_cfg.get("enabled") and rm_client is not None)
        n_total = int((tts_cfg or {}).get("n", 1)) if tts_on else 1
        adaptive_cfg = (tts_cfg or {}).get("adaptive") or {}
        adaptive_on = tts_on and bool(adaptive_cfg.get("enabled"))

        force_score = tts_on and bool((tts_cfg or {}).get("force_score"))
        case_id = "%s::%s" % (image_id, crop_filename or block.get("order", 0))

        if adaptive_on:
            raw_text, output_tokens, infer_sec, tts_info = _execute_block_adaptive(
                engine=engine,
                rm_client=rm_client,
                tts_cfg=tts_cfg,
                crop_image=crop_image,
                base_image=model_input_image,
                rm_image=rm_input_image,
                elem_cfg=elem_cfg,
                label=label,
                case_id=case_id,
                infer_t0=infer_t0,
                prior_candidate=prior_candidate,
            )
        elif not tts_on or (n_total <= 1 and not force_score):
            pred = engine.recognize(
                model_input_image,
                prompt=elem_cfg["prompt"],
                max_new_tokens=elem_cfg["max_new_tokens"],
                slice_nums=elem_cfg["slice_nums"],
            )
            infer_sec = time.time() - infer_t0
            raw_text = pred["text"]
            output_tokens = pred.get("output_token_count", 0)


            request_metrics = dict(pred.get("request_metrics") or {})
        else:
            raw_text, output_tokens, infer_sec, tts_info = _execute_block_tts(
                engine=engine,
                rm_client=rm_client,
                tts_cfg=tts_cfg,
                image=model_input_image,
                rm_image=rm_input_image,
                elem_cfg=elem_cfg,
                label=label,
                case_id=case_id,
                infer_t0=infer_t0,
            )


        raw_text, engine_error = classify_engine_text(raw_text)
        if engine_error is not None:
            infer_status = f"{engine.name}_error"
            failed_inc = 1
            error_text = engine_error
            output_tokens = 0
    except Exception as e:
        infer_status = f"{engine.name}_error"
        raw_text = ""
        failed_inc = 1
        error_text = str(e)
    finally:

        closed_ids = set()
        for img in (model_input_image, rm_input_image):
            if img is None or img is crop_image or id(img) in closed_ids:
                continue
            closed_ids.add(id(img))
            img.close()
        crop_image.close()

    post_t0 = time.time()
    content = postprocess_content(raw_text, elem_cfg["output_format"], label=label)
    post_sec = time.time() - post_t0


    crop_row = {
        "image_id": image_id,
        "label": label,
        "crop_filename": crop_filename,
        "status": infer_status,
        "duration_sec": round(time.time() - crop_started, 6),
        "queue_wait_sec": queue_wait_sec,
        "prep_sec": round(prep_sec, 6),
        "infer_sec": round(infer_sec, 6),
        "post_sec": round(post_sec, 6),
        "client_encode_sec": request_metrics.get("client_encode_sec", 0.0),
        "client_payload_build_sec": request_metrics.get("client_payload_build_sec", 0.0),
        "client_post_sec": request_metrics.get("client_post_sec", 0.0),
        "client_parse_sec": request_metrics.get("client_parse_sec", 0.0),
        "client_queue_wait_sec": request_metrics.get("client_queue_wait_sec", 0.0),
        "image_b64_bytes": request_metrics.get("image_b64_bytes", 0),
        "prompt_tokens": request_metrics.get("prompt_tokens", 0),
        "completion_tokens": request_metrics.get("completion_tokens", 0),
    }
    if infer_status != "ok":
        crop_row["error"] = error_text
    if tts_info:
        crop_row.update({
            "raw_candidate_count": tts_info.get("raw_candidate_count"),
            "n_candidates": tts_info.get("n_candidates"),
            "best_index": tts_info.get("best_index"),
            "greedy_sec": tts_info.get("greedy_sec"),
            "sample_sec": tts_info.get("sample_sec"),
            "rm_sec": tts_info.get("rm_sec"),
            "rm_wait_sec": tts_info.get("rm_wait_sec"),
            "rm_call_sec": tts_info.get("rm_call_sec"),
            "rm_used": tts_info.get("rm_used"),
            "rm_error": tts_info.get("rm_error"),
            "scores": tts_info.get("scores"),
            "rm_stage_sec": tts_info.get("rm_stage_sec"),
            "rm_batch_size": tts_info.get("rm_batch_size"),
            "rm_batch_items": tts_info.get("rm_batch_items"),
        })
        if tts_info.get("adaptive"):
            crop_row.update({
                "rounds_used": tts_info.get("rounds_used"),
                "stop_reason": tts_info.get("stop_reason"),
                "exhausted": tts_info.get("exhausted"),
                "best_score": tts_info.get("best_score"),
                "rm_calls": tts_info.get("rm_calls"),
                "round_log": tts_info.get("round_log"),
            })
        if tts_info.get("prior_injected"):
            crop_row["prior_injected"] = True

    result_block = {
        "label": label,
        "order": block.get("order", 0),
        "bbox": block.get("bbox"),
        "crop_filename": crop_filename,
        "status": infer_status,
        "content": content,
        "raw_content": raw_text,
        "inline_formula_mixed": (
            label == "inline_formula" and has_mixed_inline_formula_content(raw_text)
        ),
        "output_token_count": output_tokens,
    }
    if tts_info:
        result_block["tts"] = {
            "n_candidates": tts_info.get("n_candidates"),
            "best_index": tts_info.get("best_index"),
            "rm_used": tts_info.get("rm_used"),


            "rm_error": tts_info.get("rm_error"),
            "scores": tts_info.get("scores"),
            "verdicts": tts_info.get("verdicts"),


            "greedy_sec": tts_info.get("greedy_sec"),
            "sample_sec": tts_info.get("sample_sec"),
            "rm_sec": tts_info.get("rm_sec"),
            "rm_wait_sec": tts_info.get("rm_wait_sec"),
            "rm_call_sec": tts_info.get("rm_call_sec"),
            "rm_batch_items": tts_info.get("rm_batch_items"),


            "raw_candidate_count": tts_info.get("raw_candidate_count"),
            "rm_stage_sec": tts_info.get("rm_stage_sec"),
            "rm_batch_size": tts_info.get("rm_batch_size"),
        }
        if tts_info.get("adaptive"):
            result_block["tts"].update({
                "rounds_used": tts_info.get("rounds_used"),
                "stop_reason": tts_info.get("stop_reason"),


                "exhausted": tts_info.get("exhausted"),
                "best_score": tts_info.get("best_score"),
                "rm_calls": tts_info.get("rm_calls"),
            })
        if tts_info.get("prior_injected"):


            result_block["tts"]["prior_injected"] = True

    tts_dump = None
    if tts_info and (tts_cfg or {}).get("dump_candidates"):


        tts_dump = {
            "image_id": image_id,
            "case_id": "%s::%s" % (image_id, crop_filename or block.get("order", 0)),
            "label": label,
            "raw_candidate_count": tts_info.get("raw_candidate_count"),
            "n_candidates": tts_info.get("n_candidates"),
            "candidates": tts_info.get("deduped"),
            "candidates_raw": tts_info.get("candidates"),
            "scores": tts_info.get("scores"),
            "verdicts": tts_info.get("verdicts"),
            "best_index": tts_info.get("best_index"),
            "rm_used": tts_info.get("rm_used"),
            "rm_error": tts_info.get("rm_error"),
            "greedy_sec": tts_info.get("greedy_sec"),
            "sample_sec": tts_info.get("sample_sec"),
            "rm_sec": tts_info.get("rm_sec"),
            "rm_wait_sec": tts_info.get("rm_wait_sec"),
            "rm_call_sec": tts_info.get("rm_call_sec"),
            "rm_stage_sec": tts_info.get("rm_stage_sec"),
            "rm_batch_size": tts_info.get("rm_batch_size"),
            "rm_batch_items": tts_info.get("rm_batch_items"),
        }
        if tts_info.get("adaptive"):


            tts_dump.update({
                "adaptive": True,
                "rounds_used": tts_info.get("rounds_used"),
                "stop_reason": tts_info.get("stop_reason"),
                "exhausted": tts_info.get("exhausted"),
                "best_score": tts_info.get("best_score"),
                "tau": tts_info.get("tau"),
                "rm_calls": tts_info.get("rm_calls"),
                "round_log": tts_info.get("round_log"),
                "round_texts": tts_info.get("round_texts"),
            })
        if tts_info.get("prior_injected"):
            tts_dump["prior_injected"] = True

    return {
        "result_block": result_block,
        "crop_row": crop_row,
        "prep_sec": prep_sec,
        "infer_sec": infer_sec,
        "vlm_inc": vlm_inc,
        "failed_inc": failed_inc,
        "tts_dump": tts_dump,
    }

def _failed_block_output(image_id: str, block: Dict, error: str) -> Dict:
    label = block.get("label", "")
    crop_filename = block.get("crop_filename", "")
    return {
        "result_block": {
            "label": label,
            "order": block.get("order", 0),
            "bbox": block.get("bbox"),
            "crop_filename": crop_filename,
            "status": "failed",
            "content": "",
            "raw_content": "",
        },
        "crop_row": {
            "image_id": image_id,
            "label": label,
            "crop_filename": crop_filename,
            "status": "failed",
            "duration_sec": 0.0,
            "error": error,
        },
        "prep_sec": 0.0,
        "infer_sec": 0.0,
        "vlm_inc": 1,
        "failed_inc": 1,
        "tts_dump": None,
    }

def _skipped_page_result(image_id: str, page_started: float, layout_stage_sec: float, num_blocks: int, md_path: Path) -> Dict:
    row = {
        "image_id": image_id,
        "status": "ok",
        "page_total_wall_sec": round(time.time() - page_started, 6),
        "layout_stage_sec": round(layout_stage_sec, 6),
        "extract_prep_sec": 0.0,
        "extract_infer_sec": 0.0,
        "post_process_sec": 0.0,
        "num_blocks": num_blocks,
        "num_vlm_blocks": 0,
        "num_failed_blocks": 0,
        "output_chars": len(md_path.read_text(encoding="utf-8")),
        "error": "",
    }
    page_timing = {
        "image_id": image_id,
        "status": "skipped_existing",
        "duration_sec": row["page_total_wall_sec"],
    }
    return {"page_row": row, "page_timing": page_timing, "crop_rows": []}

def _failed_page_result(image_id: str, page_started: float, layout_stage_sec: float, error: str) -> Dict:
    row = {
        "image_id": image_id,
        "status": "failed",
        "page_total_wall_sec": round(time.time() - page_started, 6),
        "layout_stage_sec": round(layout_stage_sec, 6),
        "extract_prep_sec": 0.0,
        "extract_infer_sec": 0.0,
        "post_process_sec": 0.0,
        "num_blocks": 0,
        "num_vlm_blocks": 0,
        "num_failed_blocks": 1,
        "output_chars": 0,
        "error": error,
    }
    page_timing = {
        "image_id": image_id,
        "status": "failed",
        "duration_sec": row["page_total_wall_sec"],
        "error": error,
    }
    return {"page_row": row, "page_timing": page_timing, "crop_rows": []}


IMAGE_RENDITION_LABELS = IMAGE_LABELS + ("chart", "seal")


def _attach_output_images(run_dir: Path, image_id: str, blocks: List[Dict], prompt_map: Dict,
                          crop_arrays: Optional[Dict] = None) -> None:
    'Publish the crops markdown renders as images under output/imgs/ and record their paths.'
    assembly = prompt_map.get("markdown_assembly", {})
    if image_render_mode(assembly) != "reference":
        return
    ignore_labels = set(assembly.get("ignore_labels", []))
    crops_dir = run_dir / "runtime" / "intermediate" / "crops" / image_id
    imgs_dir = run_dir / "output" / "imgs" / image_id
    for block in blocks:
        label = block.get("label", "")
        if label not in IMAGE_RENDITION_LABELS or label in ignore_labels:
            continue
        if label in ("chart", "seal") and block.get("content"):
            continue
        crop_filename = block.get("crop_filename") or ""
        crop_array = (crop_arrays or {}).get(crop_filename)
        crop_path = crops_dir / crop_filename
        if not crop_filename or (crop_array is None and not crop_path.is_file()):
            continue
        try:
            x1, y1, x2, y2 = (int(round(float(v))) for v in (block.get("bbox") or [])[:4])
        except (TypeError, ValueError):
            continue
        name = "{:03d}_img_in_{}_box_{}_{}_{}_{}.png".format(
            int(block.get("order", 0)), label, x1, y1, x2, y2
        )
        ensure_dir(imgs_dir)
        if crop_array is not None:
            Image.fromarray(crop_array).save(imgs_dir / name, compress_level=PNG_COMPRESS_LEVEL)
        else:
            shutil.copyfile(crop_path, imgs_dir / name)
        block["image_path"] = f"imgs/{image_id}/{name}"


def _finalize_page(
    *,
    run_dir: Path,
    image_id: str,
    layout: Dict,
    blocks: List[Dict],
    block_outputs: List[Dict],
    prompt_map: Dict,
    page_started: float,
    layout_stage_sec: float,
    crop_arrays: Optional[Dict] = None,
) -> Dict:
    result_blocks = []
    crop_rows: List[Dict] = []
    tts_dumps: List[Dict] = []
    extract_prep_sec = 0.0
    extract_infer_sec = 0.0
    num_vlm_blocks = 0
    num_failed_blocks = 0


    tts_blocks = 0
    tts_multi_candidate = 0
    tts_rm_used = 0
    tts_rm_changed = 0
    tts_rm_failed = 0
    tts_rm_sec = 0.0
    tts_rm_wait_sec = 0.0
    tts_sample_sec = 0.0
    tts_render_sec = 0.0
    tts_forward_sec = 0.0
    queue_wait_sec = 0.0

    adaptive_blocks = 0
    adaptive_rounds_total = 0
    adaptive_passed = 0
    adaptive_exhausted = 0
    adaptive_rm_calls = 0

    for item in block_outputs:
        result_blocks.append(item["result_block"])
        extract_prep_sec += float(item["prep_sec"])
        extract_infer_sec += float(item["infer_sec"])
        num_vlm_blocks += int(item["vlm_inc"])
        num_failed_blocks += int(item["failed_inc"])
        crop_rows.append(item["crop_row"])
        if item.get("tts_dump"):
            tts_dumps.append(item["tts_dump"])
        queue_wait_sec += float(item["crop_row"].get("queue_wait_sec", 0.0) or 0.0)
        tts = item["result_block"].get("tts")
        if tts:
            tts_blocks += 1
            if int(tts.get("n_candidates") or 0) > 1:
                tts_multi_candidate += 1
            if tts.get("rm_used"):
                tts_rm_used += 1
                if int(tts.get("best_index") or 0) != 0:
                    tts_rm_changed += 1
            elif tts.get("rm_error"):


                tts_rm_failed += 1


            call_sec = tts.get("rm_call_sec")
            tts_rm_sec += float((call_sec if call_sec is not None else tts.get("rm_sec")) or 0.0)
            tts_rm_wait_sec += float(tts.get("rm_wait_sec") or 0.0)
            tts_sample_sec += float(tts.get("sample_sec") or 0.0)
            if tts.get("rounds_used") is not None:
                adaptive_blocks += 1
                adaptive_rounds_total += int(tts.get("rounds_used") or 0)
                adaptive_rm_calls += int(tts.get("rm_calls") or 0)
                if tts.get("stop_reason") == "passed":
                    adaptive_passed += 1
                if tts.get("exhausted"):
                    adaptive_exhausted += 1


            stage = tts.get("rm_stage_sec") or {}
            tts_render_sec += float(stage.get("render_sec") or 0.0)
            tts_forward_sec += float(stage.get("forward_sec") or 0.0)

    post_t0 = time.time()
    final_blocks = _normalize_and_dedupe_blocks(result_blocks)
    _attach_output_images(run_dir, image_id, final_blocks, prompt_map, crop_arrays)
    markdown = assemble_markdown(final_blocks, prompt_map)
    post_process_sec = time.time() - post_t0

    md_path = run_dir / "output" / f"{image_id}.md"
    json_path = run_dir / "results_json" / f"{image_id}.json"
    ensure_dir(md_path.parent)
    ensure_dir(json_path.parent)
    md_path.write_text(markdown, encoding="utf-8")
    result_obj = {
        "image_id": image_id,
        "image_width": layout.get("image_width"),
        "image_height": layout.get("image_height"),
        "source": layout.get("source"),
        "crop_blocks": final_blocks,
        "markdown": markdown,
        "result_stage": "infer_final",
    }
    write_json(json_path, result_obj)

    status = "ok" if num_failed_blocks == 0 else "partial_failed"
    row = {
        "image_id": image_id,
        "status": status,
        "page_total_wall_sec": round(time.time() - page_started, 6),
        "layout_stage_sec": round(layout_stage_sec, 6),
        "extract_prep_sec": round(extract_prep_sec, 6),
        "extract_infer_sec": round(extract_infer_sec, 6),
        "post_process_sec": round(post_process_sec, 6),
        "num_blocks": len(blocks),
        "num_vlm_blocks": num_vlm_blocks,
        "num_failed_blocks": num_failed_blocks,
        "output_chars": len(markdown),
        "queue_wait_sec": round(queue_wait_sec, 6),
        "tts_blocks": tts_blocks,
        "tts_multi_candidate": tts_multi_candidate,
        "tts_rm_used": tts_rm_used,
        "tts_rm_changed": tts_rm_changed,
        "adaptive_blocks": adaptive_blocks,
        "adaptive_rounds_total": adaptive_rounds_total,
        "adaptive_passed": adaptive_passed,
        "adaptive_exhausted": adaptive_exhausted,
        "adaptive_rm_calls": adaptive_rm_calls,
        "tts_rm_failed": tts_rm_failed,
        "tts_rm_sec": round(tts_rm_sec, 6),
        "tts_rm_wait_sec": round(tts_rm_wait_sec, 6),
        "tts_sample_sec": round(tts_sample_sec, 6),
        "tts_render_sec": round(tts_render_sec, 6),
        "tts_forward_sec": round(tts_forward_sec, 6),
        "error": "",
    }
    page_timing = {
        "image_id": image_id,
        "status": status,
        "duration_sec": row["page_total_wall_sec"],
        "num_blocks": len(blocks),
        "num_vlm_blocks": num_vlm_blocks,
        "num_failed_blocks": num_failed_blocks,
    }
    return {"page_row": row, "page_timing": page_timing, "crop_rows": crop_rows,
            "tts_dumps": tts_dumps}
