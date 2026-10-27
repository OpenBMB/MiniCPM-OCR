from __future__ import annotations

import time
from pathlib import Path
from typing import Dict, List

from PIL import Image

from ..constants import (
    PDF_RENDER_PAGES_PER_JOB,
    PDF_RENDER_ZOOM,
    SUPPORTED_IMAGE_SUFFIXES,
    SUPPORTED_INPUT_SUFFIXES,
)


def _mode_limit(cfg: Dict) -> int:
    input_limit = int(cfg["input"].get("limit") or 0)
    if input_limit > 0:
        return input_limit
    mode = cfg["run"]["mode"]
    if mode == "smoke_1page":
        return 1
    if mode == "pipeline_30pages":
        return 30
    return 0


def _load_manifest_filter(manifest_path: str) -> set[str]:
    if not manifest_path:
        return set()
    names = set()
    with Path(manifest_path).open("r", encoding="utf-8") as f:
        for line in f:
            val = line.strip()
            if not val or val.startswith("#"):
                continue
            names.add(Path(val).stem)
            names.add(Path(val).name)
            names.add(val)
    return names


def _match_manifest(path: Path, selected: set[str]) -> bool:
    if not selected:
        return True
    return path.stem in selected or path.name in selected or str(path) in selected


def _collect_raw_inputs(cfg: Dict) -> List[Path]:
    selected = _load_manifest_filter(cfg["input"].get("manifest", ""))
    paths: List[Path] = []
    seen = set()

    file_path = cfg["input"].get("file_path", "")
    if file_path:
        p = Path(file_path)
        if p.is_file() and p.suffix.lower() in SUPPORTED_INPUT_SUFFIXES:
            rp = str(p.resolve())
            seen.add(rp)
            paths.append(p)

    image_dir = cfg["input"].get("image_dir", "")
    if image_dir:
        root = Path(image_dir)
        for p in sorted(root.rglob("*")):
            if not p.is_file() or p.suffix.lower() not in SUPPORTED_IMAGE_SUFFIXES:
                continue
            rp = str(p.resolve())
            if rp in seen:
                continue
            if not _match_manifest(p, selected):
                continue
            seen.add(rp)
            paths.append(p)

    files_dir = cfg["input"].get("files_dir", "")
    if files_dir:
        root = Path(files_dir)
        for p in sorted(root.rglob("*")):
            if not p.is_file() or p.suffix.lower() not in SUPPORTED_INPUT_SUFFIXES:
                continue
            rp = str(p.resolve())
            if rp in seen:
                continue
            if not _match_manifest(p, selected):
                continue
            seen.add(rp)
            paths.append(p)

    return paths


def _render_pdf_chunk(args):

    pdf_path, first, last = args
    import fitz

    out = []
    doc = fitz.open(pdf_path)
    try:
        for index in range(first, last):
            page = doc.load_page(index)
            pix = page.get_pixmap(matrix=fitz.Matrix(PDF_RENDER_ZOOM, PDF_RENDER_ZOOM), alpha=False)
            out.append((index, pix.width, pix.height, pix.samples))
    finally:
        doc.close()
    return out


def _render_pdf_pages(pdf_paths: List[Path], workers: int) -> Dict[tuple, tuple]:

    import fitz

    jobs = []
    for path in pdf_paths:
        doc = fitz.open(str(path))
        try:
            page_count = doc.page_count
        finally:
            doc.close()
        for first in range(0, page_count, PDF_RENDER_PAGES_PER_JOB):
            jobs.append((str(path), first, min(first + PDF_RENDER_PAGES_PER_JOB, page_count)))

    if not jobs:
        return {}

    chunks = []
    import concurrent.futures as cf
    import multiprocessing
    import os


    if workers <= 0:
        workers = min(16, os.cpu_count() or 1)
    workers = max(1, min(workers, len(jobs)))

    if workers <= 1:
        chunks = [_render_pdf_chunk(job) for job in jobs]
    else:


        ctx = multiprocessing.get_context("spawn")
        with cf.ProcessPoolExecutor(max_workers=workers, mp_context=ctx) as pool:
            chunks = list(pool.map(_render_pdf_chunk, jobs))

    rendered: Dict[tuple, tuple] = {}
    for job, chunk in zip(jobs, chunks):
        source = job[0]
        for index, width, height, samples in chunk:
            rendered[(source, index)] = (width, height, samples)
    return rendered


def _iter_source_pages(cfg: Dict, runtime_intermediate: Path) -> List[Dict]:
    try:
        import fitz
    except Exception:
        fitz = None


    render_workers_cfg = int((cfg.get("pipeline") or {}).get("render_workers", -1) or -1)

    source_files = _collect_raw_inputs(cfg)
    page_entries: List[Dict] = []

    pdf_files = [p for p in source_files if p.suffix.lower() == ".pdf"]
    if pdf_files and fitz is None:
        raise RuntimeError("PDF input requires PyMuPDF (fitz); install it in current environment.")

    if pdf_files and render_workers_cfg != 1:
        _t0 = time.time()
        rendered = _render_pdf_pages(pdf_files, render_workers_cfg)
        _render_sec = time.time() - _t0
        _render_workers = render_workers_cfg
    else:
        rendered = {}
        _render_sec = 0.0
        _render_workers = 1

    for path in source_files:
        suffix = path.suffix.lower()
        if suffix in SUPPORTED_IMAGE_SUFFIXES:
            page_entries.append(
                {
                    "image_id": path.stem,
                    "source_type": "image",
                    "source_path": str(path),
                    "page_index": None,
                    "image_path": str(path),
                }
            )
            continue

        if suffix == ".pdf":
            doc = fitz.open(path)
            try:
                page_count = doc.page_count
            finally:
                doc.close()

            for idx in range(page_count):
                image_id = f"{path.stem}_page_{idx + 1:03d}"
                hit = rendered.get((str(path), idx))
                if hit is not None:
                    width, height, samples = hit
                    page_entries.append(
                        {
                            "image_id": image_id,
                            "source_type": "pdf",
                            "source_path": str(path),
                            "page_index": idx,
                            "image_path": "",
                            "image_size": (width, height),
                            "image_bytes": samples,
                        }
                    )
                    continue


                doc = fitz.open(path)
                try:
                    page = doc.load_page(idx)
                    pix = page.get_pixmap(matrix=fitz.Matrix(PDF_RENDER_ZOOM, PDF_RENDER_ZOOM), alpha=False)
                finally:
                    doc.close()


                page_entries.append(
                    {
                        "image_id": image_id,
                        "source_type": "pdf",
                        "source_path": str(path),
                        "page_index": idx,
                        "image_path": "",
                        "image_size": (pix.width, pix.height),
                        "image_bytes": pix.samples,
                    }
                )
            continue

    meta = cfg.setdefault("_meta", {})
    meta["render_sec"] = round(_render_sec, 6)
    meta["render_workers"] = _render_workers

    limit = _mode_limit(cfg)
    if limit > 0:
        page_entries = page_entries[:limit]

    used = set()
    for item in page_entries:
        base = item["image_id"]
        name = base
        seq = 2
        while name in used:
            name = f"{base}_{seq}"
            seq += 1
        used.add(name)
        item["image_id"] = name

    return page_entries


def _open_page_image(entry: Dict) -> Image.Image:

    buf = entry.get("image_bytes")
    if buf:
        width, height = entry["image_size"]
        return Image.frombytes("RGB", [width, height], buf)
    return Image.open(entry["image_path"]).convert("RGB")
