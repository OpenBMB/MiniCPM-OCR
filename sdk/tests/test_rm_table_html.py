from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict, List

import pytest

SDK_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SDK_DIR))

from minicpmvocr.pipeline.rm_client import (  # noqa: E402
    RMBatcher,
    RMClient,
    build_rm_caller,
    text_for_scoring,
)

OTSL = "<otsl><fcel>甲<fcel>乙<nl><fcel>1<ecel><nl></otsl>"
OTSL2 = "<otsl><fcel>甲<fcel>丙<nl><fcel>2<ecel><nl></otsl>"


class FakeImage:
    def save(self, buf, format="PNG"):  # noqa: A002
        buf.write(b"png")


class FakeResponse:
    def __init__(self, body: Dict) -> None:
        self._body = body

    def raise_for_status(self) -> None:
        pass

    def json(self) -> Dict:
        return self._body


class FakeSession:


    trust_env = True

    def __init__(self, best_index: int = 0) -> None:
        self.posts: List[Dict] = []
        self.best_index = best_index

    def post(self, url, json=None, timeout=None):  # noqa: A002
        self.posts.append({"url": url, "json": json})
        if "score_best_batch" in url:
            return FakeResponse({"results": [
                {"best_index": self.best_index,
                 "scores": [0.9] * len(item["candidates"]),
                 "verdicts": ["scored"] * len(item["candidates"])}
                for item in json["items"]]})
        n = len(json.get("candidates", []))
        return FakeResponse({"best_index": self.best_index,
                             "scores": [0.9] * n, "verdicts": ["scored"] * n})

    def close(self) -> None:
        pass


def cfg(**over) -> Dict:
    base = {"enabled": True, "rm_url": "http://rm", "timeout_sec": 30,
            "fallback_to_greedy": True, "rm_input_form": "binary"}
    base.update(over)
    return base


def make_client(best_index: int = 0, **over) -> RMClient:
    client = RMClient(cfg(**over))
    client.http = FakeSession(best_index=best_index)
    return client


def sent_candidates(client: RMClient, call: int = 0) -> List[str]:
    body = client.http.posts[call]["json"]
    if "items" in body:
        return [c for item in body["items"] for c in item["candidates"]]
    return body["candidates"]


def test_table_candidate_reaches_rm_as_html():
    client = make_client()
    client.score_best(FakeImage(), [OTSL], "table", force=True)
    sent = sent_candidates(client)[0]
    assert "<table>" in sent and "<td>甲</td>" in sent
    assert "<fcel>" not in sent and "<otsl>" not in sent


def test_non_table_labels_are_untouched():
    client = make_client()
    raw = "第一段 \\(x=1\\) 文本"
    client.score_best(FakeImage(), [raw], "text", force=True)


    assert sent_candidates(client) == [raw]


def test_returned_text_stays_engine_raw():

    client = make_client()
    out = client.score_best(FakeImage(), [OTSL], "table", force=True)
    assert out["best_text"] == OTSL
    assert out["verdicts"] == ["scored"]


def test_best_index_still_maps_to_original_candidate():

    client = make_client(best_index=1)
    out = client.score_best(FakeImage(), [OTSL, OTSL2], "table")
    assert out["best_index"] == 1
    assert out["best_text"] == OTSL2
    assert len(sent_candidates(client)) == 2


def test_batched_path_also_converts():
    client = make_client()
    batcher = RMBatcher(client, max_items=1, max_wait_sec=0.01)
    out = batcher.score_best(FakeImage(), [OTSL], "table", force=True)
    sent = sent_candidates(client)[0]
    assert "<table>" in sent, "合批路径漏转 ⇒ 跑批时整轮都在拿 OTSL 打分"
    assert out["best_text"] == OTSL


def test_build_rm_caller_batched_is_the_same_object_path():

    client = make_client()
    caller, batcher = build_rm_caller(cfg(rm_batch={"max_items": 4}), client)
    assert isinstance(caller, RMBatcher) and batcher is caller
    caller.score_best(FakeImage(), [OTSL], "table", force=True)
    caller.flush()
    assert "<table>" in sent_candidates(client)[0]


def test_already_html_is_idempotent_and_never_empty():

    html = "<table><tr><td>甲</td></tr></table>"
    assert text_for_scoring(html, "table") == html
    client = make_client()
    client.score_best(FakeImage(), [html], "table", force=True)
    assert sent_candidates(client)[0] == html


@pytest.mark.parametrize("junk", ["", "   ", "不是表格的一段话"])
def test_unparsable_table_text_falls_back_not_empty(junk):
    out = text_for_scoring(junk, "table")
    assert out == junk.strip() or out == junk
    assert out is not None


def test_transform_count_is_recorded():

    client = make_client()
    assert client.table_html_count == 0
    client.score_best(FakeImage(), [OTSL, OTSL2], "table")
    assert client.table_html_count == 2
    client.score_best(FakeImage(), ["一段文本"], "text", force=True)
    assert client.table_html_count == 2


def test_label_alias_goes_through_category_mapping():

    client = make_client()
    client.score_best(FakeImage(), [OTSL], "TABLE", force=True)
    assert "<table>" in sent_candidates(client)[0]
