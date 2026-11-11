"""The client reads a streamed reply the same way as a plain one, handing the text over as it comes."""
import json

import pytest
from PIL import Image

from minicpmvocr.backends import VLMClient, resolve_dialect
from minicpmvocr.backends.dialects import DIALECTS, DialectError, collect_stream, stream_payload
from minicpmvocr.config import DEFAULT_CONFIG


def _sse(*chunks, done=True):
    lines = []
    for chunk in chunks:
        lines += [b"data: " + json.dumps(chunk).encode(), b""]
    return lines + ([b"data: [DONE]"] if done else [])


def _delta(text, finish_reason=None):
    return {"choices": [{"index": 0, "delta": {"content": text}, "finish_reason": finish_reason}]}


USAGE = {"choices": [], "usage": {"prompt_tokens": 7, "completion_tokens": 3, "total_tokens": 10}}


def test_sse_stream_collects_to_the_plain_reply():
    heard = []
    lines = _sse({"choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}}]},
                 _delta("\u4f60\u597d"), _delta("\uff0c"), _delta("world", "stop"), USAGE)
    body = collect_stream("sse", lines, heard.append)

    assert heard == ["\u4f60\u597d", "\uff0c", "world"]
    result = DIALECTS["vllm"].parse_response(body)
    assert result["text"] == "\u4f60\u597d\uff0cworld"
    assert result["finish_reason"] == "stop"
    assert result["output_token_count"] == 3
    assert result["request_metrics"]["prompt_tokens"] == 7


def test_sse_stream_ignores_keep_alives_and_other_choices():
    heard = []
    lines = [b": ping", b""] + _sse(
        _delta("a"), {"choices": [{"index": 1, "delta": {"content": "other"}}]}, _delta("b", "length"))
    body = collect_stream("sse", lines, heard.append)
    assert heard == ["a", "b"]
    assert body["choices"][0] == {"message": {"content": "ab"}, "finish_reason": "length"}


def test_sse_stream_raises_an_error_sent_in_the_stream():
    with pytest.raises(DialectError, match="boom"):
        collect_stream("sse", _sse(_delta("a"), {"error": {"message": "boom"}}), lambda text: None)


def test_ndjson_stream_collects_to_the_plain_reply():
    heard = []
    lines = [json.dumps(chunk).encode() for chunk in (
        {"message": {"role": "assistant", "content": "Hel"}, "done": False},
        {"message": {"role": "assistant", "content": "lo"}, "done": False},
        {"message": {"role": "assistant", "content": ""}, "done": True, "done_reason": "stop",
         "eval_count": 2, "prompt_eval_count": 5},
    )]
    body = collect_stream("ndjson", lines, heard.append)

    assert heard == ["Hel", "lo"]
    result = DIALECTS["ollama"].parse_response(body)
    assert (result["text"], result["finish_reason"], result["output_token_count"]) == ("Hello", "stop", 2)


def test_stream_payload_asks_for_token_counts_only_where_they_exist():
    assert stream_payload({"model": "m"}, "sse") == {
        "model": "m", "stream": True, "stream_options": {"include_usage": True}}
    assert stream_payload({"model": "m", "stream": False}, "ndjson") == {"model": "m", "stream": True}


def test_every_backend_says_how_it_streams():
    assert {name: dialect.stream_format for name, dialect in DIALECTS.items()} == {
        "openai": "sse", "vllm": "sse", "llamacpp": "sse", "ollama": "ndjson", "ollama_openai": "sse"}


class _Reply:
    def __init__(self, lines=None, body=None, fail_after=None):
        self.status_code = 200
        self._lines, self._body, self._fail_after = lines, body, fail_after
        self.closed = False

    def iter_lines(self):
        for position, line in enumerate(self._lines):
            if self._fail_after is not None and position >= self._fail_after:
                raise ConnectionError("connection dropped")
            yield line

    def json(self):
        return self._body

    def close(self):
        self.closed = True


class _Session:
    def __init__(self, replies):
        self.replies = list(replies)
        self.posts = []

    def post(self, url, json=None, headers=None, timeout=None, stream=False):
        self.posts.append({"payload": json, "stream": stream})
        return self.replies.pop(0)


def _client(monkeypatch, replies):
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    cfg["engine"].update({"type": "vllm", "server_url": "http://localhost:1", "model_name": "m",
                          "request_retry_interval_sec": 0})
    client = VLMClient(cfg, resolve_dialect(cfg["engine"]))
    session = _Session(replies)
    monkeypatch.setattr(client, "_session", lambda: session)
    return client, session


IMAGE = Image.new("RGB", (8, 8), "white")
PLAIN = {"choices": [{"message": {"content": "hello"}, "finish_reason": "stop"}],
         "usage": {"prompt_tokens": 7, "completion_tokens": 3, "total_tokens": 10}}


def test_client_streams_only_when_someone_listens(monkeypatch):
    client, session = _client(monkeypatch, [_Reply(body=PLAIN)])
    result = client.recognize(IMAGE, prompt="p", max_new_tokens=64)
    assert result["text"] == "hello"
    assert session.posts[0]["stream"] is False
    assert "stream" not in session.posts[0]["payload"] and "stream_options" not in session.posts[0]["payload"]


def test_client_hands_over_the_text_and_returns_the_same_result(monkeypatch):
    reply = _Reply(lines=_sse(_delta("hel"), _delta("lo", "stop"), USAGE))
    client, session = _client(monkeypatch, [reply])
    heard = []
    result = client.recognize(IMAGE, prompt="p", max_new_tokens=64,
                              on_delta=lambda text, restart: heard.append((text, restart)))

    assert heard == [("hel", False), ("lo", False)]
    assert (result["text"], result["finish_reason"], result["output_token_count"]) == ("hello", "stop", 3)
    assert session.posts[0]["stream"] is True
    assert session.posts[0]["payload"]["stream"] is True
    assert session.posts[0]["payload"]["stream_options"] == {"include_usage": True}
    assert reply.closed


def test_client_marks_the_restart_when_a_stream_breaks_and_is_sent_again(monkeypatch):
    broken = _Reply(lines=_sse(_delta("hel"), _delta("lo", "stop"), USAGE), fail_after=2)
    whole = _Reply(lines=_sse(_delta("hel"), _delta("lo", "stop"), USAGE))
    client, session = _client(monkeypatch, [broken, whole])
    heard = []
    result = client.recognize(IMAGE, prompt="p", max_new_tokens=64,
                              on_delta=lambda text, restart: heard.append((text, restart)))

    # "hel" from the broken try, then the second try starts over and says so once.
    assert heard == [("hel", False), ("hel", True), ("lo", False)]
    assert result["text"] == "hello"
    assert len(session.posts) == 2 and broken.closed


def test_client_does_not_stream_several_candidates(monkeypatch):
    client, session = _client(monkeypatch, [_Reply(body=PLAIN)])
    client.recognize(IMAGE, prompt="p", max_new_tokens=64, n=3, on_delta=lambda text, restart: None)
    assert session.posts[0]["stream"] is False
