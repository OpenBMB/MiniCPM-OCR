from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from minicpmvocr.pipeline._tts import (  # noqa: E402
    _best_scored,
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
        self.calls.append({
            "kind": "sample",
            "seed": seed,
            "n": n,
            "temperature": (decode_overrides or {}).get("temperature"),
        })

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


def _rounds(n_rounds=8):

    temps = [0.3, 0.5, 0.7, 1.0, 1.2, 1.35, 1.5]
    table = [{"greedy": True}]
    for t in temps[: n_rounds - 1]:
        table.append({"temperature": t, "top_k": 0, "top_p": 1.0, "min_p": 0.0,
                      "n": 8, "scale": 1.0})
    return table


def _run(*, engine, rm, n_max, tau, case_id="img::b0", rounds=None, seed_base=7):
    cfg = {
        "adaptive": {
            "enabled": True,
            "tau": tau,
            "n_max": n_max,
            "rounds": rounds if rounds is not None else _rounds(8),
            "seed_base": seed_base,
        }
    }
    crop = _img()
    try:
        return _execute_block_adaptive(
            engine=engine, rm_client=rm, tts_cfg=cfg,
            crop_image=crop, base_image=crop, rm_image=crop,
            elem_cfg=ELEM_CFG, label="text", case_id=case_id, infer_t0=0.0,
        )
    finally:
        crop.close()


def test_prefix_property_seeds_and_texts():

    long_engine = FakeEngine()
    _run(engine=long_engine, rm=FakeRM(default=0.1), n_max=8, tau=0.98)

    for k in range(2, 9):
        short_engine = FakeEngine()
        _run(engine=short_engine, rm=FakeRM(default=0.1), n_max=k, tau=0.98)
        assert short_engine.calls == long_engine.calls[: len(short_engine.calls)], (
            "n_max=%d 的前 %d 次引擎调用与 n_max=8 不一致 ⇒ 轮次参数偷看了 n_max,"
            "前缀性质失效" % (k, len(short_engine.calls)))


def test_prefix_property_independent_of_tau():

    e_hi = FakeEngine()
    _run(engine=e_hi, rm=FakeRM(default=0.1), n_max=8, tau=0.98)
    e_lo = FakeEngine()
    _run(engine=e_lo, rm=FakeRM(default=0.1), n_max=8, tau=0.50)

    assert e_hi.calls == e_lo.calls, "采样序列随 tau 改变 ⇒ 阈值扫描不可离线复算"


def test_round_seed_is_deterministic_and_round_dependent():
    a1 = _round_seed("img::b0", 1, 7)
    a1_again = _round_seed("img::b0", 1, 7)
    a2 = _round_seed("img::b0", 2, 7)
    b1 = _round_seed("img::b1", 1, 7)
    assert a1 == a1_again, "同 (block, round) 两次派生不一致 ⇒ 不可复现"
    assert a1 != a2, "同块不同轮 seed 相同 ⇒ 各轮会采出一样的东西"
    assert a1 != b1, "不同块同轮 seed 相同 ⇒ 块间采样不独立"
    assert 0 <= a1 <= 0x7FFF_FFFF


def test_stops_at_first_round_passing_tau():
    engine = FakeEngine()

    seed2 = _round_seed("img::b0", 2, 7)
    rm = FakeRM(table={"S%s_3" % seed2: 0.99}, default=0.1)
    text, _tokens, _sec, info = _run(engine=engine, rm=rm, n_max=8, tau=0.98)
    assert info["stop_reason"] == "passed"
    assert info["rounds_used"] == 2, "过阈了却没停在第 2 轮"
    assert info["exhausted"] is False
    assert text == "S%s_3" % seed2
    assert info["best_score"] == 0.99


def test_greedy_alone_can_pass_and_skip_all_sampling():
    engine = FakeEngine(greedy_text="G")
    rm = FakeRM(table={"G": 0.995}, default=0.1)
    _text, _t, _s, info = _run(engine=engine, rm=rm, n_max=8, tau=0.98)
    assert info["rounds_used"] == 1
    assert info["stop_reason"] == "passed"

    assert all(c["kind"] == "greedy" for c in engine.calls), "过阈后仍继续采样"


def test_exhausted_marks_and_takes_max():
    engine = FakeEngine()
    seed5 = _round_seed("img::b0", 5, 7)
    best_text = "S%s_2" % seed5
    rm = FakeRM(table={best_text: 0.77}, default=0.1)
    text, _t, _s, info = _run(engine=engine, rm=rm, n_max=8, tau=0.98)
    assert info["stop_reason"] == "exhausted"
    assert info["exhausted"] is True, "跑满未过阈却没打标记 ⇒ 上偏分数会混进直通率"
    assert info["rounds_used"] == 8
    assert text == best_text and info["best_score"] == 0.77


class ConstEngine(FakeEngine):


    def recognize(self, image, prompt=None, max_new_tokens=None, slice_nums=None,
                  n=None, decode_overrides=None):
        if n is None:
            self.calls.append({"kind": "greedy", "seed": None})
            return {"text": "SAME", "output_token_count": 1}
        self.calls.append({"kind": "sample",
                           "seed": (decode_overrides or {}).get("seed"), "n": n})
        return {"texts": ["SAME"] * n, "output_token_count": n}


def test_cross_round_dedup_collapses_repeats():
    engine = ConstEngine()
    rm = FakeRM(default=0.1)
    _text, _t, _s, info = _run(engine=engine, rm=rm, n_max=8, tau=0.98)
    assert info["n_candidates"] == 1, "八轮全同,去重后该只剩 1 个候选"

    assert len(rm.calls) == 1, "跨轮去重没生效:重复文本被反复送去打分"
    assert info["rm_calls"] == 1
    assert sum(r["new_n"] for r in info["round_log"][1:]) == 0
    assert info["raw_candidate_count"] == 1 + 7 * 8, "raw 计数该记全部原始候选"


def test_n1_equals_scenario_one():
    engine = FakeEngine(greedy_text="G")
    rm = FakeRM(table={"G": 0.42}, default=0.1)
    text, _t, _s, info = _run(engine=engine, rm=rm, n_max=1, tau=0.98)
    assert text == "G"
    assert info["n_candidates"] == 1
    assert info["scores"] == [0.42], "n=1 时该拿到贪心那一块的分数"
    assert info["rounds_used"] == 1

    assert rm.calls and rm.calls[0]["force"] is True, (
        "单候选没强制打分 ⇒ 场景① 拿不到分数,直通率无从算起")
    assert all(c["kind"] == "greedy" for c in engine.calls)


def test_verdict_filter_excludes_unscored():

    score_by_text = {"a": 0.0, "b": -1.0}
    verdict_by_text = {"a": "precheck_reject", "b": "forward_oom"}
    best, score = _best_scored(["a", "b"], score_by_text, verdict_by_text)
    assert best is None and score is None, "未 scored 的候选被选中了"


    score_by_text = {"a": 0.0, "b": 0.3}
    verdict_by_text = {"a": "precheck_reject", "b": "scored"}
    best, _ = _best_scored(["a", "b"], score_by_text, verdict_by_text)
    assert best == "b"


    best, _ = _best_scored(["a", "b"], {"a": 0.2, "b": 0.9}, {})
    assert best == "b"


def test_all_candidates_unscored_falls_back_to_greedy():
    engine = FakeEngine(greedy_text="G")
    rm = FakeRM(default=0.0, verdict="precheck_reject")
    text, _t, _s, info = _run(engine=engine, rm=rm, n_max=3, tau=0.98)
    assert text == "G", "全部打分失败时该退回贪心(与服务端降级同规则)"
    assert info["best_index"] == 0
    assert info["stop_reason"] == "no_scored"


class SizeRecordingEngine(FakeEngine):
    def __init__(self, greedy_text="G"):
        super().__init__(greedy_text)
        self.sizes = []

    def recognize(self, image, prompt=None, max_new_tokens=None, slice_nums=None,
                  n=None, decode_overrides=None):
        self.sizes.append(image.size)
        return super().recognize(image, prompt, max_new_tokens, slice_nums,
                                 n, decode_overrides)


def test_scale_1_0_never_resizes():

    engine = SizeRecordingEngine()
    _run(engine=engine, rm=FakeRM(default=0.1), n_max=4, tau=0.98)
    assert set(engine.sizes) == {(120, 120)}, (
        "scale 全 1.0 却改了图的尺寸 ⇒ 与基线不再同条件")


def test_scale_actually_upscales_the_ocr_input():

    rounds = [
        {"greedy": True},
        {"temperature": 0.5, "top_k": 0, "top_p": 1.0, "min_p": 0.0,
         "n": 2, "scale": 1.5},
    ]
    engine = SizeRecordingEngine()
    _run(engine=engine, rm=FakeRM(default=0.1), n_max=2, tau=0.98, rounds=rounds)
    assert engine.sizes[0] == (120, 120), "贪心轮不该被缩放"
    assert engine.sizes[1] == (180, 180), (
        "scale=1.5 没有真的放大 OCR 输入(实得 %r)" % (engine.sizes[1],))


def test_rm_input_stays_anchored_while_ocr_scales():

    rounds = [
        {"greedy": True},
        {"temperature": 0.5, "top_k": 0, "top_p": 1.0, "min_p": 0.0,
         "n": 2, "scale": 2.0},
    ]
    engine = SizeRecordingEngine()
    rm = FakeRM(default=0.1)
    rm_seen = []
    orig = rm.score_best

    def spy(image, candidates, label, case_id="", force=False):
        rm_seen.append(image.size)
        return orig(image, candidates, label, case_id=case_id, force=force)

    rm.score_best = spy
    _run(engine=engine, rm=rm, n_max=2, tau=0.98, rounds=rounds)
    assert engine.sizes[1] == (240, 240), "OCR 侧没放大,这条测试就没意义了"
    assert set(rm_seen) == {(120, 120)}, (
        "RM 的输入图跟着 OCR 一起放大了 ⇒ 分数上升分不清是文本变好还是尺子变了")


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
