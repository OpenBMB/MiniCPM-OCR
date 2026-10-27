#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import shutil
import sys
import threading
import time
import traceback
import uuid
from pathlib import Path
from queue import Queue
from typing import Dict, List, Optional

BASE = Path(__file__).resolve().parent
REPO = BASE.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

import minicpmvocr  # noqa: E402
from minicpmvocr import (  # noqa: E402
    create_backend,
    create_layout_detector,
    load_config,
    pipelined_run,
)


CONFIG_PATH = Path(os.environ.get(
    "OCRWEB_CONFIG", Path(minicpmvocr.__file__).parent / "configs" / "minicpmvocr.yaml"
))
DATA_DIR = Path(os.environ.get("OCRWEB_DATA_DIR", BASE / "data"))
JOBS_DIR = DATA_DIR / "jobs"

WEBUI_OVERRIDES: Dict = {
    "pipeline": {
        "overlap_layout": True,
        "save_crops": True,
        "save_pages": True,
    },
    "logging": {"progress_log_every": 5},
}
SUPPORTED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff"}


def _webui_overrides(**sections) -> Dict:

    merged = {key: dict(value) for key, value in WEBUI_OVERRIDES.items()}
    for key, value in sections.items():
        merged.setdefault(key, {}).update(value)
    server_urls = [url.strip() for url in os.environ.get("VLLM_URLS", "").split(",") if url.strip()]
    if server_urls:
        merged.setdefault("engine", {}).update(server_url="", server_urls=server_urls)
    return merged


def new_job_id() -> str:
    return time.strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]


def _atomic_write_json(path: Path, obj: Dict) -> None:

    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def read_job(job_id: str) -> Optional[Dict]:
    path = JOBS_DIR / job_id / "job.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def list_jobs() -> List[Dict]:
    if not JOBS_DIR.is_dir():
        return []
    jobs = []
    for entry in JOBS_DIR.iterdir():
        if not entry.is_dir():
            continue
        meta = read_job(entry.name)
        if meta:
            jobs.append(meta)
    jobs.sort(key=lambda j: j.get("created_at", ""), reverse=True)
    return jobs


class Runner:
    'Serial job worker. Models load lazily on the first job, then stay.'

    def __init__(self) -> None:
        JOBS_DIR.mkdir(parents=True, exist_ok=True)
        self._queue: Queue = Queue()
        self._lock = threading.Lock()
        self._resources: Dict | None = None
        self._base_cfg: Dict | None = None
        self._base_cfg_error = ""
        self.current_job_id: str | None = None

        for meta in list_jobs():
            if meta.get("status") in ("running", "queued"):
                meta["status"] = "failed"
                meta["error"] = meta.get("error") or "进程重启，任务中断"
                _atomic_write_json(JOBS_DIR / meta["id"] / "job.json", meta)
        self._thread = threading.Thread(target=self._loop, name="ocr-job-worker", daemon=True)
        self._thread.start()


    def base_cfg(self) -> Dict:
        'Deployment config with no job bound to it.'
        if self._base_cfg is None:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            self._base_cfg = load_config(str(CONFIG_PATH), _webui_overrides(
                run={"run_root": str(JOBS_DIR)},
                input={"files_dir": str(DATA_DIR)},
            ))
        return self._base_cfg

    def build_cfg(self, job_id: str, upright: bool) -> Dict:
        job_dir = JOBS_DIR / job_id
        overrides = _webui_overrides(
            run={"run_tag": job_id, "run_root": str(JOBS_DIR), "mode": "full"},
            input={
                "files_dir": str(job_dir / "input"),
                "file_path": "",
                "image_dir": "",
                "manifest": "",
                "limit": 0,
            },
            upright={"enabled": bool(upright)},
        )
        return load_config(str(CONFIG_PATH), overrides)

    def _ensure_resources(self, cfg: Dict) -> Dict:

        if self._resources is not None:
            return self._resources
        detector = create_layout_detector(cfg["layout"])
        detector.start()
        upright = None
        try:
            from minicpmvocr import UprightCorrector

            upright_cfg = dict(cfg)
            upright_cfg["upright"] = dict(cfg["upright"], enabled=True)
            upright = UprightCorrector(upright_cfg)
        except Exception as exc:
            print(f"[runner] upright unavailable: {exc}", flush=True)
        engine = create_backend(cfg)
        engine.start()
        self._resources = {"detectors": [detector], "upright": upright, "engine": engine}
        return self._resources

    def resources_status(self) -> Dict:
        res = self._resources or {}
        return {
            "loaded": self._resources is not None,
            "layout": bool(res.get("detectors")),
            "upright": res.get("upright") is not None,
            "engine": res.get("engine") is not None,
        }


    def submit(self, job_id: str, name: str, files: List[str], upright: bool) -> Dict:
        meta = {
            "id": job_id,
            "name": name or (files[0] if files else job_id),
            "files": files,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "upright": bool(upright),
            "status": "queued",
            "pages_total": 0,
            "pages_done": 0,
            "elapsed_sec": 0.0,
            "error": "",
        }
        _atomic_write_json(JOBS_DIR / job_id / "job.json", meta)
        self._queue.put(job_id)
        return meta

    def delete(self, job_id: str) -> bool:
        with self._lock:
            if job_id == self.current_job_id:
                return False
        job_dir = JOBS_DIR / job_id
        if not job_dir.is_dir():
            return False
        shutil.rmtree(job_dir, ignore_errors=True)
        return True

    def _update(self, job_id: str, **fields) -> None:
        meta = read_job(job_id) or {"id": job_id}
        meta.update(fields)
        _atomic_write_json(JOBS_DIR / job_id / "job.json", meta)

    def _loop(self) -> None:
        while True:
            job_id = self._queue.get()
            with self._lock:
                self.current_job_id = job_id
            started = time.time()
            watcher_stop = threading.Event()
            try:
                meta = read_job(job_id) or {}
                cfg = self.build_cfg(job_id, bool(meta.get("upright", True)))
                self._update(job_id, status="loading_models")
                resources = self._ensure_resources(cfg)
                self._update(job_id, status="running")
                threading.Thread(
                    target=self._watch_progress,
                    args=(job_id, started, watcher_stop),
                    daemon=True,
                ).start()
                summary = pipelined_run(cfg, resources=resources)
                counts = summary.get("counts") or {}
                done = int(counts.get("ok_pages", 0) or 0) or len(
                    list((JOBS_DIR / job_id / "output").glob("*.md"))
                )
                self._update(
                    job_id,
                    status="done",
                    pages_total=done,
                    pages_done=done,
                    elapsed_sec=round(time.time() - started, 2),
                    error="",
                )
            except Exception as exc:
                traceback.print_exc()
                self._update(
                    job_id,
                    status="failed",
                    elapsed_sec=round(time.time() - started, 2),
                    error=f"{type(exc).__name__}: {exc}",
                )
            finally:
                watcher_stop.set()
                with self._lock:
                    self.current_job_id = None
                self._queue.task_done()

    def _watch_progress(self, job_id: str, started: float, stop: threading.Event) -> None:

        out_dir = JOBS_DIR / job_id / "output"
        while not stop.wait(1.0):
            try:
                done = len(list(out_dir.glob("*.md"))) if out_dir.is_dir() else 0
                self._update(job_id, pages_done=done, elapsed_sec=round(time.time() - started, 2))
            except Exception:
                pass
