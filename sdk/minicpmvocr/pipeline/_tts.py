from __future__ import annotations

import hashlib
import logging
import time
from typing import Dict, List, Optional

from PIL import Image

LOGGER = logging.getLogger(__name__)

_ROUND_MIX = 0x9E3779B97F4A7C15


def _round_seed(case_id: str, round_idx: int, seed_base: int) -> int:

    digest = hashlib.blake2b(case_id.encode("utf-8"), digest_size=8).digest()
    mixed = int.from_bytes(digest, "big") ^ (round_idx * _ROUND_MIX) ^ int(seed_base)

    return mixed & 0x7FFF_FFFF

def _best_scored(texts: List[str], score_by_text: Dict[str, float],
                 verdict_by_text: Dict[str, str]):


    use_verdict = bool(verdict_by_text)
    best_t, best_s = None, None
    for text in texts:
        if use_verdict and verdict_by_text.get(text) != "scored":
            continue
        score = score_by_text.get(text)
        if score is None:
            continue
        if best_s is None or score > best_s:
            best_t, best_s = text, score
    return best_t, best_s

def _execute_block_tts(*, engine, rm_client, tts_cfg: Dict, image, elem_cfg: Dict,
                       label: str, case_id: str, infer_t0: float, rm_image=None):

    n_total = int(tts_cfg.get("n", 4))
    sampling = dict(tts_cfg.get("sampling") or {})
    force_score = bool(tts_cfg.get("force_score"))
    if rm_image is None:
        rm_image = image

    greedy_t0 = time.time()
    greedy = engine.recognize(
        image,
        prompt=elem_cfg["prompt"],
        max_new_tokens=elem_cfg["max_new_tokens"],
        slice_nums=elem_cfg["slice_nums"],
    )
    greedy_sec = time.time() - greedy_t0
    candidates = [greedy["text"]]
    output_tokens = greedy.get("output_token_count", 0)

    sample_sec = 0.0
    if n_total > 1:
        sample_t0 = time.time()
        try:
            sampled = engine.recognize(
                image,
                prompt=elem_cfg["prompt"],
                max_new_tokens=elem_cfg["max_new_tokens"],
                slice_nums=elem_cfg["slice_nums"],
                n=n_total - 1,
                decode_overrides=sampling,
            )
            candidates.extend(sampled.get("texts") or [])
            output_tokens += sampled.get("output_token_count", 0)
        except Exception as err:

            LOGGER.warning("TTS sampling failed (%s), continuing with greedy only", err)
        sample_sec = time.time() - sample_t0


    deduped = [candidates[0]]
    for text in candidates[1:]:
        if text and text not in deduped:
            deduped.append(text)

    rm_sec = 0.0
    rm_wait_sec = 0.0
    rm_call_sec = 0.0
    best_index = 0
    rm_used = False
    rm_error = None
    scores: list = []
    verdicts: list = []
    rm_stage_sec: Dict = {}
    rm_batch_size = 0
    rm_batch_items = 0

    if len(deduped) > 1 or force_score:
        rm_t0 = time.time()
        picked = rm_client.score_best(rm_image, deduped, label,
                                      case_id=case_id, force=force_score)
        rm_sec = time.time() - rm_t0
        if picked is not None:
            best_index = picked["best_index"]


            rm_wait_sec = float(picked.get("wait_sec") or 0.0)
            rm_call_sec = float(picked.get("call_sec") or 0.0)
            rm_error = picked.get("error")
            if rm_error:


                LOGGER.warning("RM call failed for case_id=%s: %s", case_id, rm_error)
            else:
                scores = picked.get("scores") or []
                verdicts = picked.get("verdicts") or []
                rm_stage_sec = picked.get("stage_sec") or {}
                rm_batch_size = int(picked.get("batch_size") or 0)
                rm_batch_items = int(picked.get("batch_items") or 0)
                rm_used = True

    infer_sec = time.time() - infer_t0
    tts_info = {
        "raw_candidate_count": len(candidates),
        "n_candidates": len(deduped),
        "best_index": best_index,
        "greedy_sec": round(greedy_sec, 6),
        "sample_sec": round(sample_sec, 6),
        "rm_sec": round(rm_sec, 6),
        "rm_wait_sec": round(rm_wait_sec, 6),
        "rm_call_sec": round(rm_call_sec, 6),
        "rm_used": rm_used,
        "rm_error": rm_error,
        "scores": scores,
        "verdicts": verdicts,


        "rm_stage_sec": rm_stage_sec,
        "rm_batch_size": rm_batch_size,
        "rm_batch_items": rm_batch_items,


        "candidates": candidates,
        "deduped": deduped,
    }
    return deduped[best_index], output_tokens, infer_sec, tts_info

