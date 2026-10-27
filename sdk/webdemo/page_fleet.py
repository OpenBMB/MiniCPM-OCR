#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import shutil
import socket
import threading
import time
import urllib.request
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path
from typing import Dict, List, Optional

from model_manager import DATA_DIR, JOBS_DIR, new_job_id

PAGE_REGISTRY = Path(os.environ.get(
    "OCR_PAGE_REGISTRY",
    DATA_DIR / "page-workers",
))


def page_slots() -> int:
    '一台机器同时能收下多少页。版面模型检测完就还，这个数按 vLLM 积压来定。'
    return max(1, int(os.environ.get("OCR_PAGE_SLOTS", "64") or 64))


def page_window() -> int:
    '一本书同时发出去的页数。上一页的版面还没回来，下一页也可以先送。'
    return max(1, int(os.environ.get("OCR_PAGE_WINDOW", "8") or 8))


def fleet_enabled() -> bool:
    '远程机器登记之后，新的整本解析才按页分发。工人进程自己不再往外分。'
    if os.environ.get("OCR_PAGE_ROLE") == "worker":
        return False
    return bool(_read_remotes())


def dispatch_file(job_id: str, local_path: str, runner, upright=None) -> None:
    '一本书同时送出多页。某一页的版面还没结束，后面的页也可以先发出去。'
    fleet = get_fleet()
    pages = _iter_pages(local_path)
    finishes = {}
    layout_futs: Dict = {}
    error: Optional[BaseException] = None
    exhausted = False
    window = page_window()
    try:
        with ThreadPoolExecutor(max_workers=page_slots() * 4 + window, thread_name_prefix="book-page") as pool:
            while finishes or layout_futs or not exhausted:
                while len(layout_futs) < window and not exhausted and error is None:
                    try:
                        layout_index, png = next(pages)
                    except StopIteration:
                        exhausted = True
                        break
                    layout_futs[pool.submit(fleet.start, runner, png, upright)] = layout_index
                pending = set(finishes) | set(layout_futs)
                if not pending:
                    break
                done, _ = wait(pending, return_when=FIRST_COMPLETED)
                for fut in done:
                    if fut not in layout_futs:
                        continue
                    index = layout_futs.pop(fut)
                    try:
                        inflight = fut.result()
                    except BaseException as exc:
                        error = error or exc
                    else:
                        finishes[pool.submit(inflight.markdown)] = index
                for fut in done:
                    if fut not in finishes:
                        continue
                    index = finishes.pop(fut)
                    try:
                        markdown = fut.result()
                    except BaseException as exc:
                        error = error or exc
                        continue
                    if error is None:
                        _write_page(job_id, index, markdown)
    finally:
        pages.close()
    if error is not None:
        raise error


class PageHandle:
    '一页的两段：版面结束就可以收下一块模型，markdown 要等切片队列。'

    def __init__(self) -> None:
        self.layout_done = threading.Event()
        self.done = threading.Event()
        self.laid_out = False
        self.error: Optional[BaseException] = None
        self.markdown = ""
        self.blocks: List[Dict] = []
        self.image_width = 0
        self.image_height = 0
        self.source_width = 0
        self.source_height = 0
        self.rotation = None


def run_releasing_layout(runner, cfg, on_layout_idle=None):
    '版面生产者结束后立刻归还检测器，切片继续在共享队列里跑。'
    from minicpmvocr import pipelined_run
    released = {"ok": False}
    slot = runner.borrow(cfg)

    def _idle() -> None:
        if not released["ok"]:
            released["ok"] = True
            runner.release(slot)
        if on_layout_idle is not None:
            on_layout_idle()

    try:
        return pipelined_run(cfg, resources=runner.resources_for(slot), on_layout_idle=_idle)
    finally:
        if not released["ok"]:
            runner.release(slot)


