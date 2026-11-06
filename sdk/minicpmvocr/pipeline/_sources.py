'Input manifest: which source file produced which pages.'
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Optional

from .._utils import now_iso, write_json

#: ``collection`` groups every standalone image in a run into one document (the
#: historical behaviour); ``file`` makes each image its own document, as a batch
#: of unrelated pictures needs.
IMAGE_DOCUMENT_SCOPES = ("collection", "file")

SOURCES_FILENAME = "sources.json"


def write_sources(runtime_dir: Path, entries: List[Dict], image_document_scope: str) -> Path:
    'Record input -> pages for ``entries`` in input order; returns the manifest path.'
    sources = []
    for index, entry in enumerate(entries, start=1):
        sources.append({
            "source_id": "s%03d" % index,
            "path": str(entry.get("source_path") or ""),
            "type": str(entry.get("source_type") or ""),
            "pages": int(entry.get("page_count") or 0),
            "image_ids": list(entry.get("image_ids") or []),
        })
    path = Path(runtime_dir) / SOURCES_FILENAME
    write_json(path, {
        "generated_at": now_iso(),
        "image_document_scope": image_document_scope,
        "sources": sources,
    })
    return path


def read_sources(run_dir: Path) -> Optional[Dict]:
    'The manifest of a run, or None for runs written before it existed.'
    path = Path(run_dir) / "runtime" / SOURCES_FILENAME
    if not path.is_file():
        return None
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict) or not data.get("sources"):
        return None
    return data


def image_document_scope(manifest: Optional[Dict], cfg: Optional[Dict] = None) -> str:
    'Scope recorded with the run, falling back to the current config.'
    if manifest and manifest.get("image_document_scope") in IMAGE_DOCUMENT_SCOPES:
        return manifest["image_document_scope"]
    configured = ((cfg or {}).get("pipeline") or {}).get("image_document_scope")
    return configured if configured in IMAGE_DOCUMENT_SCOPES else "collection"


def page_lookup(manifest: Optional[Dict]) -> Dict[str, Dict]:
    'image_id -> {source_id, path, type, page_index, order} from the manifest.'
    lookup: Dict[str, Dict] = {}
    for index, source in enumerate((manifest or {}).get("sources") or []):
        for order, image_id in enumerate(source.get("image_ids") or []):
            lookup[str(image_id)] = {
                "source_id": source.get("source_id", ""),
                "path": source.get("path", ""),
                "type": source.get("type", ""),
                "source_index": index,
                "order": order,
            }
    return lookup
