"""Hand an uploaded image or PDF to the local page worker.

The frontend polls page by page. A detector is held only while that page is
being cut. Rotation adaptation and recognition each have their own queue.
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


def _collect_pages(state: Dict) -> list:
    import server

    job_dir = Path(state["job_dir"])
    layouts = job_dir / "runtime" / "intermediate" / "layouts"
    if not layouts.is_dir():
        return []
    pages = []
    for path in sorted(layouts.glob("*.json")):
        layout = server._read_json(path)
        result = server._read_json(job_dir / "results_json" / f"{path.stem}.json")
        if not layout or not result:
            continue
        page_index = _layout_page_index(layout, path.stem)
        if state.get("only_page") is not None:
            page_index = int(state["only_page"])
        pages.append(server._build_page_response(
            path.stem, layout, result, state["id"], "standard",
            bool(state["upright"]), int(state["created_at"]), state["id"], page_index,
        ))
    pages.sort(key=lambda item: int(item.get("metadata", {}).get("page_index") or 0))
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
    if state.get("error"):
        body["error"] = state["error"]
    return body


def _run(job_id: str) -> None:
    import page_fleet
    import server

    with _LOCK:
        state = _JOBS[job_id]
    try:
        cfg = server.RUNNER.build_cfg(job_id, upright=bool(state["upright"]), mode="ocr", save_crops=False)
        cfg["input"]["file_path"] = state["path"]
        page_fleet.run_releasing_layout(server.RUNNER, cfg)
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
