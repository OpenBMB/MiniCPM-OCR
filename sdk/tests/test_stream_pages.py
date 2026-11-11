"""Pages are handed over one at a time, while the rest of the run is still going."""
import json
import threading
from pathlib import Path

import pytest
from PIL import Image

import minicpmvocr
from minicpmvocr import cli
from minicpmvocr.pipeline import overlapped, staged
from minicpmvocr.pipeline._stream import InputOrder

from tests.test_parse_quickstart import (  # noqa: F401  (quickstart is a fixture)
    FakeDetector,
    FakeEngine,
    _set_argv,
    quickstart,
)


def _images(root, names):
    for name in names:
        Image.new("RGB", (40, 30), "white").save(root / name)


def _parse_config(monkeypatch, root, inputs, *extra):
    """The config `minicpmvocr parse` would build for these inputs."""
    _set_argv(monkeypatch, ["minicpmvocr", "parse", *inputs, "--device", "cpu", *extra])
    args = cli._build_parser().parse_args()
    return cli._load_parse_config(args)


class GatedEngine(FakeEngine):
    """Recognizes one page, then waits until the test lets the next ones through."""

    def __init__(self):
        self.gate = threading.Event()
        self.calls = 0
        self.lock = threading.Lock()

    def recognize(self, image, prompt, max_new_tokens, slice_nums=None):
        with self.lock:
            self.calls += 1
            first = self.calls == 1
        if not first:
            assert self.gate.wait(timeout=30), "the test never opened the gate"
        return {"text": "Recognized page.", "output_token_count": 2}


@pytest.mark.parametrize("overlap", [True, False])
def test_first_page_arrives_before_the_run_is_over(quickstart, monkeypatch, overlap):
    root, _, _ = quickstart
    _images(root, ["second.png", "third.png"])
    engine = GatedEngine()
    for module in (staged, overlapped):
        monkeypatch.setattr(module, "create_backend", lambda config: engine)
    cfg = _parse_config(
        monkeypatch, root, ["input.png", "second.png", "third.png"],
        "--workers", "1", "--set", f"pipeline.overlap_layout={str(overlap).lower()}")

    stream = minicpmvocr.stream_pages(cfg)
    first = next(stream)
    # Two pages are still stuck behind the gate, so the run cannot have finished.
    assert not engine.gate.is_set()
    assert first["event"] == "page" and first["status"] == "ok"
    assert (first["pages_done"], first["pages_total"]) == (1, 3)
    assert first["markdown"] == "Recognized page."
    assert first["page"]["choices"][0]["message"]["content"] == "Recognized page."
    assert Path(first["output_md"]).read_text() == "Recognized page."

    engine.gate.set()
    rest = list(stream)
    assert [event["pages_done"] for event in rest] == [2, 3]
    assert sorted(event["index"] for event in [first, *rest]) == [0, 1, 2]


def test_events_say_which_input_and_page_they_are(quickstart, monkeypatch):
    fitz = pytest.importorskip("fitz")
    root, _, _ = quickstart
    with fitz.open() as doc:
        for _ in range(3):
            doc.new_page(width=72, height=72)
        doc.save(root / "doc.pdf")
    cfg = _parse_config(monkeypatch, root, ["input.png", "doc.pdf"])

    events = sorted(minicpmvocr.stream_pages(cfg), key=lambda event: event["index"])
    assert [event["image_id"] for event in events] == [
        "input", "doc_page_001", "doc_page_002", "doc_page_003"]
    assert [event["source_id"] for event in events] == ["s001", "s002", "s002", "s002"]
    assert [Path(event["source"]).name for event in events] == [
        "input.png", "doc.pdf", "doc.pdf", "doc.pdf"]
    assert [event["page_index"] for event in events] == [0, 0, 1, 2]


def test_generator_returns_the_run_summary(quickstart, monkeypatch):
    root, _, _ = quickstart
    cfg = _parse_config(monkeypatch, root, ["input.png"])
    stream = minicpmvocr.stream_pages(cfg)
    with pytest.raises(StopIteration) as stop:
        while True:
            next(stream)
    assert stop.value.value["counts"]["ok"] == 1


