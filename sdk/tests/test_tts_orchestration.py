from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict, List, Optional

import pytest
from PIL import Image

SDK_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SDK_DIR))

from minicpmvocr.backends.dialects import CropRequest, build_vllm_payload, parse_openai_response  # noqa: E402
from minicpmvocr.pipeline.rm_client import category_for_label  # noqa: E402


DECODE_CFG = {
    "temperature": 0.01,
    "top_p": 0.001,
    "top_k": 1,
    "repetition_penalty": 1.0,
    "no_repeat_ngram_size": 100,
}
MM_CFG = {"downsample_mode": "4x", "max_slice_nums": 9}
ENGINE_CFG = {"model_name": "minicpm"}


def test_n1_payload_has_no_n_key():

    req = CropRequest(image_b64="Zm9v", prompt="p", max_tokens=128)
    payload = build_vllm_payload(req, ENGINE_CFG, MM_CFG, DECODE_CFG)
    assert "n" not in payload
    assert payload["temperature"] == 0.01
    assert payload["top_k"] == 1


def test_sampled_payload_carries_n_and_overrides():
    req = CropRequest(
        image_b64="Zm9v", prompt="p", max_tokens=128,
        n=3, decode_overrides={"temperature": 0.7, "top_p": 0.8, "top_k": 20},
    )
    payload = build_vllm_payload(req, ENGINE_CFG, MM_CFG, DECODE_CFG)
    assert payload["n"] == 3
    assert payload["temperature"] == 0.7
    assert payload["top_p"] == 0.8
    assert payload["top_k"] == 20

    assert payload["repetition_penalty"] == 1.0


def test_decode_overrides_do_not_mutate_shared_cfg():

    before = dict(DECODE_CFG)
    req = CropRequest(image_b64="Zm9v", prompt="p", max_tokens=128,
                      n=2, decode_overrides={"temperature": 0.9})
    build_vllm_payload(req, ENGINE_CFG, MM_CFG, DECODE_CFG)
    assert DECODE_CFG == before


