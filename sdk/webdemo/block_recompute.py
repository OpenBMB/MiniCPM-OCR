from __future__ import annotations

import copy
import json
import time
from pathlib import Path
from typing import Dict, Optional

from minicpmvocr import assemble_markdown, load_prompt_map
from minicpmvocr._utils import append_jsonl, write_json
from minicpmvocr.pipeline._blocks import _execute_block
from minicpmvocr.pipeline._text import _normalize_and_dedupe_blocks
from minicpmvocr.pipeline.rm_client import RMClient


def _prior_from_block(block: Dict) -> Optional[Dict]:

    tts = block.get("tts") or {}
    text = block.get("raw_content") or ""
    idx = tts.get("best_index")
    scores = tts.get("scores") or []
    verdicts = tts.get("verdicts") or []
    picked = isinstance(idx, int) and 0 <= idx < len(scores)
    score = tts.get("best_score")
    if score is None and picked:
        score = scores[idx]


    verdict = verdicts[idx] if picked and idx < len(verdicts) else "scored"
    if not text or score is None or tts.get("rm_error") or verdict != "scored":
        return None
    return {"text": text, "score": float(score), "verdict": verdict}


def _tts_cfg_for(tts_cfg: Dict, prefilled: bool) -> Dict:

    cfg = copy.deepcopy(tts_cfg)
    rounds = list((cfg.get("adaptive") or {}).get("rounds") or [])
    if rounds:
        first = dict(rounds[0])
        if prefilled:
            first["prefilled"] = True
        else:
            first.pop("prefilled", None)
        rounds[0] = first
        cfg["adaptive"]["rounds"] = rounds

    cfg["rm_batch"] = {"max_items": 1}
    return cfg


def rerun_block(cfg: Dict, run_dir, image_id: str, order: int, *,
                engine, rm_client: Optional[RMClient] = None) -> Dict:
    'Recompute one block of a finished run with adaptive resampling.'
    tts_cfg = cfg.get("tts") or {}
    if not (tts_cfg.get("enabled") and (tts_cfg.get("adaptive") or {}).get("enabled")):
        raise ValueError("rerun_block 需要 tts.enabled 与 tts.adaptive.enabled 都为真")

    run_dir = Path(run_dir)
    inter = run_dir / "runtime" / "intermediate"
    layout = json.loads((inter / "layouts" / f"{image_id}.json").read_text(encoding="utf-8"))
    result_path = run_dir / "results_json" / f"{image_id}.json"
    result = json.loads(result_path.read_text(encoding="utf-8"))

    layout_block = next((b for b in layout.get("blocks", []) if b.get("order") == order), None)
    if layout_block is None:
        raise KeyError(f"{image_id} 没有 order={order} 的版面块")
    crop_blocks = result.get("crop_blocks") or []
    old_idx = next((i for i, b in enumerate(crop_blocks) if b.get("order") == order), None)
    old_block = crop_blocks[old_idx] if old_idx is not None else {}

    prompt_map = load_prompt_map(cfg)
    prior = _prior_from_block(old_block)
    run_tts_cfg = _tts_cfg_for(tts_cfg, prefilled=prior is not None)
    own_client = rm_client is None
    client = RMClient(run_tts_cfg) if own_client else rm_client
    try:
        out = _execute_block(
            engine, prompt_map, image_id, inter / "crops" / image_id,
            layout_block, rm_client=client, tts_cfg=run_tts_cfg,
            prior_candidate=prior,
        )
    finally:
        if own_client:
            client.close()

    new_block = out["result_block"]
    if "upright" in old_block:
        new_block["upright"] = old_block["upright"]
    if old_idx is None:
        crop_blocks.append(new_block)
    else:
        crop_blocks[old_idx] = new_block
    final_blocks = _normalize_and_dedupe_blocks(crop_blocks)
    markdown = assemble_markdown(final_blocks, prompt_map)

    result["crop_blocks"] = final_blocks
    result["markdown"] = markdown
    write_json(result_path, result)
    (run_dir / "output" / f"{image_id}.md").write_text(markdown, encoding="utf-8")

    record = {
        "image_id": image_id,
        "order": order,
        "rerun_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "prior_used": prior is not None,
        "replaced": old_block,
        "result_block": new_block,
    }
    if out.get("tts_dump"):
        record["tts_dump"] = out["tts_dump"]
    append_jsonl(run_dir / "runtime" / "block_reruns.jsonl", record)
    return {"result_block": new_block, "prior_used": prior is not None, "replaced": old_block}


__all__ = ["rerun_block"]
