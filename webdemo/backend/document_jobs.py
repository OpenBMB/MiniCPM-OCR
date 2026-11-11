"""Hand an uploaded image or PDF to the local page worker.

The frontend polls the job. Besides the pages that are finished, a running job
reports the pages still being recognized: the blocks done so far and the text
of the blocks that are being decoded right now, so the page fills in as it is
read. A detector is borrowed for the job and returned loaded, so the next job
does not wait for the layout model.
"""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Dict, Optional

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse

from model_manager import JOBS_DIR, new_job_id

router = APIRouter()
_LOCK = threading.Lock()
_JOBS: Dict[str, Dict] = {}


def _page_count(path: Path) -> int:
    if path.suffix.lower() != ".pdf":
        return 1
    import fitz
    doc = fitz.open(path)
    try:
        return max(1, int(doc.page_count))
    finally:
        doc.close()


def _extract_page(src: Path, index: int, dest: Path) -> None:
    import fitz
    doc = fitz.open(src)
    try:
        if index < 0 or index >= doc.page_count:
            raise ValueError("页码超出范围")
        out = fitz.open()
        try:
            out.insert_pdf(doc, from_page=index, to_page=index)
            out.save(dest)
        finally:
            out.close()
    finally:
        doc.close()


def _layout_page_index(layout: Dict, stem: str) -> int:
    """The PDF page number is source.page_index. A name like document_page_001 counts from 1."""
    source = layout.get("source") if isinstance(layout.get("source"), dict) else {}
    page_index = source.get("page_index", layout.get("page_index"))
    if isinstance(page_index, int) and not isinstance(page_index, bool) and page_index >= 0:
        return page_index
    marker = "_page_"
    if marker in stem:
        suffix = stem.rsplit(marker, 1)[-1]
        if suffix.isdigit():
            return max(0, int(suffix) - 1)
    return 0


def _page_index(state: Dict, layout: Dict, stem: str) -> int:
    if state.get("only_page") is not None:
        return int(state["only_page"])
    return _layout_page_index(layout, stem)


def _collect_pages(state: Dict) -> list:
    import server

    job_dir = Path(state["job_dir"])
    layouts = job_dir / "runtime" / "intermediate" / "layouts"
    if not layouts.is_dir():
        return []
    # While the job runs it is polled several times a second: a finished page is read once.
    running = state["status"] == "Running"
    done: Dict = state.setdefault("finished_pages", {}) if running else {}
    pages = []
    for path in sorted(layouts.glob("*.json")):
        page = done.get(path.stem)
        if page is None:
            layout = server._read_json(path)
            result = server._read_json(job_dir / "results_json" / f"{path.stem}.json")
            if not layout or not result:
                continue
            page = server._build_page_response(
                path.stem, layout, result, state["id"], "standard",
                bool(state["upright"]), int(state["created_at"]), state["id"],
                _page_index(state, layout, path.stem),
            )
            page["image_id"] = path.stem
            done[path.stem] = page
        pages.append(page)
    pages.sort(key=lambda item: int(item.get("metadata", {}).get("page_index") or 0))
    return pages


def _hear(state: Dict, event: Dict) -> None:
    """Keep what the run says about pages that are not finished yet.

    Called by the run for every layout, piece of decoded text, block and page.
    """
    kind = event["event"]
    with state["live_lock"]:
        live = state["live"]
        if kind == "layout":
            live[event["image_id"]] = {}
        elif kind == "page":
            live.pop(event["image_id"], None)
        elif kind == "block":
            live.setdefault(event["image_id"], {})[event["order"]] = {
                "text": event["content"], "done": True}
        elif kind == "delta":
            block = live.setdefault(event["image_id"], {}).setdefault(
                event["order"], {"text": "", "done": False})
            # A request that was sent again starts its text over.
            block["text"] = event["text"] if event.get("restart") else block["text"] + event["text"]


def _preview(label: str, raw: str) -> str:
    'The text of a block that is still being decoded, tidied the way its final content will be.'
    from minicpmvocr.pipeline._text import _normalize_and_dedupe_blocks
    from minicpmvocr.postprocess.markdown import postprocess_content
    from minicpmvocr.prompts import DEFAULT_PROMPT_MAP, get_element_cfg

    try:
        elem = get_element_cfg(DEFAULT_PROMPT_MAP, label)
        content = postprocess_content(raw, elem["output_format"], label=label) if elem else raw
        tidy = _normalize_and_dedupe_blocks([{"label": label, "order": 0, "content": content}])
        return tidy[0]["content"] or raw
    except Exception:
        return raw