def _execute_block_adaptive(*, engine, rm_client, tts_cfg: Dict, crop_image,
                            base_image, rm_image, elem_cfg: Dict, label: str,
                            case_id: str, infer_t0: float,
                            prior_candidate: Optional[Dict] = None):

    ad = dict(tts_cfg.get("adaptive") or {})
    rounds = list(ad.get("rounds") or [])
    n_max = ad.get("n_max") or len(rounds)
    n_max = max(1, min(int(n_max), len(rounds)))
    tau = float(ad.get("tau", 0.98))
    seed_base = int(ad.get("seed_base", 0))


    prefilled_declared = any(bool(r.get("prefilled")) for r in rounds[:n_max]
                             if isinstance(r, dict))
    if prefilled_declared:
        if not prior_candidate or not prior_candidate.get("text"):
            raise ValueError(
                "轮次表第 1 轮标了 prefilled,但 prior_candidate 没给文本。"
                "prefilled 轮不跑 OCR,先验候选就是这一轮的全部产出。")
        if prior_candidate.get("score") is None:
            raise ValueError(
                "prior_candidate 没给 score。先验分既是停止准则的输入,"
                "也是'返回分 ≥ 先验分'这条不劣化保证的基准,缺了就无从比较。")

    seen: List[str] = []
    seen_set = set()
    score_by_text: Dict[str, float] = {}
    verdict_by_text: Dict[str, str] = {}
    round_log: List[Dict] = []
    round_texts: List[List[str]] = []

    opened_images: List = []
    output_tokens = 0
    greedy_sec = 0.0
    sample_sec_total = 0.0
    rm_sec_total = rm_wait_total = rm_call_total = 0.0
    rm_used = False
    rm_error = None
    rm_calls = 0
    raw_candidate_count = 0
    last_stage_sec: Dict = {}
    last_batch_size = last_batch_items = 0
    best_text = best_score = None
    stop_reason = None
    rounds_used = 0

    try:
        for idx in range(1, n_max + 1):
            spec = dict(rounds[idx - 1])
            rounds_used = idx
            raw_texts: List[str] = []
            ocr_error = None
            r_t0 = time.time()

            prefilled = bool(spec.get("prefilled"))

            if prefilled:


                raw_texts = [prior_candidate["text"]]
            elif spec.get("greedy"):

                try:
                    pred = engine.recognize(
                        base_image,
                        prompt=elem_cfg["prompt"],
                        max_new_tokens=elem_cfg["max_new_tokens"],
                        slice_nums=elem_cfg["slice_nums"],
                    )
                    raw_texts = [pred["text"]]
                    output_tokens += pred.get("output_token_count", 0)
                except Exception as err:
                    ocr_error = "%s: %s" % (type(err).__name__, err)
                    LOGGER.warning("greedy round failed for %s: %s", case_id, ocr_error)
            else:


                scale = float(spec.get("scale", 1.0) or 1.0)
                ocr_img = base_image
                if scale != 1.0:
                    width, height = base_image.size
                    ocr_img = base_image.resize(
                        (max(1, int(round(width * scale))),
                         max(1, int(round(height * scale)))),
                        Image.Resampling.LANCZOS)
                    opened_images.append(ocr_img)
                overrides = {key: spec[key] for key in
                             ("temperature", "top_k", "top_p", "min_p") if key in spec}
                overrides["seed"] = _round_seed(case_id, idx, seed_base)
                n_req = int(spec.get("n", 1))
                try:
                    sampled = engine.recognize(
                        ocr_img,
                        prompt=elem_cfg["prompt"],
                        max_new_tokens=elem_cfg["max_new_tokens"],
                        slice_nums=elem_cfg["slice_nums"],
                        n=n_req,
                        decode_overrides=overrides,
                    )
                    raw_texts = list(sampled.get("texts") or [])
                    output_tokens += sampled.get("output_token_count", 0)
                except Exception as err:
                    ocr_error = "%s: %s" % (type(err).__name__, err)
                    LOGGER.warning("sampling round %d failed for %s: %s",
                                   idx, case_id, ocr_error)


            r_sample_sec = time.time() - r_t0
            if prefilled:

                r_sample_sec = 0.0
                greedy_sec = 0.0
            elif spec.get("greedy"):
                greedy_sec = r_sample_sec
            else:
                sample_sec_total += r_sample_sec
            raw_candidate_count += len(raw_texts)


            new_texts: List[str] = []
            for text in raw_texts:
                if not text or text in seen_set:
                    continue
                seen_set.add(text)
                seen.append(text)
                new_texts.append(text)
            round_texts.append(new_texts)


            r_rm_sec = 0.0
            if prefilled:


                for text in new_texts:
                    score_by_text[text] = float(prior_candidate["score"])
                    verdict_by_text[text] = prior_candidate.get("verdict") or "scored"


            elif new_texts:
                rm_t0 = time.time()
                picked = rm_client.score_best(
                    rm_image, new_texts, label,
                    case_id="%s#r%d" % (case_id, idx), force=True)
                r_rm_sec = time.time() - rm_t0
                rm_sec_total += r_rm_sec
                if picked is not None:
                    rm_calls += 1
                    rm_wait_total += float(picked.get("wait_sec") or 0.0)
                    rm_call_total += float(picked.get("call_sec") or 0.0)
                    err = picked.get("error")
                    if err:
                        rm_error = err
                        LOGGER.warning("RM call failed for case_id=%s#r%d: %s",
                                       case_id, idx, err)
                    else:
                        rm_used = True
                        scores = picked.get("scores") or []
                        verdicts = picked.get("verdicts") or []
                        last_stage_sec = picked.get("stage_sec") or last_stage_sec
                        last_batch_size = int(picked.get("batch_size") or 0) or last_batch_size
                        last_batch_items = int(picked.get("batch_items") or 0) or last_batch_items
                        for i, text in enumerate(new_texts):
                            if i < len(scores):
                                score_by_text[text] = float(scores[i])
                            if i < len(verdicts):
                                verdict_by_text[text] = verdicts[i]

            best_text, best_score = _best_scored(seen, score_by_text, verdict_by_text)
            entry = {
                "round": idx,
                "greedy": bool(spec.get("greedy")),
                "temperature": spec.get("temperature"),
                "scale": float(spec.get("scale", 1.0) or 1.0),
                "n_req": 1 if spec.get("greedy") else int(spec.get("n", 1)),
                "raw_n": len(raw_texts),


                "new_n": len(new_texts),
                "cum_unique": len(seen),
                "rm_calls": 0 if prefilled else (1 if new_texts else 0),
                "best_score": best_score,
                "sample_sec": round(r_sample_sec, 6),
                "rm_sec": round(r_rm_sec, 6),
                "ocr_error": ocr_error,
            }
            if prefilled:
                entry["prefilled"] = True
            round_log.append(entry)

            if ocr_error and not seen:
                stop_reason = "ocr_error"
                break
            if best_score is not None and best_score >= tau:
                stop_reason = "passed"
                break
        else:
            stop_reason = "exhausted"
    finally:
        for img in opened_images:
            try:
                img.close()
            except Exception:
                pass

    if best_text is None:

        best_text = seen[0] if seen else ""
        best_index = 0
        if stop_reason not in ("ocr_error",):
            stop_reason = "no_scored"
    else:
        best_index = seen.index(best_text)

    infer_sec = time.time() - infer_t0


    exhausted = stop_reason == "exhausted"
    tts_info = {
        "raw_candidate_count": raw_candidate_count,
        "n_candidates": len(seen),
        "best_index": best_index,
        "greedy_sec": round(greedy_sec, 6),
        "sample_sec": round(sample_sec_total, 6),
        "rm_sec": round(rm_sec_total, 6),
        "rm_wait_sec": round(rm_wait_total, 6),
        "rm_call_sec": round(rm_call_total, 6),
        "rm_used": rm_used,
        "rm_error": rm_error,
        "scores": [score_by_text.get(t) for t in seen],
        "verdicts": [verdict_by_text.get(t) for t in seen],
        "rm_stage_sec": last_stage_sec,
        "rm_batch_size": last_batch_size,
        "rm_batch_items": last_batch_items,
        "candidates": list(seen),
        "deduped": list(seen),

        "adaptive": True,
        "rounds_used": rounds_used,
        "round_log": round_log,
        "stop_reason": stop_reason,
        "exhausted": exhausted,
        "best_score": best_score,
        "tau": tau,
        "rm_calls": rm_calls,
        "round_texts": round_texts,
    }
    if prefilled_declared:


        tts_info["prior_injected"] = True
    return best_text, output_tokens, infer_sec, tts_info