def _openai_body(texts: List[str]) -> Dict:
    return {
        "choices": [
            {"message": {"content": t}, "finish_reason": "stop"} for t in texts
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
    }


def test_parse_response_returns_all_choices():
    parsed = parse_openai_response(_openai_body(["a", "b", "c"]))
    assert parsed["texts"] == ["a", "b", "c"]
    assert parsed["text"] == "a"


def test_parse_response_single_choice_still_gives_list():
    parsed = parse_openai_response(_openai_body(["only"]))
    assert parsed["texts"] == ["only"]
    assert parsed["text"] == "only"


def test_parse_response_empty_choices_raises():
    from minicpmvocr.backends.dialects import DialectError
    with pytest.raises(DialectError):
        parse_openai_response({"choices": []})


@pytest.mark.parametrize("label,expected", [
    ("text", "text"),
    ("title", "text"),
    ("table", "table"),
    ("isolate_formula", "formula"),
    ("inline_formula", "formula"),
    ("interline_equation", "formula"),
    ("display_formula", "formula"),
    ("something_unknown", "text"),
    ("", "text"),
])
def test_category_for_label(label, expected):
    assert category_for_label(label) == expected


_FORMULA_LABELS_FROM_LAYOUT = (
    "formula", "display_formula", "isolate_formula",
    "inline_formula", "interline_equation",
)


@pytest.mark.parametrize("label", _FORMULA_LABELS_FROM_LAYOUT)
def test_formula_labels_are_explicit_keys_not_fallbacks(label):
    from minicpmvocr.pipeline.rm_client import _CATEGORY_BY_LABEL
    assert label in _CATEGORY_BY_LABEL, (
        f"{label!r} 不在映射表里 —— .get(..., 'text') 会把它静默路由成文本渲染"
    )
    assert _CATEGORY_BY_LABEL[label] == "formula"


class FakeEngine:

    name = "vllm"

    def __init__(self, greedy_text: str, sampled_texts: Optional[List[str]] = None,
                 sampled_raises: bool = False):
        self.greedy_text = greedy_text
        self.sampled_texts = sampled_texts or []
        self.sampled_raises = sampled_raises
        self.calls: List[Dict] = []

    def recognize(self, image, prompt, max_new_tokens, slice_nums=None,
                  n=1, decode_overrides=None):
        self.calls.append({"n": n, "decode_overrides": decode_overrides})
        if n == 1:
            return {"text": self.greedy_text, "texts": [self.greedy_text],
                    "output_token_count": 5}
        if self.sampled_raises:
            raise RuntimeError("sampling blew up")
        return {"text": self.sampled_texts[0] if self.sampled_texts else "",
                "texts": list(self.sampled_texts), "output_token_count": 7}


class FakeRM:
    def __init__(self, best_index: Optional[int] = 0, scores=None, fail: bool = False):
        self.best_index = best_index
        self.scores = scores or []
        self.fail = fail
        self.calls: List[Dict] = []

    def score_best(self, image, candidates, label, case_id="", force=False):


        self.calls.append({"candidates": list(candidates), "label": label,
                           "force": force})
        if self.fail:
            return None
        return {"best_index": self.best_index, "best_text": candidates[self.best_index],
                "scores": self.scores, "verdicts": ["scored"] * len(candidates)}


ELEM_CFG = {"prompt": "p", "max_new_tokens": 128, "slice_nums": 9, "output_format": "markdown"}
TTS_CFG = {"enabled": True, "n": 4, "sampling": {"temperature": 0.7, "top_p": 0.8, "top_k": 20},
           "rm_url": "http://rm", "timeout_sec": 30, "fallback_to_greedy": True}


def _run_tts(engine, rm, tts_cfg=None):
    import time
    from minicpmvocr.pipeline._tts import _execute_block_tts
    img = Image.new("RGB", (8, 8))
    return _execute_block_tts(
        engine=engine, rm_client=rm, tts_cfg=tts_cfg or TTS_CFG,
        image=img, elem_cfg=ELEM_CFG, label="text",
        case_id="page::block", infer_t0=time.time(),
    )


def test_tts_sends_two_requests_greedy_then_sampled():
    engine = FakeEngine("greedy", ["s1", "s2", "s3"])
    rm = FakeRM(best_index=0)
    _run_tts(engine, rm)

    assert len(engine.calls) == 2

    assert engine.calls[0]["n"] == 1
    assert engine.calls[0]["decode_overrides"] is None

    assert engine.calls[1]["n"] == 3
    assert engine.calls[1]["decode_overrides"]["temperature"] == 0.7


def test_tts_picks_rm_choice():
    engine = FakeEngine("greedy", ["s1", "s2", "s3"])
    rm = FakeRM(best_index=2, scores=[0.1, 0.2, 0.9, 0.3])
    best_text, tokens, _sec, info = _run_tts(engine, rm)

    assert best_text == "s2"
    assert info["best_index"] == 2
    assert info["rm_used"] is True
    assert info["n_candidates"] == 4
    assert tokens == 12


def test_tts_dedupes_candidates_keeping_greedy_first():
    engine = FakeEngine("same", ["same", "other", ""])
    rm = FakeRM(best_index=0)
    _best, _tokens, _sec, info = _run_tts(engine, rm)

    assert info["n_candidates"] == 2
    assert rm.calls[0]["candidates"] == ["same", "other"]


def test_tts_falls_back_to_greedy_when_rm_unavailable():
    engine = FakeEngine("greedy", ["s1", "s2", "s3"])
    rm = FakeRM(fail=True)
    best_text, _tokens, _sec, info = _run_tts(engine, rm)
    assert best_text == "greedy"
    assert info["best_index"] == 0
    assert info["rm_used"] is False


def test_tts_survives_sampling_failure():

    engine = FakeEngine("greedy", sampled_raises=True)
    rm = FakeRM(best_index=0)
    best_text, _tokens, _sec, info = _run_tts(engine, rm)
    assert best_text == "greedy"
    assert info["n_candidates"] == 1

    assert rm.calls == []


def test_tts_records_stage_timings():
    engine = FakeEngine("greedy", ["s1"])
    rm = FakeRM(best_index=0)
    _best, _tokens, _sec, info = _run_tts(engine, rm)
    for key in ("greedy_sec", "sample_sec", "rm_sec"):
        assert key in info and info[key] >= 0.0


def _run_execute_block(tmp_path, engine, rm, tts_cfg=None):
    from minicpmvocr.pipeline._blocks import _execute_block
    crop_dir = tmp_path
    crop_name = "000_text.png"
    Image.new("RGB", (16, 16)).save(crop_dir / crop_name)
    prompt_map = {"default": {"prompt": "p", "max_new_tokens": 128, "slice_nums": 9,
                              "output_format": "markdown", "resize_min_side": None}}
    block = {"label": "text", "order": 0, "bbox": [0, 0, 16, 16], "crop_filename": crop_name}
    return _execute_block(engine, prompt_map, "page_001", crop_dir, block,
                          rm_client=rm, tts_cfg=tts_cfg or TTS_CFG)


def test_execute_block_with_tts_enabled_actually_runs(tmp_path):
    engine = FakeEngine("greedy", ["s1", "s2", "s3"])
    rm = FakeRM(best_index=1, scores=[0.1, 0.9, 0.2, 0.3])

    out = _run_execute_block(tmp_path, engine, rm)

    assert out["crop_row"]["status"] == "ok", (
        f"TTS 分支没跑通: {out['crop_row'].get('error')!r} —— "
        "宽 except 会把任何编排 bug 记成引擎错误，别被 'vllm_error' 误导"
    )
    assert out["result_block"]["status"] == "ok"
    assert out["result_block"]["raw_content"] == "s1", "应取 RM 选中的候选"
    assert engine.calls[0]["n"] == 1 and engine.calls[1]["n"] == 3, "贪心 1 次 + 采样 N-1 一次"
    assert rm.calls, "RM 必须被调到"


def test_execute_block_tts_off_takes_single_request_path(tmp_path):
    engine = FakeEngine("greedy")
    out = _run_execute_block(tmp_path, engine, rm=None,
                             tts_cfg={**TTS_CFG, "enabled": False})

    assert out["crop_row"]["status"] == "ok"
    assert out["result_block"]["raw_content"] == "greedy"
    assert len(engine.calls) == 1 and engine.calls[0]["n"] == 1


def test_single_candidate_skips_rm_by_default():

    engine = FakeEngine("SAME", ["SAME", "SAME", "SAME"])
    rm = FakeRM()
    _text, _tokens, _sec, info = _run_tts(engine, rm)
    assert info["n_candidates"] == 1
    assert rm.calls == [], "单候选却调了 RM —— 老路径的成本形态被改变了"
    assert info["rm_used"] is False


def test_force_score_scores_even_a_single_candidate():

    engine = FakeEngine("SAME", ["SAME", "SAME", "SAME"])
    rm = FakeRM(best_index=0, scores=[0.77])
    cfg = dict(TTS_CFG)
    cfg["force_score"] = True
    _text, _tokens, _sec, info = _run_tts(engine, rm, tts_cfg=cfg)
    assert info["n_candidates"] == 1
    assert len(rm.calls) == 1, "force_score 开着却没打分 ⇒ 直通率无从算起"
    assert rm.calls[0]["force"] is True
    assert info["scores"] == [0.77]
    assert info["rm_used"] is True