def _partial_pages(state: Dict, finished: set) -> list:
    """Pages still being recognized, in the shape of a finished page.

    Only blocks that have text so far are listed, and the page body is left
    empty: the frontend then builds the preview from the blocks.
    """
    import server

    with state["live_lock"]:
        live = {image_id: {order: dict(block) for order, block in blocks.items()}
                for image_id, blocks in state["live"].items()}
    layouts = Path(state["job_dir"]) / "runtime" / "intermediate" / "layouts"
    cache = state.setdefault("layouts", {})
    pages = []
    for image_id, heard in live.items():
        if image_id in finished or not heard:
            continue
        layout = cache.get(image_id)
        if layout is None:
            layout = server._read_json(layouts / f"{image_id}.json")
            if not layout:
                continue
            cache[image_id] = layout
        blocks = []
        for layout_block in layout.get("blocks", []):
            block = heard.get(layout_block.get("order", 0))
            if not block or not block["text"].strip():
                continue
            content = block["text"] if block["done"] else _preview(layout_block.get("label", ""), block["text"])
            blocks.append(server._block_to_api(layout_block, {"content": content, "status": "ok"}))
        if not blocks:
            continue
        pages.append({
            "metadata": {"page_index": _page_index(state, layout, image_id)},
            "partial": True,
            "image_id": image_id,
            "choices": [{"message": {"content": ""}}],
            "minicpm_ocr": {
                "request_id": state["id"],
                "mode": "ocr_only",
                "image_width": layout.get("image_width", 0),
                "image_height": layout.get("image_height", 0),
                "blocks": blocks,
            },
        })
    return pages


def _public(state: Dict) -> Dict:
    pages = _collect_pages(state)
    body = {
        "id": state["id"],
        "status": state["status"],
        "pages_done": len(pages) if state["status"] == "Running" else state.get("pages_done", len(pages)),
        "pages_total": state["pages_total"],
        "pages": pages,
    }
    if state["status"] == "Running":
        body["pages_done"] = len(pages)
        # After the finished pages, so a client that only wants those can stop at pages_done.
        partial = _partial_pages(state, {page.get("image_id") for page in pages})
        partial.sort(key=lambda item: item["metadata"]["page_index"])
        body["pages"] = pages + partial
    if state.get("error"):
        body["error"] = state["error"]
    return body


def _run(job_id: str) -> None:
    import server

    with _LOCK:
        state = _JOBS[job_id]
    try:
        cfg = server.RUNNER.build_cfg(job_id, upright=bool(state["upright"]), mode="ocr", save_crops=False)
        cfg["input"]["file_path"] = state["path"]
        from minicpmvocr import pipelined_run

        # Streamed: earlier pages are rendered, laid out and recognized first, and the
        # job hears each block and its text as it is decoded.
        with server.RUNNER.acquire(cfg) as resources:
            pipelined_run(cfg, resources=resources,
                          on_page=lambda event: _hear(state, event), stream_detail="token")
        pages = _collect_pages(state)
        with _LOCK:
            if state["status"] == "Running":
                state["status"] = "Success"
                state["pages_done"] = len(pages)
    except Exception as exc:
        with _LOCK:
            state["status"] = "Failed"
            state["error"] = str(exc) or exc.__class__.__name__


@router.post("/api/document-parse/jobs")
async def create_document_job(
    file: UploadFile = File(...),
    upright: str = Form("true"),
    page_index: Optional[str] = Form(None),
):
    name = Path(file.filename or "document").name
    suffix = Path(name).suffix.lower()
    if suffix not in {".pdf", ".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff"}:
        return JSONResponse(status_code=400, content={"error": "不支持的文件类型"})
    raw = await file.read()
    if not raw:
        return JSONResponse(status_code=400, content={"error": "文件是空的"})
    job_id = new_job_id()
    job_dir = JOBS_DIR / job_id
    input_dir = job_dir / "input"
    input_dir.mkdir(parents=True, exist_ok=True)
    stored = input_dir / f"document{suffix}"
    stored.write_bytes(raw)
    only_page = None
    parse_path = stored
    if page_index not in (None, ""):
        try:
            only_page = int(page_index)
        except ValueError:
            return JSONResponse(status_code=400, content={"error": "页码不合法"})
        if suffix != ".pdf":
            only_page = 0
        else:
            single = input_dir / "page.pdf"
            try:
                _extract_page(stored, only_page, single)
            except ValueError as exc:
                return JSONResponse(status_code=400, content={"error": str(exc)})
            parse_path = single
    try:
        total = 1 if only_page is not None else _page_count(parse_path)
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": f"无法读取文件：{exc}"})
    import time
    state = {
        "id": job_id,
        "status": "Running",
        "pages_done": 0,
        "pages_total": total,
        "path": str(parse_path),
        "job_dir": str(job_dir),
        "upright": str(upright).lower() not in {"0", "false", "no"},
        "only_page": only_page,
        "created_at": int(time.time()),
        "error": "",
        # image_id -> block order -> {"text", "done"}, for pages not finished yet.
        "live": {},
        "live_lock": threading.Lock(),
    }
    with _LOCK:
        _JOBS[job_id] = state
    threading.Thread(target=_run, args=(job_id,), name=f"doc-job-{job_id[:8]}", daemon=True).start()
    return {"id": job_id, "status": "Running", "pages_done": 0, "pages_total": total, "pages": []}


@router.get("/api/document-parse/jobs/{job_id}")
def read_document_job(job_id: str):
    with _LOCK:
        state = _JOBS.get(job_id)
    if state is None:
        return JSONResponse(status_code=404, content={"error": "没有这个解析任务"})
    return _public(state)


@router.delete("/api/document-parse/jobs/{job_id}")
def cancel_document_job(job_id: str):
    with _LOCK:
        state = _JOBS.get(job_id)
        if state is not None and state["status"] == "Running":
            state["status"] = "Cancelled"
            state["error"] = "已取消"
    if state is None:
        return JSONResponse(status_code=404, content={"error": "没有这个解析任务"})
    return {"id": job_id, "status": "Cancelled"}