def launch_local_page(runner, png_bytes: bytes, upright=None) -> PageHandle:
    '后台识别一页。版面结束时 handle.layout_done 置位，整页结束时 handle.done 置位。'
    handle = PageHandle()

    def work() -> None:
        job_id = new_job_id()
        job_dir = JOBS_DIR / job_id
        try:
            input_dir = job_dir / "input"
            input_dir.mkdir(parents=True, exist_ok=True)
            (input_dir / "page.png").write_bytes(png_bytes)
            cfg = runner.build_cfg(
                job_id, upright=resolve_upright(upright), mode="ocr", save_crops=False,
            )

            def _laid_out() -> None:
                handle.laid_out = True
                handle.layout_done.set()

            run_releasing_layout(runner, cfg, on_layout_idle=_laid_out)
            result_path = job_dir / "results_json" / "page.json"
            result = json.loads(result_path.read_text(encoding="utf-8"))
            layout_path = job_dir / "runtime" / "intermediate" / "layouts" / "page.json"
            layout = {}
            if layout_path.is_file():
                layout = json.loads(layout_path.read_text(encoding="utf-8"))
            handle.markdown = result.get("markdown") or ""
            slices = _public_slices(result, layout)
            handle.blocks = slices["blocks"]
            handle.image_width = slices["image_width"]
            handle.image_height = slices["image_height"]
            handle.rotation = slices["rotation"]
            handle.source_width, handle.source_height = _png_size(png_bytes)
        except BaseException as exc:
            handle.error = exc
        finally:
            shutil.rmtree(job_dir, ignore_errors=True)
            handle.layout_done.set()
            handle.done.set()

    threading.Thread(target=work, name="local-page", daemon=True).start()
    return handle


def run_local_page(runner, png_bytes: bytes) -> str:
    '同步识别一页。远程接口改走票据，这里留给需要整页结果的调用。'
    handle = launch_local_page(runner, png_bytes)
    handle.done.wait()
    if handle.error is not None:
        raise handle.error
    return handle.markdown


_TICKETS: Dict[str, tuple] = {}
_TICKET_LOCK = threading.Lock()


def remember(handle: PageHandle) -> str:
    ticket = new_job_id()
    with _TICKET_LOCK:
        _TICKETS[ticket] = (handle, time.time())
    return ticket


def take_markdown(ticket: str):
    '解码没完返回 None。完成则取出这一页的正文和切片，失败则抛出。'
    with _TICKET_LOCK:
        item = _TICKETS.get(ticket)
    if item is None:
        raise KeyError(ticket)
    handle, _created = item
    if not handle.done.is_set():
        return None
    with _TICKET_LOCK:
        _TICKETS.pop(ticket, None)
    if handle.error is not None:
        raise handle.error
    return _page_payload(handle)


def coerce_upright(value):
    '请求里的摆正开关。缺省是 None，由解析端按现有配置决定。'
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    raise ValueError("upright 需要是 true 或 false")


def resolve_upright(choice) -> bool:
    '显式 false 时跳过摆正。其余情况仍要本机有摆正模型才开启。'
    if choice is False:
        return False
    upright_dir = os.environ.get("OCR_UPRIGHT_DIR", "")
    return bool(upright_dir and Path(upright_dir).is_dir())


class _Slot:
    def __init__(self, name: str, capacity: int, upright_choice: bool = False):
        self.name = name
        self.capacity = max(0, int(capacity))
        self.upright_choice = bool(upright_choice)
        self.inflight = 0
        self.down_until = 0.0


class PageFleet:
    def __init__(self) -> None:

        local_cap = 0 if os.environ.get("OCR_PAGE_ROLE") == "dispatcher" else page_slots()
        self._local = _Slot("local", local_cap)
        self._remotes: Dict[str, _Slot] = {}
        self._cv = threading.Condition()
        self._refreshed_at = 0.0
        self._turn = 0

    def start(self, runner, png_bytes: bytes, upright=None) -> "_Inflight":
        '占一个页名额，等到这一页的摆正和版面结束就返回。切片还在解码。'
        tried: List[str] = []
        last = "没有可以关闭摆正的解析机器" if upright is False else "没有可用的解析机器"
        while len(tried) < 6:
            slot = self._acquire(exclude=set(tried), upright=upright)
            if slot is None:
                break
            try:
                if slot.name == "local":
                    handle = launch_local_page(runner, png_bytes, upright)
                    if not handle.layout_done.wait(600):
                        raise TimeoutError("版面超时")
                    if handle.error is not None and not handle.laid_out:
                        raise handle.error
                    return _Inflight(self, slot, handle)
                kind, value = _remote_layout(slot.name, png_bytes, upright)
                if kind == "done":
                    return _Inflight(self, slot, ("done", value))
                return _Inflight(self, slot, ("ticket", slot.name, value))
            except Exception as exc:
                last = str(exc) or exc.__class__.__name__
                with self._cv:
                    slot.down_until = time.time() + 30
                    slot.inflight = max(0, slot.inflight - 1)
                    self._cv.notify_all()
                tried.append(slot.name)
        raise RuntimeError(last)

    def _acquire(self, exclude: set, upright=None) -> Optional[_Slot]:
        with self._cv:
            deadline = time.time() + 600
            while time.time() < deadline:
                self._refresh_locked()
                now = time.time()
                choices = [
                    slot for slot in [self._local] + list(self._remotes.values())
                    if slot.name not in exclude and slot.down_until <= now
                ]

                if upright is False:
                    capable = [slot for slot in choices if slot.upright_choice]
                    if not capable:
                        return None
                    choices = capable
                if not choices:
                    return None
                free = [slot for slot in choices if slot.inflight < slot.capacity]
                if free:

                    best = max(slot.capacity - slot.inflight for slot in free)
                    tied = [slot for slot in free if slot.capacity - slot.inflight == best]
                    tied.sort(key=lambda item: item.name)
                    slot = tied[self._turn % len(tied)]
                    self._turn += 1
                    slot.inflight += 1
                    return slot
                self._cv.wait(timeout=0.5)
        return None

    def _release(self, slot: _Slot) -> None:
        with self._cv:
            slot.inflight = max(0, slot.inflight - 1)
            self._cv.notify_all()

    def _refresh_locked(self) -> None:
        now = time.time()
        if now - self._refreshed_at < 5:
            return
        self._refreshed_at = now
        found = _read_remotes()
        for url in list(self._remotes):
            if url not in found and self._remotes[url].inflight == 0:
                del self._remotes[url]
        for url, spec in found.items():
            slots, choice = spec
            current = self._remotes.get(url)
            if current is None:
                self._remotes[url] = _Slot(url, slots, upright_choice=choice)
            else:
                current.capacity = slots
                current.upright_choice = choice


