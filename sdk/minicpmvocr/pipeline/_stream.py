'Per-page results while a run is still going.'
from __future__ import annotations

import logging
import threading
from pathlib import Path
from queue import Queue
from typing import Callable, Dict, Iterator, List, Optional

from ._response import RESPONSE_DIRNAME
from ._sources import page_lookup, read_sources
from ._text import _normalize_and_dedupe_blocks
from .._utils import read_json


LOGGER = logging.getLogger(__name__)

PageCallback = Callable[[Dict], None]


#: How fine the events are: whole pages, also their layout and blocks, also the
#: text of each block while it is decoded.
DETAILS = ("page", "block", "token")


class PageReporter:
    """Turn what a run finishes into events and hand them to ``on_page``.

    ``detail`` says how fine. "page": one ``page`` event per finished page.
    "block": before it, a ``layout`` event when the page is laid out and a
    ``block`` event for each of its blocks as it is recognized. "token": also
    ``delta`` events carrying a block's text while it is being decoded.

    Pages are reported from the thread that drives the run, in the order they
    finish, which is not the input order; blocks and text come from the threads
    that recognize them. The callback is still never in two calls at once.
    """

    def __init__(self, run_dir: Path, planned_ids: List[str], on_page: PageCallback,
                 detail: str = "page") -> None:
        if detail not in DETAILS:
            raise ValueError("stream detail must be one of %s, got %r" % (", ".join(DETAILS), detail))
        self.blocks = detail != "page"
        self.tokens = detail == "token"
        self._run_dir = Path(run_dir)
        self._on_page = on_page
        self._lock = threading.Lock()
        self._lookup = page_lookup(read_sources(self._run_dir))
        # Input order is the manifest's; pages it does not list keep theirs, after it.
        rank = {image_id: position for position, image_id in enumerate(self._lookup)}
        in_order = sorted(planned_ids, key=lambda image_id: rank.get(image_id, len(rank)))
        self._index = {image_id: position for position, image_id in enumerate(in_order)}
        self._done = 0

    def _emit(self, event: Dict) -> None:
        with self._lock:
            try:
                self._on_page(event)
            except Exception:
                # What was parsed is on disk either way; a broken consumer must not cost the run.
                LOGGER.exception("on_page callback failed for the %s event of %s",
                                 event["event"], event["image_id"])

    def _where(self, image_id: str) -> Dict:
        origin = self._lookup.get(image_id, {})
        return {
            # Position in input order across the whole run, from 0.
            "index": self._index.setdefault(image_id, len(self._index)),
            "image_id": image_id,
            "source_id": origin.get("source_id", ""),
            "source": origin.get("path", ""),
            # Position inside its own input file, from 0.
            "page_index": origin.get("order", 0),
        }

    def layout(self, image_id: str, layout: Dict) -> None:
        'The page is laid out: which blocks it has, before any of them is recognized.'
        if not self.blocks:
            return
        self._emit({
            "event": "layout",
            **self._where(image_id),
            "image_width": layout.get("image_width"),
            "image_height": layout.get("image_height"),
            "blocks": [
                {"order": block.get("order", 0), "label": block.get("label", ""), "bbox": block.get("bbox")}
                for block in layout.get("blocks") or []
            ],
        })

    def block(self, image_id: str, result_block: Dict) -> None:
        """One block is recognized.

        Its content is tidied the way the page will tidy it. What only the whole
        page can settle (figures referenced from a table) may still change it.
        """
        if not self.blocks:
            return
        tidied = _normalize_and_dedupe_blocks([result_block])[0]
        self._emit({
            "event": "block",
            **self._where(image_id),
            "order": tidied.get("order", 0),
            "label": tidied.get("label", ""),
            "bbox": tidied.get("bbox"),
            "status": tidied.get("status", ""),
            "content": tidied.get("content", ""),
        })

    def delta_listener(self, image_id: str, block: Dict):
        'What to hand a recognition request so that its text is passed on; None when nobody asked.'
        if not self.tokens:
            return None
        index = self._where(image_id)["index"]
        order = block.get("order", 0)

        def _on_delta(text: str, restart: bool = False) -> None:
            event = {"event": "delta", "index": index, "image_id": image_id, "order": order, "text": text}
            if restart:
                # The request was sent again: drop the text this block had so far.
                event["restart"] = True
            self._emit(event)

        return _on_delta

    def report(self, result: Dict) -> None:
        'One page is finished.'
        row = result["page_row"]
        image_id = row["image_id"]
        self._done += 1
        page = None
        markdown = ""
        md_path = self._run_dir / "output" / f"{image_id}.md"
        if row["status"] != "failed":
            page = read_json(self._run_dir / RESPONSE_DIRNAME / f"{image_id}.json", default=None)
            if page is not None:
                markdown = page["choices"][0]["message"]["content"]
            elif md_path.is_file():
                # A page resumed from a run written before pages_json existed.
                markdown = md_path.read_text(encoding="utf-8")
        event = {
            "event": "page",
            **self._where(image_id),
            "pages_done": self._done,
            "pages_total": len(self._index),
            "status": row["status"],
            "error": row.get("error", ""),
            "markdown": markdown,
            # imgs/ links in the Markdown are relative to this file's directory.
            "output_md": str(md_path) if md_path.is_file() else "",
            "page": page,
        }
        if page is not None:
            event["page_index"] = page["metadata"]["page_index"]
        self._emit(event)


