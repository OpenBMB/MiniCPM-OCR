from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from minicpmvocr.config import _validate_adaptive  # noqa: E402
from minicpmvocr.pipeline._tts import (  # noqa: E402
    _execute_block_adaptive,
    _round_seed,
)

ELEM_CFG = {
    "prompt": "p",
    "max_new_tokens": 64,
    "slice_nums": 1,
    "resize_min_side": 100,
    "output_format": "md",
}

PRIOR_TEXT = "PRIOR_GREEDY_TEXT"
PRIOR_SCORE = 0.4218375


def _img():
    return Image.new("RGB", (120, 120), "white")


class FakeEngine:


    def __init__(self, greedy_text="G"):
        self.greedy_text = greedy_text
        self.calls = []

    def recognize(self, image, prompt=None, max_new_tokens=None, slice_nums=None,
                  n=None, decode_overrides=None):
        if n is None:
            self.calls.append({"kind": "greedy", "seed": None})
            return {"text": self.greedy_text, "output_token_count": 1}
        seed = (decode_overrides or {}).get("seed")
        self.calls.append({"kind": "sample", "seed": seed, "n": n})
        return {"texts": ["S%s_%d" % (seed, i) for i in range(n)],
                "output_token_count": n}


class FakeRM:


    def __init__(self, table=None, default=0.1, verdict="scored"):
        self.table = table or {}
        self.default = default
        self.verdict = verdict
        self.calls = []

    def score_best(self, image, candidates, label, case_id="", force=False):
        self.calls.append({"case_id": case_id, "candidates": list(candidates),
                           "force": force})
        scores = [self.table.get(c, self.default) for c in candidates]
        verdicts = [self.verdict] * len(candidates)
        best = max(range(len(scores)), key=lambda i: scores[i])
        return {"best_index": best, "best_text": candidates[best],
                "scores": scores, "verdicts": verdicts,
                "wait_sec": 0.0, "call_sec": 0.01,
                "stage_sec": {}, "batch_size": 1, "batch_items": 1}


def _rounds(n_rounds=5, prefilled=True):

    temps = [0.3, 0.5, 0.7, 1.0]
    first = {"greedy": True}
    if prefilled:
        first["prefilled"] = True
    table = [first]
    for t in temps[: n_rounds - 1]:
        table.append({"temperature": t, "top_k": 0, "top_p": 1.0, "min_p": 0.0,
                      "n": 8, "scale": 1.0})
    return table


def _prior(text=PRIOR_TEXT, score=PRIOR_SCORE, verdict="scored"):
    return {"text": text, "score": score, "verdict": verdict}


def _run(*, engine, rm, n_max=5, tau=0.98, case_id="img::b7",
         rounds=None, seed_base=7, prior=_prior()):
    cfg = {
        "adaptive": {
            "enabled": True,
            "tau": tau,
            "n_max": n_max,
            "rounds": rounds if rounds is not None else _rounds(5),
            "seed_base": seed_base,
        }
    }
    crop = _img()
    try:
        return _execute_block_adaptive(
            engine=engine, rm_client=rm, tts_cfg=cfg,
            crop_image=crop, base_image=crop, rm_image=crop,
            elem_cfg=ELEM_CFG, label="text", case_id=case_id, infer_t0=0.0,
            prior_candidate=prior,
        )
    finally:
        crop.close()


def test_prefilled_round_never_calls_the_engine():
    engine = FakeEngine()
    _run(engine=engine, rm=FakeRM(default=0.1), n_max=5, tau=0.98)
    assert all(c["kind"] == "sample" for c in engine.calls), (
        "prefilled 轮仍然调了 engine.recognize ⇒ 白跑一次 OCR,"
        "本模式的全部时间收益归零")
    assert len(engine.calls) == 4, (
        "n_max=5 且第 1 轮注入 ⇒ 该只剩 4 个采样轮,实得 %d" % len(engine.calls))


def test_greedy_sec_is_exactly_zero():

    _t, _tok, _sec, info = _run(engine=FakeEngine(), rm=FakeRM(default=0.1))
    assert info["greedy_sec"] == 0.0, (
        "prefilled 轮的 greedy_sec 不是 0(实得 %r)" % (info["greedy_sec"],))
    assert info["round_log"][0]["sample_sec"] == 0.0


def test_prior_candidate_enters_the_pool_bitwise():
    _t, _tok, _sec, info = _run(engine=FakeEngine(), rm=FakeRM(default=0.1))
    assert info["candidates"][0] == PRIOR_TEXT, "先验文本不是候选池的第一个"
    assert info["scores"][0] == PRIOR_SCORE, (
        "注入分与页级那次不逐位相等(实得 %r)⇒ 两边分数不再可比" % (info["scores"][0],))
    assert info["verdicts"][0] == "scored"
    assert info["round_log"][0]["raw_n"] == 1
    assert info["round_log"][0]["new_n"] == 1
    assert info["round_log"][0]["prefilled"] is True
    assert info["prior_injected"] is True, (
        "没有 prior_injected 标记 ⇒ 下游分不出这块的分是注入的还是本次打的")


def test_no_degradation_is_structural():

    text, _tok, _sec, info = _run(engine=FakeEngine(), rm=FakeRM(default=0.01))
    assert info["stop_reason"] == "exhausted"
    assert text == PRIOR_TEXT, "采样候选更差却没退回先验候选 ⇒ 块级重采会劣化页面"
    assert info["best_score"] == PRIOR_SCORE
    assert info["best_score"] >= PRIOR_SCORE