def test_a_page_that_fails_is_reported_and_the_rest_still_arrive(quickstart, monkeypatch):
    root, _, _ = quickstart
    _images(root, ["second.png"])

    class BrokenOnce(FakeDetector):
        def detect(self, images):
            if images[0].width == 41:
                raise RuntimeError("layout exploded")
            return super().detect(images)

    Image.new("RGB", (41, 30), "white").save(root / "bad.png")
    monkeypatch.setattr(overlapped, "create_layout_detector", lambda config: BrokenOnce(config))
    cfg = _parse_config(monkeypatch, root, ["input.png", "bad.png", "second.png"])

    events = {event["image_id"]: event for event in minicpmvocr.stream_pages(cfg, ordered=True)}
    assert list(events) == ["input", "bad", "second"]
    assert events["bad"]["status"] == "failed"
    assert "layout exploded" in events["bad"]["error"]
    assert events["bad"]["page"] is None and events["bad"]["markdown"] == ""
    assert events["second"]["status"] == "ok"


def test_an_error_that_stops_the_run_is_raised(quickstart, monkeypatch):
    root, _, _ = quickstart

    def _no_engine(config):
        raise RuntimeError("no engine")

    monkeypatch.setattr(overlapped, "create_backend", _no_engine)
    cfg = _parse_config(monkeypatch, root, ["input.png"])
    with pytest.raises(RuntimeError, match="no engine"):
        list(minicpmvocr.stream_pages(cfg))


def test_a_consumer_that_raises_does_not_stop_the_run(quickstart, monkeypatch):
    root, _, _ = quickstart
    _images(root, ["second.png"])
    cfg = _parse_config(monkeypatch, root, ["input.png", "second.png"])
    seen = []

    def _on_page(event):
        seen.append(event["image_id"])
        raise ValueError("consumer bug")

    summary = overlapped.pipelined_run(cfg, on_page=_on_page)
    assert sorted(seen) == ["input", "second"]
    assert summary["counts"]["ok"] == 2


def test_input_order_holds_pages_until_their_turn():
    delivered = []
    ordered = InputOrder(delivered.append)
    for index in (2, 0, 3, 1):
        ordered({"event": "page", "index": index, "pages_done": 99})
    assert [event["index"] for event in delivered] == [0, 1, 2, 3]
    assert [event["pages_done"] for event in delivered] == [1, 2, 3, 4]


def test_input_order_flush_releases_pages_behind_a_missing_one():
    delivered = []
    ordered = InputOrder(delivered.append)
    ordered({"event": "page", "index": 2, "pages_done": 1})
    ordered({"event": "page", "index": 1, "pages_done": 2})
    assert delivered == []
    ordered.flush()
    assert [event["index"] for event in delivered] == [1, 2]


def _lines(text):
    return [json.loads(line) for line in text.splitlines()]


def test_cli_stream_writes_one_line_per_page_then_the_summary(quickstart, monkeypatch, capsys):
    root, _, _ = quickstart
    _images(root, ["second.png"])
    _set_argv(monkeypatch, [
        "minicpmvocr", "parse", "input.png", "second.png", "--stream-ordered", "--device", "cpu"])
    assert cli.main() == 0
    lines = _lines(capsys.readouterr().out)
    assert [line["event"] for line in lines] == ["page", "page", "done"]
    assert [line["image_id"] for line in lines[:2]] == ["input", "second"]
    assert [line["markdown"] for line in lines[:2]] == ["Recognized page."] * 2
    assert lines[-1]["status"] == "Success" and lines[-1]["inputs"] == 2
    # No -o: the stream is the result, nothing is written beside it.
    assert all("output_md" not in output for output in lines[-1]["outputs"])


def test_cli_stream_still_writes_the_files_asked_for(quickstart, monkeypatch, capsys):
    fitz = pytest.importorskip("fitz")
    root, _, _ = quickstart
    with fitz.open() as doc:
        for _ in range(2):
            doc.new_page(width=72, height=72)
        doc.save(root / "input.pdf")
    _set_argv(monkeypatch, [
        "minicpmvocr", "parse", "input.pdf", "-o", "result.md", "--json", "--stream",
        "--device", "cpu"])
    assert cli.main() == 0
    lines = _lines(capsys.readouterr().out)
    assert [line["event"] for line in lines] == ["page", "page", "done"]
    assert sorted(line["page_index"] for line in lines[:2]) == [0, 1]
    assert lines[-1]["pages"] == 2
    assert (root / "result.md").read_text() == "Recognized page.\n\n<!-- page-break -->\n\nRecognized page."
    assert json.loads((root / "result.json").read_text())["pages_done"] == 2