_FLEET: Optional[PageFleet] = None
_FLEET_LOCK = threading.Lock()


def get_fleet() -> PageFleet:
    global _FLEET
    with _FLEET_LOCK:
        if _FLEET is None:
            _FLEET = PageFleet()
        return _FLEET


def _read_remotes() -> Dict[str, tuple]:
    found: Dict[str, tuple] = {}
    if not PAGE_REGISTRY.is_dir():
        return found
    now = time.time()
    for path in PAGE_REGISTRY.glob("*.json"):
        try:
            if now - path.stat().st_mtime > 90:
                continue
            row = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        url = str(row.get("url") or "").rstrip("/")

        if url and int(row.get("slices") or 0) >= 1:
            found[url] = (max(1, int(row.get("slots") or 8)), bool(row.get("upright_choice")))
    return found


def _opener():
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _remote_layout(url: str, png_bytes: bytes, upright=None) -> str:

    headers = {"Content-Type": "image/png"}
    if upright is False:
        headers["X-OCR-Upright"] = "0"
    request = urllib.request.Request(
        url + "/api/page-parse",
        data=png_bytes,
        headers=headers,
        method="POST",
    )
    with _opener().open(request, timeout=180) as response:
        body = json.loads(response.read().decode("utf-8"))
    if body.get("error"):
        raise RuntimeError(str(body["error"]))
    ticket = body.get("ticket")
    if ticket:
        return ("ticket", str(ticket))
    if "markdown" in body:
        return ("done", body.get("markdown") or "")
    raise RuntimeError("远程没有返回页票据")