def test_prefilled_round_never_calls_rm():

    engine = FakeEngine()
    rm = FakeRM(default=0.1)
    _t, _tok, _sec, info = _run(engine=engine, rm=rm, n_max=5, tau=0.98)
    assert info["round_log"][0]["rm_calls"] == 0, "prefilled 轮记了 RM 调用"
    assert info["round_log"][0]["rm_sec"] == 0.0
    assert all(PRIOR_TEXT not in c["candidates"] for c in rm.calls), (
        "先验文本被送去重打分 ⇒ 并发下会拿到与页级略不同的分数")
    assert info["rm_calls"] == 4, "4 个采样轮该各打一次分,实得 %d" % info["rm_calls"]


def test_rm_used_stays_false_when_only_prior_scored():

    _t, _tok, _sec, info = _run(engine=FakeEngine(), rm=FakeRM(default=0.1),
                                prior=_prior(score=0.995))
    assert info["rm_used"] is False, "没调过 RM 却把 rm_used 置真了"
    assert info["best_score"] == 0.995
    assert info["prior_injected"] is True


def test_prior_above_tau_stops_at_round_one():
    engine = FakeEngine()
    rm = FakeRM(default=0.1)
    text, _tok, _sec, info = _run(engine=engine, rm=rm, prior=_prior(score=0.99))
    assert info["rounds_used"] == 1, "先验分已过阈却仍继续采样"
    assert info["stop_reason"] == "passed"
    assert info["exhausted"] is False
    assert text == PRIOR_TEXT
    assert engine.calls == [], "过阈了还调引擎 ⇒ 低分块才重采这条约束破了"
    assert rm.calls == [], "过阈了还调 RM"


def _expect_value_error(fn, what):
    try:
        fn()
    except ValueError:
        return
    raise AssertionError(what)


def test_missing_prior_raises():
    for bad in (None, {}, {"score": 0.5}, {"text": "", "score": 0.5}):
        _expect_value_error(
            lambda bad=bad: _run(engine=FakeEngine(), rm=FakeRM(), prior=bad),
            "prior_candidate=%r 没报错 ⇒ 第 1 轮静默空转,"
            "产物与'采样没采到东西'同形" % (bad,))


def test_missing_prior_score_raises():
    _expect_value_error(
        lambda: _run(engine=FakeEngine(), rm=FakeRM(),
                     prior={"text": PRIOR_TEXT, "score": None}),
        "先验候选没给分却放行 ⇒ '返回分 ≥ 先验分'无从比较")


def test_prior_is_ignored_when_round_table_has_no_prefilled():

    engine = FakeEngine(greedy_text="G")
    rm = FakeRM(table={"G": 0.5}, default=0.1)
    text, _tok, _sec, info = _run(engine=engine, rm=rm, n_max=1,
                                  rounds=_rounds(5, prefilled=False), prior=None)
    assert text == "G"
    assert info["scores"] == [0.5]
    assert "prior_injected" not in info, "页级产物里多出了块级专有字段"
    assert "prefilled" not in info["round_log"][0]
    assert engine.calls[0]["kind"] == "greedy"


def test_seed_derivation_matches_the_page_level_run():

    block = FakeEngine()
    _run(engine=block, rm=FakeRM(default=0.01), n_max=5, case_id="img::b7")

    page = FakeEngine()
    _run(engine=page, rm=FakeRM(default=0.01), n_max=5, case_id="img::b7",
         rounds=_rounds(5, prefilled=False), prior=None)

    page_sample_seeds = [c["seed"] for c in page.calls if c["kind"] == "sample"]
    block_sample_seeds = [c["seed"] for c in block.calls if c["kind"] == "sample"]
    assert block_sample_seeds == page_sample_seeds, (
        "注入改变了采样轮的 seed ⇒ 块级候选集与页级不同源")
    assert block_sample_seeds[0] == _round_seed("img::b7", 2, 7)


def _cfg(rounds):
    return {"tts": {"adaptive": {"enabled": True, "tau": 0.98,
                                 "n_max": len(rounds), "rounds": rounds}}}


def test_config_accepts_prefilled_on_round_one():
    _validate_adaptive(_cfg(_rounds(5)))


def test_config_rejects_prefilled_after_round_one():
    rounds = _rounds(5)
    rounds[2]["prefilled"] = True
    _expect_value_error(
        lambda: _validate_adaptive(_cfg(rounds)),
        "prefilled 出现在第 3 轮却放行 ⇒ 该轮净增 0 个候选、白跑一轮")


def test_config_still_requires_greedy_on_round_one():

    _expect_value_error(
        lambda: _validate_adaptive(_cfg([{"prefilled": True}] + _rounds(3)[1:])),
        "第 1 轮只写 prefilled 不写 greedy 却放行")


def _main():
    tests = [(k, v) for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print("  PASS  %s" % name)
        except AssertionError as err:
            failed += 1
            print("  FAIL  %s\n        %s" % (name, err))
        except Exception as err:  # noqa: BLE001
            failed += 1
            print("  ERROR %s\n        %s: %s" % (name, type(err).__name__, err))
    print("\n%d/%d passed" % (len(tests) - failed, len(tests)))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_main())