def test_cli_stream_of_one_input_needs_no_output_path(quickstart, monkeypatch, capsys):
    _set_argv(monkeypatch, ["minicpmvocr", "parse", "input.png", "--stream", "--device", "cpu"])
    assert cli.main() == 0
    lines = _lines(capsys.readouterr().out)
    assert [line["event"] for line in lines] == ["page", "done"]
    assert lines[-1]["pages"] == 1


def test_cli_stream_and_stdout_are_rejected_before_the_run(quickstart, monkeypatch, capsys):
    _, _, seen = quickstart
    _set_argv(monkeypatch, [
        "minicpmvocr", "parse", "input.png", "--stream", "--stdout", "--device", "cpu"])
    with pytest.raises(SystemExit):
        cli.main()
    assert "--stream" in capsys.readouterr().err
    assert seen["configs"] == []


def test_stream_of_a_pdf_rendered_in_the_background(quickstart, monkeypatch):
    fitz = pytest.importorskip("fitz")
    root, _, _ = quickstart
    with fitz.open() as doc:
        for _ in range(9):
            doc.new_page(width=72, height=72)
        doc.save(root / "long.pdf")
    cfg = _parse_config(monkeypatch, root, ["long.pdf"])

    events = list(minicpmvocr.stream_pages(cfg, ordered=True))
    assert [event["page_index"] for event in events] == list(range(9))
    assert all(event["status"] == "ok" for event in events)
    # Nine pages are more than one rendering job, so they came through the background pool.
    assert cfg["_meta"]["render_workers"] != 1 and cfg["_meta"]["render_sec"] > 0


# --- dispatch order: a stream gets its pages one after another, not all at the end ----------

def test_staged_stream_recognizes_page_by_page(tmp_path, monkeypatch):
    from minicpmvocr import pipeline
    from tests.test_infer_scheduling import BLOCKS_PER_PAGE, PAGES, RecordingEngine, _build_run, _cfg

    def _pages_in_call_order(on_page):
        run_dir = _build_run(tmp_path / ("stream" if on_page else "batch"))
        engine = RecordingEngine()
        monkeypatch.setattr(staged, "create_backend", lambda cfg: engine)
        pipeline.infer_run(_cfg(run_dir, "concurrent", 1, 1), on_page=on_page)
        # _build_run makes every crop of page N exactly 20 + N pixels high.
        return [height - 20 for _width, height in engine.calls]

    grouped = [page for page in range(PAGES) for _ in range(BLOCKS_PER_PAGE)]
    seen = []
    assert _pages_in_call_order(seen.append) == grouped
    assert [event["image_id"] for event in seen] == [f"page{page}" for page in range(PAGES)]
    # Without a consumer the run keeps its fastest order: longest blocks first, across pages.
    assert _pages_in_call_order(None) != grouped


def test_overlapped_stream_recognizes_page_by_page(tmp_path, monkeypatch):
    import numpy as np
    from copy import deepcopy

    from minicpmvocr.config import DEFAULT_CONFIG
    from tests.test_crop_priority import LABELS, _MultiLabelDetector

    pages = 3
    all_laid_out = threading.Event()

    class PageCodedDetector(_MultiLabelDetector):
        cropped = 0

        def crop(self, image, detections):
            blocks = super().crop(image, detections)
            for block in blocks:
                # Page N is 60 + N pixels wide; its crops are 20 + N wide.
                block["image"] = np.full((10, image.width - 40, 3), 200, dtype=np.uint8)
            PageCodedDetector.cropped += 1
            if PageCodedDetector.cropped == pages:
                all_laid_out.set()
            return blocks

    class PageRecordingEngine(FakeEngine):
        def __init__(self):
            self.pages = []

        def recognize(self, image, prompt, max_new_tokens, slice_nums=None):
            if not self.pages:
                # Hold the first block until every page is queued, so the order is a choice.
                assert all_laid_out.wait(timeout=30)
                threading.Event().wait(0.3)
            self.pages.append(image.size[0] - 20)
            return {"text": "x", "output_token_count": 1}

    src = tmp_path / "src"
    src.mkdir()
    for page in range(pages):
        Image.fromarray(np.full((40, 60 + page, 3), 200, dtype=np.uint8)).save(src / f"p{page}.png")
    engine = PageRecordingEngine()
    monkeypatch.setattr(overlapped, "create_layout_detector", lambda c: PageCodedDetector(c))
    monkeypatch.setattr(overlapped, "create_backend", lambda c: engine)

    run_dir = tmp_path / "run"
    cfg = deepcopy(DEFAULT_CONFIG)
    cfg["run"].update({"run_tag": "t", "run_root": str(tmp_path), "mode": "full"})
    cfg["input"].update({"image_dir": str(src)})
    cfg["layout"].update({"provider": "fake", "device": "cpu"})
    cfg["pipeline"].update({"max_workers": 1, "layout_workers": 1, "overlap_layout": True})
    cfg["logging"]["progress_log_every"] = 1000
    cfg["_meta"] = {
        "run_dir": str(run_dir),
        "runtime_intermediate_dir": str(run_dir / "runtime" / "intermediate"),
    }
    finished = []
    overlapped.pipelined_run(cfg, on_page=lambda event: finished.append(event["image_id"]))

    assert engine.pages == [page for page in range(pages) for _ in LABELS]
    assert finished == ["p0", "p1", "p2"]