def _remote_markdown(url: str, ticket: str) -> str:
    deadline = time.time() + 360
    while time.time() < deadline:
        request = urllib.request.Request(url + "/api/page-markdown/" + ticket, method="GET")
        with _opener().open(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
        if body.get("error"):
            raise RuntimeError(str(body["error"]))
        if body.get("ready"):
            return _payload_from_body(body)
        time.sleep(0.3)
    raise TimeoutError("远程切片超时")


class _Inflight:


    def __init__(self, fleet: "PageFleet", slot: _Slot, payload) -> None:
        self._fleet = fleet
        self._slot = slot
        self._payload = payload
        self._released = False

    def markdown(self) -> Dict:
        try:
            if isinstance(self._payload, PageHandle):
                self._payload.done.wait()
                if self._payload.error is not None:
                    raise self._payload.error
                return _page_payload(self._payload)
            kind = self._payload[0]
            if kind == "done":
                return _payload_from_body({"markdown": self._payload[1]})
            _kind, url, ticket = self._payload
            return _remote_markdown(url, ticket)
        finally:
            self._fleet._release(self._slot)


def _iter_pages(local_path: str):
    path = Path(local_path)
    if path.suffix.lower() != ".pdf":
        yield 0, path.read_bytes()
        return
    import fitz
    from minicpmvocr.constants import PDF_RENDER_ZOOM
    doc = fitz.open(path)
    try:
        matrix = fitz.Matrix(PDF_RENDER_ZOOM, PDF_RENDER_ZOOM)
        for index in range(doc.page_count):
            pix = doc.load_page(index).get_pixmap(matrix=matrix, alpha=False)
            yield index, pix.tobytes("png")
    finally:
        doc.close()


def _page_payload(handle: PageHandle) -> Dict:
    return {
        "markdown": handle.markdown or "",
        "image_width": handle.image_width or 0,
        "image_height": handle.image_height or 0,
        "source_width": handle.source_width or 0,
        "source_height": handle.source_height or 0,
        "rotation": handle.rotation,
        "blocks": handle.blocks or [],
    }


def _payload_from_body(body: Dict) -> Dict:
    return {
        "markdown": body.get("markdown") or "",
        "image_width": body.get("image_width") or 0,
        "image_height": body.get("image_height") or 0,
        "source_width": body.get("source_width") or 0,
        "source_height": body.get("source_height") or 0,
        "rotation": body.get("rotation"),
        "blocks": body.get("blocks") or [],
    }


def _public_slices(result: Dict, layout: Dict) -> Dict:

    layout = layout or {}
    by_crop = {
        block.get("crop_filename", ""): block
        for block in (result.get("crop_blocks") or [])
    }
    blocks = []
    for item in layout.get("blocks") or []:
        found = by_crop.get(item.get("crop_filename", ""), {})
        bbox = item.get("bbox") or found.get("bbox") or [0, 0, 0, 0]
        blocks.append({
            "order": item.get("order", 0),
            "label": item.get("label") or found.get("label") or "",
            "bbox": bbox,
            "regions": item.get("regions") or [bbox],
            "content": found.get("content") or "",
            "status": found.get("status") or "",
        })
    if not blocks:
        for found in result.get("crop_blocks") or []:
            bbox = found.get("bbox") or [0, 0, 0, 0]
            blocks.append({
                "order": found.get("order", 0),
                "label": found.get("label") or "",
                "bbox": bbox,
                "regions": found.get("regions") or [bbox],
                "content": found.get("content") or "",
                "status": found.get("status") or "",
            })
    return {
        "image_width": result.get("image_width") or layout.get("image_width") or 0,
        "image_height": result.get("image_height") or layout.get("image_height") or 0,
        "rotation": _public_rotation(layout),
        "blocks": blocks,
    }


def _png_size(png_bytes: bytes):

    import io
    from PIL import Image
    with Image.open(io.BytesIO(png_bytes)) as image:
        return image.size


def _public_rotation(layout: Dict):

    raw = (layout or {}).get("upright")
    if not raw:
        return None
    if raw.get("gated"):
        return {
            "applied": False,
            "total_angle": 0.0,
            "orientation_angle": 0,
            "deskew_angle": 0.0,
            "skipped_reason": "gated",
        }
    return {
        "applied": bool(raw.get("applied")),
        "total_angle": float(raw.get("correction") or 0.0),
        "orientation_angle": int(raw.get("label") or 0),
        "deskew_angle": float(raw.get("deskew") or 0.0),
        "skipped_reason": None,
    }


def _write_page(job_id: str, index: int, page) -> None:
    path = JOBS_DIR / job_id / "results_json" / f"book_page_{index + 1:03d}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(page, str):
        page = _payload_from_body({"markdown": page})
    payload = {
        "page_index": index,
        "image_id": f"book_page_{index + 1:03d}",
        "markdown": page.get("markdown") or "",
        "image_width": page.get("image_width") or 0,
        "image_height": page.get("image_height") or 0,
        "source_width": page.get("source_width") or 0,
        "source_height": page.get("source_height") or 0,
        "rotation": page.get("rotation"),
        "blocks": page.get("blocks") or [],
    }
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _own_ip() -> str:
    configured = os.environ.get("OCR_ADVERTISE_HOST", "").strip()
    if configured:
        return configured
    try:
        return socket.gethostbyname(socket.gethostname())
    except OSError:
        return "127.0.0.1"


def advertise(port: int) -> None:
    '工人进程把地址写到共享目录，本机按这个目录发现它。'
    PAGE_REGISTRY.mkdir(parents=True, exist_ok=True)
    host = socket.gethostname()
    path = PAGE_REGISTRY / f"{host}.json"
    url = f"http://{_own_ip()}:{port}"
    slots = page_slots()
    body = json.dumps(
        {"url": url, "slots": slots, "host": host, "slices": 1, "upright_choice": 1},
        ensure_ascii=False,
    )
    while True:
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(body, encoding="utf-8")
        tmp.replace(path)
        time.sleep(15)
