from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict, List

import pytest

SDK_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SDK_DIR))

from minicpmvocr.pipeline.rm_client import RMClient  # noqa: E402


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

    def __init__(self) -> None:
        self.posts: List[Dict] = []

    def post(self, url, json=None, timeout=None):  # noqa: A002
        self.posts.append({"url": url, "json": json})
        n = len(json.get("candidates", [])) if "candidates" in json else 0
        if "score_best_batch" in url:
            return FakeResponse({"results": [
                {"best_index": 0, "scores": [], "verdicts": []}
                for _ in json["items"]]})
        return FakeResponse({"best_index": 0, "scores": [0.1] * n, "verdicts": ["scored"] * n})

    def close(self) -> None:
        pass


def cfg(**over) -> Dict:
    base = {"enabled": True, "rm_url": "http://rm", "timeout_sec": 30,
            "fallback_to_greedy": True, "rm_input_form": "binary"}
    base.update(over)
    return base


def make_client(**over) -> RMClient:
    client = RMClient(cfg(**over))
    client.http = FakeSession()
    return client


def test_missing_input_form_fails_at_construction():
    with pytest.raises(ValueError, match="rm_input_form"):
        RMClient(cfg(rm_input_form=""))


def test_unknown_input_form_fails_at_construction():
    with pytest.raises(ValueError, match="rm_input_form"):
        RMClient(cfg(rm_input_form="quaternary"))


def test_tts_off_does_not_require_it():

    RMClient(cfg(enabled=False, rm_input_form=""))


@pytest.mark.parametrize("form", ["binary", "ternary"])
def test_block_payload_carries_the_form(form):
    client = make_client(rm_input_form=form)

    client.score_best(FakeImage(), ["a", "b"], "text", case_id="blk")

    assert client.http.posts[0]["json"]["input_form"] == form


def test_batch_body_carries_the_form_at_batch_level():

    client = make_client(rm_input_form="ternary")
    payloads = [client.build_payload(FakeImage(), ["a"], "text", "b0"),
                client.build_payload(FakeImage(), ["b"], "table", "b1")]

    client.score_best_batch(payloads)

    body = client.http.posts[0]["json"]
    assert body["input_form"] == "ternary"

    assert [item["input_form"] for item in body["items"]] == ["ternary", "ternary"]


def test_single_candidate_shortcut_does_not_hit_the_server():

    client = make_client()

    out = client.score_best(FakeImage(), ["only"], "text", case_id="blk")

    assert out == {"best_index": 0, "best_text": "only", "scores": [], "verdicts": []}
    assert client.http.posts == []
