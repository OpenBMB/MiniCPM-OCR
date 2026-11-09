'Page and document JSON in the shape of the online document-parse API.'
from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional

from ._sources import read_sources
from .._utils import read_json, read_jsonl

#: Block statuses of the online contract. Anything else is an internal failure
#: reason (``missing_crop``, ``vllm_error``, ...) and is reported as ``failed``.
PUBLIC_BLOCK_STATUSES = ("ok", "failed", "skipped_no_vlm", "skipped_seal")

#: Online jobs join page Markdown with a blank line and no page marker.
DOCUMENT_PAGE_DELIMITER = "\n\n"

RESPONSE_DIRNAME = "pages_json"


def public_block_status(status: str) -> str:
    return status if status in PUBLIC_BLOCK_STATUSES else "failed"


def rotation_record(upright: Optional[Dict]) -> Dict:
    """Map the corrector's record (layout["upright"]) to the online ``ocr.rotation``.

    ``upright`` is None when rotation was not requested. Angles are degrees,
    counterclockwise positive; ``total_angle`` is orientation plus deskew.
    """
    out = {
        "enabled": upright is not None,
        "applied": False,
        "predicted_angle": None,
        "predicted_score": None,
        "confirmed": None,
        "orientation_angle": 0,
        "deskew_angle": 0.0,
        "total_angle": 0.0,
        "skipped_reason": None,
    }
    if upright is None:
        return out
    if upright.get("skipped_reason"):
        out["skipped_reason"] = upright["skipped_reason"]
        return out
    if upright.get("gated"):
        out["skipped_reason"] = "gated"
        return out
    predicted = upright.get("label_vetoed", upright.get("label", 0))
    out.update(
        applied=bool(upright.get("applied", False)),
        predicted_angle=predicted,
        predicted_score=upright.get("score"),
        orientation_angle=upright.get("label", 0),
        deskew_angle=float(upright.get("deskew", 0.0)),
        total_angle=float(upright.get("correction", 0.0)),
    )
    # The vote only runs for a non-zero prediction; without it there is nothing
    # that confirmed or vetoed the classifier.
    if "vote" in upright:
        out["confirmed"] = "label_vetoed" not in upright
    return out


def page_response(*, layout: Dict, blocks: List[Dict], markdown: str,
                  usage: Optional[Dict] = None) -> Dict:
    'One page as the online synchronous response / one item of a job\'s pages[].'
    regions = {b.get("order"): b.get("regions") for b in layout.get("blocks") or []}
    source = layout.get("source") or {}
    ocr_blocks = []
    for block in blocks:
        bbox = block.get("bbox")
        ocr_blocks.append({
            "order": block.get("order", 0),
            "label": block.get("label", ""),
            "bbox": bbox,
            "regions": regions.get(block.get("order")) or ([bbox] if bbox else []),
            "content": block.get("content", ""),
            "status": public_block_status(block.get("status", "")),
            "inline_formula_mixed": bool(block.get("inline_formula_mixed", False)),
        })
    response = {
        "metadata": {
            "page_index": source.get("page_index") or 0,
            # Which input file this page came from. The online API has one file
            # per request; a local run can hold several, so the page says which.
            "source": source.get("path") or "",
            "image_id": layout.get("image_id", ""),
        },
        "choices": [{"message": {"content": markdown}}],
        "ocr": {
            "coordinate_space": "processed_image",
            "mode": "ocr_only",
            "image_width": layout.get("image_width"),
            "image_height": layout.get("image_height"),
            "blocks": ocr_blocks,
            "rotation": rotation_record(layout.get("upright")),
        },
    }
    if usage is not None:
        response["usage"] = usage
    return response


def assemble_document_json(run_dir: Path) -> Dict:
    """Collect a single-source run's pages into the online job shape.

    ``status`` is ``Success`` only when every planned page produced a response.
    A run with several inputs is a batch of documents; use
    ``assemble_documents_json`` for it.
    """
    run_dir = Path(run_dir)
    tasks = read_jsonl(run_dir / "runtime" / "page_tasks.jsonl")
    pages = []
    for task in tasks:
        page = read_json(run_dir / RESPONSE_DIRNAME / f"{task['image_id']}.json", default=None)
        if page is not None:
            pages.append(page)
    pages.sort(key=lambda p: p["metadata"]["page_index"])
    complete = bool(tasks) and len(pages) == len(tasks)
    return {
        "status": "Success" if complete else "Failed",
        "pages_done": len(pages),
        "pages_total": len(tasks),
        "pages": pages,
        "markdown": DOCUMENT_PAGE_DELIMITER.join(
            p["choices"][0]["message"]["content"] for p in pages
        ),
    }


def _file_entry(source: Dict, pages: List[Dict]) -> Dict:
    planned = int(source.get("pages") or len(source.get("image_ids") or []))
    done = len(pages)
    if done and done == planned:
        status = "Success"
    elif done:
        status = "Partial"
    else:
        status = "Failed"
    return {
        "source_id": source.get("source_id", ""),
        "path": source.get("path", ""),
        "type": source.get("type", ""),
        "status": status,
        "pages_done": done,
        "pages_total": planned,
        "pages": pages,
        "markdown": DOCUMENT_PAGE_DELIMITER.join(
            p["choices"][0]["message"]["content"] for p in pages),
    }


def assemble_documents_json(run_dir: Path) -> Dict:
    """One entry per input file: the online job shape, plus which file it was.

    A run without a source manifest (written before it existed) is reported as
    one entry, which is what such a run was.
    """
    run_dir = Path(run_dir)
    manifest = read_sources(run_dir)
    if manifest is None:
        document = assemble_document_json(run_dir)
        document["files"] = [{
            "source_id": "",
            "path": "",
            "type": "",
            "status": document["status"],
            "pages_done": document["pages_done"],
            "pages_total": document["pages_total"],
            "pages": document["pages"],
            "markdown": document["markdown"],
        }]
        document["status"] = "Success" if document["pages_done"] else "Failed"
        return document

    files = []
    for source in manifest.get("sources") or []:
        pages = []
        for image_id in source.get("image_ids") or []:
            page = read_json(run_dir / RESPONSE_DIRNAME / f"{image_id}.json", default=None)
            if page is not None:
                pages.append(page)
        files.append(_file_entry(source, pages))

    statuses = [f["status"] for f in files]
    if statuses and all(s == "Success" for s in statuses):
        status = "Success"
    elif any(s != "Failed" for s in statuses):
        status = "Partial"
    else:
        status = "Failed"
    return {
        "status": status,
        "files_done": sum(1 for s in statuses if s == "Success"),
        "files_total": len(files),
        "files": files,
    }