class _HeldPage:
    'What has arrived about one page that is not yet due.'

    def __init__(self) -> None:
        self.layout: Optional[Dict] = None
        self.orders: List = []          # block orders, in reading order
        self.cursor = 0                 # the block being delivered
        self.blocks: Dict = {}          # order -> its delta and block events, oldest first
        self.page: Optional[Dict] = None


class InputOrder:
    """Wrap ``on_page`` so everything arrives in reading order.

    Pages come in input order: a page that finishes early waits for the ones
    before it, and ``pages_done`` then counts the pages delivered so far. With
    finer events the same holds inside a page: its ``layout`` first, then block
    after block in reading order, each block's ``delta`` events followed by its
    ``block`` event, then the ``page``. The block whose turn it is passes
    through as it happens; whatever is ahead of its turn waits.
    """

    def __init__(self, on_page: PageCallback) -> None:
        self._on_page = on_page
        self._held: Dict[int, _HeldPage] = {}
        self._next = 0
        self._delivered = 0

    def __call__(self, event: Dict) -> None:
        held = self._held.setdefault(event["index"], _HeldPage())
        kind = event["event"]
        if kind == "page":
            held.page = event
        elif kind == "layout":
            held.layout = event
            held.orders = [block["order"] for block in event["blocks"]]
        else:
            held.blocks.setdefault(event["order"], []).append(event)
        self._drain()

    def _drain(self) -> None:
        while self._next in self._held:
            held = self._held[self._next]
            if held.layout is not None:
                layout, held.layout = held.layout, None
                self._on_page(layout)
            while held.cursor < len(held.orders):
                waiting = held.blocks.get(held.orders[held.cursor], [])
                finished = False
                while waiting and not finished:
                    event = waiting.pop(0)
                    finished = event["event"] == "block"
                    self._on_page(event)
                if not finished:
                    break
                held.cursor += 1
            if held.page is None:
                return
            # Move on first: a consumer that raises must not block the pages after it.
            del self._held[self._next]
            self._next += 1
            self._deliver_rest(held)

    def _deliver_rest(self, held: _HeldPage) -> None:
        if held.layout is not None:
            self._on_page(held.layout)
        # Blocks that never reported being finished still hand over what they had.
        known = [order for order in held.orders[held.cursor:] if order in held.blocks]
        for order in known + [order for order in held.blocks if order not in known]:
            for event in held.blocks[order]:
                self._on_page(event)
        if held.page is not None:
            self._delivered += 1
            held.page["pages_done"] = self._delivered
            self._on_page(held.page)

    def flush(self) -> None:
        'Deliver what is still waiting, for a run that ended with pages missing.'
        for index in sorted(self._held):
            self._deliver_rest(self._held.pop(index))


def run_pages(cfg: Dict, on_page: Optional[PageCallback] = None,
              resources: Optional[Dict] = None, detail: str = "page") -> tuple:
    'Run layout and recognition the way the config asks; returns (layout_summary, infer_summary).'
    if bool(cfg["pipeline"].get("overlap_layout", False)):
        from .overlapped import pipelined_run

        infer_summary = pipelined_run(cfg, resources, on_page=on_page, stream_detail=detail)
        return {"overlapped": True, **infer_summary.get("pipelined", {})}, infer_summary

    from .staged import infer_run, parse_layout_run, prepare_run

    layout_summary = parse_layout_run(cfg, resources)
    prepare_run(cfg)
    return layout_summary, infer_run(cfg, on_page=on_page, stream_detail=detail)


def stream_pages(cfg: Dict, *, ordered: bool = False, resources: Optional[Dict] = None,
                 detail: str = "page") -> Iterator[Dict]:
    """Run the pipeline and yield one event per page as soon as that page is done.

    ``detail="block"`` also yields a ``layout`` event when a page is laid out and
    a ``block`` event for each block as it is recognized; ``detail="token"``
    also yields ``delta`` events with a block's text while it is being decoded.

    Events come as things finish; ``ordered=True`` puts them in reading order,
    holding back whatever is ahead of its turn. The run itself happens on a
    background thread, and the generator's return value is its summary. A page
    that failed is yielded with ``status == "failed"``; an error that stops the
    whole run is raised once the pages finished before it have been yielded.

    Closing the generator early does not cancel the run: the remaining pages
    are still parsed in the background and written to the run directory.

    ``resources`` from ``load_models`` keeps the layout models loaded between
    calls, so only the first one waits for them.
    """
    done = object()
    events: Queue = Queue()
    closed = threading.Event()
    outcome: Dict = {}

    def _put(event: Dict) -> None:
        if not closed.is_set():
            events.put(event)

    sink = InputOrder(_put) if ordered else _put

    def _run() -> None:
        try:
            outcome["summary"] = run_pages(cfg, sink, resources, detail)[1]
        except BaseException as exc:
            outcome["error"] = exc
        finally:
            if isinstance(sink, InputOrder):
                sink.flush()
            events.put(done)

    worker = threading.Thread(target=_run, name="minicpmvocr-stream", daemon=True)
    worker.start()
    try:
        while True:
            event = events.get()
            if event is done:
                break
            yield event
    finally:
        closed.set()
    worker.join()
    if "error" in outcome:
        raise outcome["error"]
    return outcome["summary"]
