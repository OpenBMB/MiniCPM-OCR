"""A Chromium that stays open, so requests stop paying to start one.

Measured on the subprocess path, rendering a batch costs 2.28s before the first
candidate is drawn and 0.13s per candidate after that. The fixed part is a Python
process start, a Playwright import, a Chromium launch and the browser contexts --
all of it repeated for every request, and all of it reusable. This module does it
once at start-up and keeps it.

It does not reimplement rendering. The render driver already exposes the two
seams a long-lived caller needs -- `open_browser_contexts` to build the contexts,
and `run_render_job(contexts=, sem=, render_module=)` to run a batch against them
-- and both paths go through that one copy of the orchestration. So the pixels
produced here are identical to the subprocess path by construction, not by two
implementations being kept in step. check_render_parity.py checks that claim
rather than trusting it.

The pool holds several browsers, not one, and that detail is the whole
performance story. Measured on 128 cores: a single kept-open Chromium saturates
at 9.4 candidates/s no matter how many pages are allowed, because one browser is
one set of processes; the subprocess path reached 43.7 candidates/s purely by
having thirty-two separate Chromiums running at once. Keeping a browser open
removes the start-up cost, and having several of them is what uses the machine.
One without the other loses most of the benefit, and the single-browser version
was slower than the thing it replaced.

So there are two knobs, and they do different jobs:

  * `browsers` -- how many Chromiums. This is the throughput knob; it scales with
    cores.
  * `pages_per_browser` -- how many pages render at once inside one of them. This
    is the per-request latency knob: a request with twenty candidates renders
    them this many at a time.

Each browser carries its own semaphore. A single process-wide one would let a
burst pile every page onto whichever browser was picked first; a per-request one
would be no cap at all, since thirty concurrent requests would each build their
own.

Precheck still runs as a Node subprocess per batch. At 0.2s it is the smaller
fixed cost by a wide margin, and it has no equivalent seam to hold open, so it is
left alone until measured to matter.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Sequence

MATERIAL_ROOT = Path(__file__).resolve().parent.parent
RENDERER_DIR = MATERIAL_ROOT / "renderer"

sys.path.insert(0, str(MATERIAL_ROOT))
sys.path.insert(0, str(RENDERER_DIR))

from rm_render import (  # noqa: E402
    KATEX_DIR,
    Candidate,
    RenderResult,
    check_assets,
    results_from_manifest,
    run_precheck,
)


log = logging.getLogger("rm.render")


def _driver() -> Any:
    """Import the render driver, with KaTeX assets pointed at the bundled copy.

    The render module resolves its assets at import time from KATEX_ASSET_DIR, so
    this has to be set before the import rather than before a render call.
    """
    os.environ.setdefault("KATEX_ASSET_DIR", str(KATEX_DIR))
    import render_triple_rm_labels as driver

    browsers = getattr(driver, "DEFAULT_PLAYWRIGHT_BROWSERS_PATH", None)
    if browsers is not None and Path(browsers).exists():
        os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(browsers))

    # The driver prints its progress, which is right for a one-shot command and
    # wrong for a service: a few lines per request, interleaved across concurrent
    # requests, burying everything else in the log. Rebinding `print` in the
    # driver's own namespace sends those lines to a logger instead -- still
    # reachable at debug level, no longer the loudest thing in the output, and
    # done without editing the driver, which both paths share.
    #
    # `redirect_stdout` would not do: it is process-wide, and under concurrency
    # one request leaving the context would unredirect the others.
    driver.print = lambda *parts, **_: log.debug(" ".join(str(p) for p in parts))
    return driver


class _Slot:
    """One Chromium, its contexts, and the cap on pages rendering inside it."""

    def __init__(self, index: int, pages: int) -> None:
        self.index = index
        self.browser: Any = None
        self.contexts: dict[bool, Any] | None = None
        self.sem = asyncio.Semaphore(pages)
        self.lock = asyncio.Lock()   # serialises this slot's launches
        self.inflight = 0
        self.restarts = 0


class RenderPool:
    """Several browsers, kept open, shared by every request this process handles."""

    def __init__(self, *, browsers: int = 4, pages_per_browser: int = 8,
                 precheck: bool = True) -> None:
        self.browsers = max(1, browsers)
        self.pages_per_browser = max(1, pages_per_browser)
        self.precheck = precheck
        self._driver: Any = None
        self._render_module: Any = None
        self._playwright: Any = None
        self._slots: list[_Slot] = []
        self.started_at: float | None = None

    # -- lifecycle ----------------------------------------------------------

    async def start(self) -> None:
        check_assets(require_node=self.precheck)
        self._driver = _driver()
        self._render_module = self._driver.load_render_module(RENDERER_DIR / "render_module")

        from playwright.async_api import async_playwright

        # One Playwright host process drives every browser; only the browsers
        # themselves need to be separate.
        self._playwright = await async_playwright().start()
        self._slots = [_Slot(i, self.pages_per_browser) for i in range(self.browsers)]
        await asyncio.gather(*(self._launch(slot) for slot in self._slots))
        self.started_at = time.time()

    async def _launch(self, slot: _Slot) -> None:
        slot.browser = await self._playwright.chromium.launch(headless=True)
        slot.contexts = await self._driver.open_browser_contexts(
            slot.browser, self._render_module)

    async def _shutdown(self, slot: _Slot) -> None:
        for close in ([c.close for c in (slot.contexts or {}).values()]
                      + [getattr(slot.browser, "close", None)]):
            if close is None:
                continue
            try:
                await asyncio.wait_for(close(), timeout=10)
            except Exception:  # noqa: BLE001 - shutting down; nothing to recover
                pass
        slot.contexts = slot.browser = None

    async def close(self) -> None:
        await asyncio.gather(*(self._shutdown(slot) for slot in self._slots))
        if self._playwright is not None:
            try:
                await asyncio.wait_for(self._playwright.stop(), timeout=10)
            except Exception:  # noqa: BLE001
                pass
            self._playwright = None

    async def _ensure_alive(self, slot: _Slot) -> None:
        """Relaunch a browser that has died.

        A dead Chromium otherwise turns into every subsequent request on that
        slot failing with an unrecognisable Playwright error, which reads like
        the model having gone wrong rather than a browser having gone away.

        The per-slot lock matters: without it, several requests noticing the same
        dead browser would each launch a replacement, and all but one would leak.
        """
        if slot.browser is not None and slot.browser.is_connected():
            return
        async with slot.lock:
            if slot.browser is not None and slot.browser.is_connected():
                return
            await self._shutdown(slot)
            await self._launch(slot)
            slot.restarts += 1

    def _pick(self) -> _Slot:
        """The least loaded browser, counted in candidates rather than requests.

        Requests carry anywhere from one candidate to a few dozen, so spreading
        requests evenly would not spread the work evenly.
        """
        return min(self._slots, key=lambda s: s.inflight)

    # -- work ---------------------------------------------------------------

    async def render(self, candidates: Sequence[Candidate], work_dir: Path,
                     timings: dict[str, float] | None = None) -> list[RenderResult]:
        """Precheck, then render whatever survived. One result per candidate.

        `timings` is filled with the two stages separately, because they have
        different fixed costs and different cures: the browser is now shared,
        Node still starts per batch.
        """
        if not candidates:
            return []
        if not self._slots:
            raise RuntimeError("RenderPool.start() has not been called")

        seen: set[str] = set()
        for c in candidates:
            if c.case_id in seen:
                raise ValueError(f"duplicate case_id {c.case_id!r}; case ids must be unique")
            seen.add(c.case_id)

        work = Path(work_dir)
        work.mkdir(parents=True, exist_ok=True)

        rejected: dict[str, dict[str, Any]] = {}
        if self.precheck:
            # Node runs out of process and blocks; off the event loop it goes,
            # or it stalls every other request in flight.
            t0 = time.perf_counter()
            rejected = await asyncio.to_thread(run_precheck, list(candidates), work)
            if timings is not None:
                timings["precheck_sec"] = round(time.perf_counter() - t0, 6)

        survivors = [c for c in candidates if c.case_id not in rejected]
        manifest: dict[str, dict[str, Any]] = {}
        if survivors:
            slot = self._pick()
            slot.inflight += len(survivors)
            try:
                await self._ensure_alive(slot)
                t0 = time.perf_counter()
                rows = await self._run_job(survivors, work, slot)
                if timings is not None:
                    timings["browser_sec"] = round(time.perf_counter() - t0, 6)
                    timings["browser_slot"] = float(slot.index)
            finally:
                slot.inflight -= len(survivors)
            manifest = {str(row["case_id"]): row for row in rows}

        return results_from_manifest(candidates, rejected, manifest)

    async def _run_job(self, candidates: Sequence[Candidate], work: Path,
                       slot: _Slot) -> list[dict[str, Any]]:
        render_in = work / "render_input.jsonl"
        # Only these four top-level fields are accepted; the driver rejects any
        # others rather than ignoring them.
        render_in.write_text("".join(
            json.dumps({
                "case_id": c.case_id,
                "image_path": str(Path(c.image_path).resolve()),
                "label_text": c.text,
                "category": c.category,
            }, ensure_ascii=False) + "\n"
            for c in candidates
        ), encoding="utf-8")
        # The driver takes its configuration as a parsed argv namespace. Building
        # one here keeps the pool on the same entry point as the CLI instead of
        # reaching past it into internals that the CLI does not use.
        args = argparse.Namespace(
            input_jsonl=render_in,
            output_dir=work / "render",
            render_module_dir=RENDERER_DIR / "render_module",
            playwright_browsers_path=None,
            path_remap=[],
            num_shards=1,
            shard_id=0,
            max_samples=None,
            formula_concurrency=self.pages_per_browser,
            browser_concurrency=self.pages_per_browser,
            clean=True,
        )
        return await self._driver.run_render_job(
            args,
            contexts=slot.contexts,
            sem=slot.sem,
            render_module=self._render_module,
        )

    # -- introspection ------------------------------------------------------

    def describe(self) -> dict[str, Any]:
        module = self._render_module
        return {
            "mode": "persistent",
            "browsers": self.browsers,
            "browsers_alive": sum(1 for s in self._slots
                                  if s.browser is not None and s.browser.is_connected()),
            "pages_per_browser": self.pages_per_browser,
            "precheck": self.precheck,
            "restarts": sum(s.restarts for s in self._slots),
            "uptime_sec": round(time.time() - self.started_at, 1) if self.started_at else None,
            "pipeline": getattr(module, "RENDER_PIPELINE_VERSION", "unknown"),
            "katex": getattr(module, "KATEX_PINNED_VERSION", "unknown"),
        }
