from __future__ import annotations

import sys
import threading
import time
from pathlib import Path
from typing import Dict, List

import pytest

SDK_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SDK_DIR))

from minicpmvocr.pipeline.rm_client import RMBatcher, build_rm_caller  # noqa: E402


class FakeImage:
    def save(self, buf, format="PNG"):  # noqa: A002
        buf.write(b"png")


class FakeClient:


    enabled = True
    base_url = "http://rm"
    fallback_to_greedy = True

    def __init__(self, scores: Dict[str, float], *, fail: bool = False) -> None:
        self.scores = scores
        self.fail = fail
        self.calls: List[List[Dict]] = []
        self.lock = threading.Lock()

    def build_payload(self, image, candidates, label, case_id=""):
        return {"case_id": case_id, "candidates": list(candidates), "category": "text"}

    def score_best_batch(self, payloads):
        with self.lock:
            self.calls.append(payloads)
        if self.fail:
            raise RuntimeError("rm down")
        results = []
        for payload in payloads:
            scores = [self.scores[text] for text in payload["candidates"]]
            best = max(range(len(scores)), key=lambda i: scores[i])
            results.append({"best_index": best, "scores": scores,
                            "verdicts": ["scored"] * len(scores)})
        return {"results": results, "batch_size": sum(len(p["candidates"]) for p in payloads),
                "stage_sec": {"render_sec": 1.0}}


SCORES = {"a0": 0.1, "a1": 0.7, "a2": 0.2, "b0": 0.8, "b1": 0.4, "c0": 0.3, "c1": 0.9}
BLOCKS = [["a0", "a1", "a2"], ["b0", "b1"], ["c0", "c1"]]


def run_blocks(batcher: RMBatcher, blocks: List[List[str]]) -> List[Dict]:

    out: List[Dict] = [None] * len(blocks)

    def work(i: int) -> None:
        try:
            out[i] = batcher.score_best(FakeImage(), blocks[i], "text", case_id="blk%d" % i)
        except Exception as err:
            out[i] = {"raised": err}

    threads = [threading.Thread(target=work, args=(i,)) for i in range(len(blocks))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
    assert all(not t.is_alive() for t in threads), "a caller never came back"
    return out


def test_scores_land_on_the_right_block_and_candidate():
    client = FakeClient(SCORES)
    batcher = RMBatcher(client, max_items=3, max_wait_sec=5.0)

    results = run_blocks(batcher, BLOCKS)

    assert [r["scores"] for r in results] == [[0.1, 0.7, 0.2], [0.8, 0.4], [0.3, 0.9]]
    assert [r["best_text"] for r in results] == ["a1", "b0", "c1"]


def test_three_blocks_go_out_as_one_call():

    client = FakeClient(SCORES)
    batcher = RMBatcher(client, max_items=3, max_wait_sec=5.0)

    run_blocks(batcher, BLOCKS)

    assert len(client.calls) == 1
    assert [len(p["candidates"]) for p in client.calls[0]] == [3, 2, 2]


def test_a_lone_block_is_sent_after_the_wait_instead_of_waiting_forever():

    client = FakeClient(SCORES)
    batcher = RMBatcher(client, max_items=8, max_wait_sec=0.05)

    t0 = time.time()
    result = batcher.score_best(FakeImage(), ["a0", "a1"], "text", case_id="lone")

    assert result["best_text"] == "a1"
    assert len(client.calls) == 1
    assert time.time() - t0 < 5.0


def test_flush_sends_what_is_still_queued():
    client = FakeClient(SCORES)
    batcher = RMBatcher(client, max_items=8, max_wait_sec=30.0)
    done = threading.Event()

    def work():
        batcher.score_best(FakeImage(), ["a0", "a1"], "text", case_id="tail")
        done.set()

    threading.Thread(target=work, daemon=True).start()
    time.sleep(0.05)
    batcher.flush()

    assert done.wait(5.0), "flush 没把尾批发出去"
    assert len(client.calls) == 1


def test_batch_failure_reports_a_reason_for_every_member():
    client = FakeClient(SCORES, fail=True)
    batcher = RMBatcher(client, max_items=3, max_wait_sec=5.0)

    results = run_blocks(batcher, BLOCKS)

    for result, block in zip(results, BLOCKS):
        assert "rm down" in result["error"]
        assert result["best_index"] == 0
        assert result["best_text"] == block[0]


def test_a_failing_batch_never_leaves_a_caller_parked():

    client = FakeClient(SCORES, fail=True)
    client.fallback_to_greedy = False
    batcher = RMBatcher(client, max_items=3, max_wait_sec=5.0)

    results = run_blocks(batcher, BLOCKS)


    assert any(r.get("raised") for r in results)
    assert all(r.get("raised") or r.get("error") for r in results)


def test_short_circuits_without_calling_the_rm():
    client = FakeClient(SCORES)
    batcher = RMBatcher(client, max_items=2, max_wait_sec=5.0)

    single = batcher.score_best(FakeImage(), ["only"], "text")

    assert single == {"best_index": 0, "best_text": "only", "scores": [], "verdicts": []}
    assert client.calls == []


def test_wait_and_call_are_reported_separately():

    client = FakeClient(SCORES)
    batcher = RMBatcher(client, max_items=3, max_wait_sec=5.0)

    results = run_blocks(batcher, BLOCKS)

    for result in results:
        assert result["wait_sec"] >= 0.0
        assert result["call_sec"] >= 0.0
        assert "batch_items" in result and result["batch_items"] == 3


def test_build_rm_caller_returns_the_client_when_batching_is_off():
    client = FakeClient(SCORES)

    caller, batcher = build_rm_caller({}, client)

    assert caller is client and batcher is None


def test_build_rm_caller_returns_a_batcher_when_configured():
    client = FakeClient(SCORES)

    caller, batcher = build_rm_caller({"rm_batch": {"max_items": 4, "max_wait_ms": 20}}, client)

    assert caller is batcher and isinstance(batcher, RMBatcher)
    assert batcher.max_items == 4
    assert batcher.max_wait_sec == pytest.approx(0.02)
