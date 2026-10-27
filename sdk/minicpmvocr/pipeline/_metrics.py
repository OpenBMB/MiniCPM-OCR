import csv
from pathlib import Path
from typing import Dict, List

from .._utils import mean, percentile, write_json


PER_PAGE_FIELDS = [
    "image_id",
    "status",
    "page_total_wall_sec",
    "layout_stage_sec",
    "extract_prep_sec",
    "extract_infer_sec",
    "post_process_sec",
    "queue_wait_sec",
    "num_blocks",
    "num_vlm_blocks",
    "num_failed_blocks",
    "output_chars",
    "tts_blocks",
    "tts_multi_candidate",
    "tts_rm_used",
    "tts_rm_changed",
    "tts_rm_sec",
    "tts_sample_sec",
    "tts_render_sec",
    "tts_forward_sec",
    "adaptive_blocks",
    "adaptive_rounds_total",
    "adaptive_passed",
    "adaptive_exhausted",
    "adaptive_rm_calls",
    "error",
]


def write_per_page_metrics(run_dir: Path, rows: List[Dict]) -> None:
    jsonl_path = run_dir / "per_page_metrics.jsonl"
    csv_path = run_dir / "per_page_metrics.csv"

    with jsonl_path.open("w", encoding="utf-8") as jf:
        for row in rows:
            jf.write(f"{__import__('json').dumps(row, ensure_ascii=False)}\n")

    with csv_path.open("w", encoding="utf-8", newline="") as cf:
        writer = csv.DictWriter(cf, fieldnames=PER_PAGE_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in PER_PAGE_FIELDS})


def _tts_summary(rows: List[Dict]) -> Dict:

    blocks = sum(int(r.get("tts_blocks", 0) or 0) for r in rows)
    if not blocks:
        return {}
    multi = sum(int(r.get("tts_multi_candidate", 0) or 0) for r in rows)
    used = sum(int(r.get("tts_rm_used", 0) or 0) for r in rows)
    changed = sum(int(r.get("tts_rm_changed", 0) or 0) for r in rows)
    rm_sec = sum(float(r.get("tts_rm_sec", 0.0) or 0.0) for r in rows)
    render_sec = sum(float(r.get("tts_render_sec", 0.0) or 0.0) for r in rows)
    forward_sec = sum(float(r.get("tts_forward_sec", 0.0) or 0.0) for r in rows)
    out = {
        "blocks": blocks,
        "multi_candidate": multi,
        "multi_candidate_rate": round(multi / blocks, 6),
        "rm_used": used,
        "rm_used_rate": round(used / blocks, 6),
        "rm_changed": changed,
        "rm_changed_rate": round(changed / used, 6) if used else 0.0,
        "sample_sec_total": round(sum(float(r.get("tts_sample_sec", 0.0) or 0.0) for r in rows), 6),
        "rm_sec_total": round(rm_sec, 6),


        "rm_render_sec_total": round(render_sec, 6),
        "rm_forward_sec_total": round(forward_sec, 6),
        "rm_render_share": round(render_sec / rm_sec, 6) if rm_sec else 0.0,
    }
    out.update(_adaptive_summary(rows))
    return out


def _adaptive_summary(rows: List[Dict]) -> Dict:

    blocks = sum(int(r.get("adaptive_blocks", 0) or 0) for r in rows)
    if not blocks:
        return {}
    rounds_total = sum(int(r.get("adaptive_rounds_total", 0) or 0) for r in rows)
    passed = sum(int(r.get("adaptive_passed", 0) or 0) for r in rows)
    exhausted = sum(int(r.get("adaptive_exhausted", 0) or 0) for r in rows)
    rm_calls = sum(int(r.get("adaptive_rm_calls", 0) or 0) for r in rows)
    return {
        "adaptive_blocks": blocks,

        "adaptive_rounds_mean": round(rounds_total / blocks, 6),
        "adaptive_rounds_total": rounds_total,
        "adaptive_passed": passed,
        "adaptive_passed_rate": round(passed / blocks, 6),
        "adaptive_exhausted": exhausted,
        "adaptive_exhausted_rate": round(exhausted / blocks, 6),

        "adaptive_rm_calls": rm_calls,
        "adaptive_rm_calls_per_block": round(rm_calls / blocks, 6),
    }


def build_summary(rows: List[Dict], planned_count: int, metric_definition: Dict) -> Dict:
    ok_rows = [r for r in rows if r.get("status") == "ok"]
    fail_rows = [r for r in rows if r.get("status") != "ok"]
    wall = [float(r.get("page_total_wall_sec", 0.0)) for r in ok_rows]


    failed_blocks = sum(int(r.get("num_failed_blocks", 0) or 0) for r in rows)
    pages_with_failed_blocks = sum(
        1 for r in rows if int(r.get("num_failed_blocks", 0) or 0) > 0
    )
    total_blocks = sum(int(r.get("num_blocks", 0) or 0) for r in rows)
    total_vlm_blocks = sum(int(r.get("num_vlm_blocks", 0) or 0) for r in rows)

    summary = {
        "counts": {
            "planned": planned_count,
            "ok": len(ok_rows),
            "failed": len(fail_rows),
            "blocks": total_blocks,
            "vlm_blocks": total_vlm_blocks,
            "failed_blocks": failed_blocks,
            "pages_with_failed_blocks": pages_with_failed_blocks,
        },
        "timing_sec": {
            "mean": round(mean(wall), 6),
            "median": round(percentile(wall, 0.5), 6),
            "p90": round(percentile(wall, 0.9), 6),
        },
        "stage_sec_total": {


            "layout": round(sum(float(r.get("layout_stage_sec", 0.0) or 0.0) for r in rows), 6),
            "extract_prep": round(sum(float(r.get("extract_prep_sec", 0.0) or 0.0) for r in rows), 6),
            "extract_infer": round(sum(float(r.get("extract_infer_sec", 0.0) or 0.0) for r in rows), 6),
            "post_process": round(sum(float(r.get("post_process_sec", 0.0) or 0.0) for r in rows), 6),
            "queue_wait": round(sum(float(r.get("queue_wait_sec", 0.0) or 0.0) for r in rows), 6),
        },
        "extract": {


            "ocr_calls": total_vlm_blocks,
            "chars": sum(int(r.get("output_chars", 0) or 0) for r in rows),
        },
        "metric_definition": metric_definition,
    }
    tts = _tts_summary(rows)
    if tts:
        summary["tts"] = tts
    return summary


def write_summary(run_dir: Path, summary: Dict) -> None:
    write_json(run_dir / "summary.json", summary)