# --- models loaded once, used by several runs ----------------------------------------------

class CountingDetector(FakeDetector):
    started = 0
    stopped = 0

    def _start(self):
        CountingDetector.started += 1

    def stop(self):
        CountingDetector.stopped += 1
        super().stop()


@pytest.fixture
def loaded(quickstart, monkeypatch):
    from minicpmvocr.pipeline import _models

    CountingDetector.started = CountingDetector.stopped = 0
    monkeypatch.setattr(_models, "create_layout_detector", lambda config: CountingDetector(config))
    monkeypatch.setattr(_models, "build_upright_corrector", lambda config: None)
    return quickstart


@pytest.mark.parametrize("overlap", [True, False])
def test_loaded_models_serve_several_runs_without_reloading(loaded, monkeypatch, overlap):
    root, _, seen = loaded
    _images(root, ["second.png"])
    extra = ["--set", f"pipeline.overlap_layout={str(overlap).lower()}"]
    first = _parse_config(monkeypatch, root, ["input.png"], "--run-tag", "one", *extra)

    with minicpmvocr.load_models(first) as models:
        assert CountingDetector.started == 1
        assert [e["status"] for e in minicpmvocr.stream_pages(first, resources=models)] == ["ok"]
        second = _parse_config(monkeypatch, root, ["second.png"], "--run-tag", "two", *extra)
        assert [e["image_id"] for e in minicpmvocr.stream_pages(second, resources=models)] == ["second"]
        # Neither run built a detector of its own, and neither unloaded the shared one.
        assert seen["layouts"] == []
        assert (CountingDetector.started, CountingDetector.stopped) == (1, 0)
    assert CountingDetector.stopped == 1


def test_loaded_models_also_serve_a_run_that_is_not_streamed(loaded, monkeypatch):
    root, _, seen = loaded
    cfg = _parse_config(monkeypatch, root, ["input.png"])
    models = minicpmvocr.load_models(cfg)
    summary = minicpmvocr.pipelined_run(cfg, resources=models)
    assert summary["counts"]["ok"] == 1
    assert seen["layouts"] == [] and CountingDetector.stopped == 0
    models.close()
    assert CountingDetector.stopped == 1 and "detectors" not in models


def test_load_models_unloads_what_it_loaded_when_loading_fails(loaded, monkeypatch):
    from minicpmvocr.pipeline import _models

    root, _, _ = loaded
    cfg = _parse_config(monkeypatch, root, ["input.png"], "--set", "pipeline.layout_workers=2")

    def _no_upright(config):
        raise RuntimeError("upright model missing")

    monkeypatch.setattr(_models, "build_upright_corrector", _no_upright)
    with pytest.raises(RuntimeError, match="upright model missing"):
        minicpmvocr.load_models(cfg)
    assert (CountingDetector.started, CountingDetector.stopped) == (2, 2)


# --- a run nobody is streaming keeps the order that finishes the whole run soonest ---------

def test_a_run_that_is_not_streamed_renders_and_dispatches_as_before(quickstart, monkeypatch):
    root, _, _ = quickstart
    calls = []
    real = overlapped._iter_source_pages

    def _spy(cfg, runtime_intermediate, front_first=False):
        calls.append(front_first)
        return real(cfg, runtime_intermediate, front_first=front_first)

    priorities = []
    real_put = overlapped.PriorityQueue.put

    class RecordingQueue(overlapped.PriorityQueue):
        def put(self, item, *args, **kwargs):
            if item[-1] is not None:
                priorities.append(item[:2])
            return real_put(self, item, *args, **kwargs)

    monkeypatch.setattr(overlapped, "_iter_source_pages", _spy)
    monkeypatch.setattr(overlapped, "PriorityQueue", RecordingQueue)
    _images(root, ["second.png"])

    overlapped.pipelined_run(_parse_config(monkeypatch, root, ["input.png", "second.png"], "--run-tag", "plain"))
    plain = list(priorities)
    priorities.clear()
    overlapped.pipelined_run(
        _parse_config(monkeypatch, root, ["input.png", "second.png"], "--run-tag", "streamed"),
        on_page=lambda event: None)

    assert calls == [False, True]
    # Not streamed: keyed by the block alone (-token cap, -area), the same for both pages.
    assert len(set(plain)) == 1 and plain[0][0] < 0
    # Streamed: keyed by the page first.
    assert [priority[0] for priority in priorities] == [0, 1]


# --- finer events: the layout of a page, each block, the text while it is decoded ----------

class TypingEngine(FakeEngine):
    """Decodes "Recognized page." in three pieces, like a backend that streams."""

    pieces = ("Recog", "nized ", "page.")

    def recognize(self, image, prompt, max_new_tokens, slice_nums=None, on_delta=None):
        if on_delta is not None:
            for piece in self.pieces:
                on_delta(piece, False)
        return {"text": "".join(self.pieces), "output_token_count": 3}


@pytest.fixture
def typing(quickstart, monkeypatch):
    for module in (staged, overlapped):
        monkeypatch.setattr(module, "create_backend", lambda config: TypingEngine())
    return quickstart


def _kinds(events):
    return [event["event"] for event in events]


@pytest.mark.parametrize("overlap", [True, False])
def test_block_detail_reports_the_layout_then_each_block_then_the_page(typing, monkeypatch, overlap):
    root, _, _ = typing
    cfg = _parse_config(monkeypatch, root, ["input.png"],
                        "--set", f"pipeline.overlap_layout={str(overlap).lower()}")
    events = list(minicpmvocr.stream_pages(cfg, detail="block"))

    assert _kinds(events) == ["layout", "block", "page"]
    layout, block, page = events
    assert layout["blocks"] == [{"order": 0, "label": "text", "bbox": [0, 0, 40, 30]}]
    assert (layout["image_width"], layout["image_height"]) == (40, 30)
    assert (block["order"], block["label"], block["status"]) == (0, "text", "ok")
    assert block["content"] == "Recognized page."
    assert block["bbox"] == page["page"]["ocr"]["blocks"][0]["bbox"]
    assert {event["image_id"] for event in events} == {"input"}
    assert {event["index"] for event in events} == {0}


@pytest.mark.parametrize("overlap", [True, False])
def test_token_detail_passes_on_the_text_while_it_is_decoded(typing, monkeypatch, overlap):
    root, _, _ = typing
    cfg = _parse_config(monkeypatch, root, ["input.png"],
                        "--set", f"pipeline.overlap_layout={str(overlap).lower()}")
    events = list(minicpmvocr.stream_pages(cfg, detail="token"))

    assert _kinds(events) == ["layout", "delta", "delta", "delta", "block", "page"]
    deltas = [event for event in events if event["event"] == "delta"]
    assert [event["text"] for event in deltas] == list(TypingEngine.pieces)
    assert all(event["order"] == 0 and "restart" not in event for event in deltas)
    assert "".join(event["text"] for event in deltas) == events[-2]["content"] == events[-1]["markdown"]


def test_page_detail_never_asks_the_engine_to_stream(quickstart, monkeypatch):
    # FakeEngine.recognize takes no on_delta: being handed one would fail the block.
    root, _, _ = quickstart
    cfg = _parse_config(monkeypatch, root, ["input.png"])
    for detail in ("page", "block"):
        events = list(minicpmvocr.stream_pages(cfg, detail=detail))
        assert events[-1]["status"] == "ok"


def test_unknown_detail_is_rejected(quickstart, monkeypatch):
    root, _, _ = quickstart
    cfg = _parse_config(monkeypatch, root, ["input.png"])
    with pytest.raises(ValueError, match="stream detail"):
        list(minicpmvocr.stream_pages(cfg, detail="word"))


def test_input_order_puts_finer_events_in_reading_order():
    def page(index):
        return {"event": "page", "index": index, "pages_done": 0}

    def layout(index, orders):
        return {"event": "layout", "index": index, "blocks": [{"order": order} for order in orders]}

    def delta(index, order, text):
        return {"event": "delta", "index": index, "order": order, "text": text}

    def block(index, order):
        return {"event": "block", "index": index, "order": order}

    delivered = []
    ordered = InputOrder(delivered.append)

    def tags():
        seen = [(e["event"], e["index"], e.get("order"), e.get("text")) for e in delivered]
        delivered.clear()
        return seen

    # Page 1 is done before page 0 has said anything: all of it waits.
    for event in (layout(1, [0]), delta(1, 0, "x"), block(1, 0), page(1)):
        ordered(event)
    assert tags() == []

    # Page 0: its layout passes at once; block 1 is ahead of block 0 and waits.
    ordered(layout(0, [0, 1]))
    ordered(delta(0, 1, "late"))
    ordered(block(0, 1))
    assert tags() == [("layout", 0, None, None)]

    # Block 0 is the one whose turn it is: its text passes as it comes.
    ordered(delta(0, 0, "a"))
    assert tags() == [("delta", 0, 0, "a")]
    ordered(delta(0, 0, "b"))
    assert tags() == [("delta", 0, 0, "b")]

    # Finishing block 0 releases block 1, already complete.
    ordered(block(0, 0))
    assert tags() == [("block", 0, 0, None), ("delta", 0, 1, "late"), ("block", 0, 1, None)]

    # The page closes page 0 and lets all of page 1 through, in order.
    ordered(page(0))
    assert tags() == [("page", 0, None, None), ("layout", 1, None, None), ("delta", 1, 0, "x"),
                      ("block", 1, 0, None), ("page", 1, None, None)]


def test_input_order_does_not_lose_a_block_that_never_reported_finishing():
    delivered = []
    ordered = InputOrder(delivered.append)
    ordered({"event": "layout", "index": 0, "blocks": [{"order": 0}, {"order": 1}]})
    ordered({"event": "delta", "index": 0, "order": 1, "text": "kept"})
    ordered({"event": "page", "index": 0, "pages_done": 0})
    assert [(e["event"], e.get("text")) for e in delivered] == [
        ("layout", None), ("delta", "kept"), ("page", None)]


def test_ordered_token_stream_reads_like_the_document(typing, monkeypatch):
    root, _, _ = typing
    _images(root, ["second.png", "third.png"])
    cfg = _parse_config(monkeypatch, root, ["input.png", "second.png", "third.png"])
    events = list(minicpmvocr.stream_pages(cfg, ordered=True, detail="token"))

    per_page = ["layout", "delta", "delta", "delta", "block", "page"]
    assert _kinds(events) == per_page * 3
    assert [event["index"] for event in events] == [0] * 6 + [1] * 6 + [2] * 6
    assert [event["pages_done"] for event in events if event["event"] == "page"] == [1, 2, 3]


def test_cli_stream_detail_writes_the_finer_lines(typing, monkeypatch, capsys):
    _set_argv(monkeypatch, [
        "minicpmvocr", "parse", "input.png", "--stream-ordered", "--stream-detail", "token",
        "--device", "cpu"])
    assert cli.main() == 0
    lines = _lines(capsys.readouterr().out)
    assert _kinds(lines) == ["layout", "delta", "delta", "delta", "block", "page", "done"]
    assert "".join(line["text"] for line in lines if line["event"] == "delta") == "Recognized page."


def test_cli_stream_detail_needs_stream(quickstart, monkeypatch, capsys):
    _set_argv(monkeypatch, [
        "minicpmvocr", "parse", "input.png", "--stream-detail", "block", "--device", "cpu"])
    with pytest.raises(SystemExit):
        cli.main()
    assert "--stream-detail needs --stream" in capsys.readouterr().err
