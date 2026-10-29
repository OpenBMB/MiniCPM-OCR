#!/usr/bin/env python3
"""Model resource manager.

It does two things:
  1. Load model resources lazily (layout detector, rotation-adaptation corrector, vLLM backend)
  2. Build the SDK config for each request (build_cfg)
Rotation adaptation, layout, and crop recognition each have their own queue.
A request enters the rotation-adaptation queue first. Only after that finishes
does it borrow a detector from the layout pool, and the detector is returned
as soon as this page is cut. The crops then enter the shared recognition queue.
A detector is not held while waiting on rotation adaptation or vLLM.
The layout detector is a Paddle predictor and cannot be shared across threads,
so the pool has LAYOUT_WORKERS copies and one page borrows one copy. With
several GPUs, OCR_LAYOUT_DEVICES spreads the copies across cards. The pool
itself stays one queue.
"""
from __future__ import annotations

import contextlib
import copy
import hashlib
import os
import queue
import sys
import threading
import time
from pathlib import Path
from typing import Dict, Iterator, Optional

BASE = Path(__file__).resolve().parent
REPO = BASE.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

import minicpmvocr  # noqa: E402
from minicpmvocr import (  # noqa: E402
    create_backend,
    create_layout_detector,
    load_config,
)
CONFIG_PATH = Path(os.environ.get(
    "OCRWEB_CONFIG",
    Path(minicpmvocr.__file__).parent / "configs" / "minicpmvocr.yaml",
))
DATA_DIR = Path(os.environ.get("OCRWEB_DATA_DIR", BASE / "data"))
JOBS_DIR = DATA_DIR / "jobs"

# Layout pool size. Each detector serves one page at a time and is returned when that page is cut.
LAYOUT_WORKERS = int(os.environ.get("OCR_LAYOUT_WORKERS", "3"))
# Workers on the rotation-adaptation queue. Each worker has its own model. Pages may come from different requests and files.
UPRIGHT_WORKERS = int(os.environ.get("OCR_UPRIGHT_WORKERS", "8"))

# Fixed pipeline overrides: a person is waiting, so layout and recognition overlap.
# Full-page images and crops are not written to disk by default. Encoding a large PNG dominates the layout stage.
# Only a single-block rerun reads crops from disk, and build_cfg(save_crops=True) turns that on by itself.
WEBUI_OVERRIDES: Dict = {
    "pipeline": {
        "overlap_layout": True,
        "save_crops": False,
        "save_pages": False,
    },
    "logging": {"progress_log_every": 5},
}

# RM/TTS recipes (see docs/rm-tts-pipeline.md)
# rm_url / rm_input_form expand through ${VAR:-fallback} when load_config runs.
RM_URL        = "${OCR_RM_URL:-http://127.0.0.1:8000}"
RM_INPUT_FORM = "${OCR_RM_INPUT_FORM:-}"

_TTS_SCORE = {
    "enabled": True,
    "n": 1,
    "force_score": True,
    "rm_anchor_min_side": None,
    "sampling": {"temperature": 1.0, "top_k": 0, "top_p": 1.0, "min_p": 0, "seed": 20260911},
    "rm_url": RM_URL,
    "rm_input_form": RM_INPUT_FORM,
    "timeout_sec": 300,
    "fallback_to_greedy": True,
    "dump_candidates": True,
    "rm_batch": {"max_items": 4, "max_wait_ms": 50},
}
_ADAPTIVE_ROUNDS = [{"greedy": True}] + [
    {"temperature": t, "top_k": 0, "top_p": 1.0, "min_p": 0, "n": 8}
    for t in (0.3, 0.5, 0.7, 1.0)
]
TTS_RECIPES: Dict[str, Dict] = {
    "ocr":      {"enabled": False},
    "score":    _TTS_SCORE,
    "adaptive": dict(_TTS_SCORE, adaptive={
        "enabled":    True,
        "tau":        0.98,
        "n_max":      None,
        "seed_base":  20260918,
        "rounds":     _ADAPTIVE_ROUNDS,
    }),
}
DEFAULT_MODE = "ocr"
SUPPORTED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff"}


# ===================================================================
# Helpers
# ===================================================================

def new_job_id() -> str:
    """A unique job id, also used as request_id (32 lowercase hex characters)."""
    return hashlib.md5(os.urandom(16) + str(time.time()).encode()).hexdigest()


def _fresh_upright_registry() -> bool:
    """Remote rotation adaptation is available only when the registry has a worker record updated within 90 seconds."""
    registry = os.environ.get("OCR_UPRIGHT_REGISTRY", "").strip()
    if not registry:
        return False
    directory = Path(registry)
    if not directory.is_dir():
        return False
    now = time.time()
    for path in directory.glob("*.json"):
        try:
            if now - path.stat().st_mtime <= 90:
                return True
        except OSError:
            continue
    return False


def layout_devices(count: int) -> list:
    """Which GPU each layout model uses. The pool is still one queue, and the idle copy takes the next page.

    OCR_LAYOUT_DEVICES=cuda:0,cuda:0,cuda:1,cuda:1 follows the listed order.
    When unset, more than one visible GPU rotates the copies. A single GPU uses OCR_LAYOUT_DEVICE for all of them.
    """
    count = max(1, int(count))
    spec = os.environ.get("OCR_LAYOUT_DEVICES", "").strip()
    if spec:
        devices = [part.strip() for part in spec.split(",") if part.strip()]
    else:
        visible = [part.strip() for part in os.environ.get("CUDA_VISIBLE_DEVICES", "").split(",") if part.strip()]
        if len(visible) <= 1:
            devices = [os.environ.get("OCR_LAYOUT_DEVICE", "cuda") or "cuda"]
        else:
            devices = [f"cuda:{index}" for index in range(len(visible))]
    if not devices:
        devices = ["cuda"]
    return [devices[index % len(devices)] for index in range(count)]


def _webui_overrides(**sections) -> Dict:
    """Merge WEBUI_OVERRIDES with this request's overrides, one level deep."""
    merged = {key: dict(value) for key, value in WEBUI_OVERRIDES.items()}
    for key, value in sections.items():
        merged.setdefault(key, {}).update(value)
    return merged


# ===================================================================
# Runner — model resources and single-block rerun
# ===================================================================

class Runner:
    """Models load once and are reused across requests. Thread-safe."""

    def __init__(self) -> None:
        JOBS_DIR.mkdir(parents=True, exist_ok=True)
        self._res_lock  = threading.Lock()
        self._engine = None
        self._slots: "queue.Queue[Dict]" = queue.Queue()
        self._slot_count = 0
        self._upright_pool = None
        self._upright_loaded = False

    # ----------------------------------------------------------------
    # Config building
    # ----------------------------------------------------------------

    def build_cfg(self, job_id: str, upright: bool,
                  mode: str = DEFAULT_MODE, save_crops: bool = False) -> Dict:
        """Build the full SDK config for one request."""
        job_dir = JOBS_DIR / job_id
        if upright and UPRIGHT_WORKERS <= 0 and not _fresh_upright_registry():
            upright = False
        overrides = _webui_overrides(
            run={
                "run_tag":  job_id,
                "run_root": str(JOBS_DIR),
                "mode":     "full",
            },
            input={
                "files_dir": str(job_dir / "input"),
                "file_path": "",
                "image_dir": "",
                "manifest":  "",
                "limit":     0,
            },
            upright={"enabled": bool(upright)},
            # The seal and chart switches on the page only change what is shown. Recognition stays on, or those blocks are skipped.
            layout={
                "use_chart_recognition": True,
                "use_seal_recognition": True,
            },
            pipeline={"save_crops": bool(save_crops)},
            # A recipe holds nested dicts, so concurrent requests cannot share one copy.
            tts=copy.deepcopy(TTS_RECIPES[mode]),
        )
        return load_config(str(CONFIG_PATH), overrides)

    # ----------------------------------------------------------------
    # Model resources
    # ----------------------------------------------------------------

    def _ensure_started(self, cfg: Dict) -> None:
        """Lazy load: the first call builds the engine and LAYOUT_WORKERS layout copies."""
        with self._res_lock:
            if self._engine is not None:
                return
            for device in layout_devices(LAYOUT_WORKERS):
                self._slots.put(self._build_slot(cfg, device))
                self._slot_count += 1
            try:
                from minicpmvocr.pipeline.upright import build_upright_fleet, build_upright_pool
                registry = os.environ.get("OCR_UPRIGHT_REGISTRY", "").strip()
                if UPRIGHT_WORKERS <= 0:
                    local_pool = None
                else:
                    local_pool = build_upright_pool(cfg, UPRIGHT_WORKERS)
                if local_pool is None and not registry:
                    self._upright_pool = None
                elif local_pool is None:
                    self._upright_pool = build_upright_fleet(None, registry)
                elif registry:
                    self._upright_pool = build_upright_fleet(local_pool, registry)
                else:
                    self._upright_pool = local_pool
                self._upright_loaded = self._upright_pool is not None
            except Exception as exc:
                print(f"[model_manager] upright unavailable: {exc}", flush=True)
            engine = create_backend(cfg)
            engine.start()
            self._engine = engine

    def _build_slot(self, cfg: Dict, device: str | None = None) -> Dict:
        layout_cfg = dict(cfg["layout"])
        if device:
            layout_cfg["device"] = device
        detector = create_layout_detector(layout_cfg)
        detector.start()
        return {"detector": detector, "device": layout_cfg.get("device", "")}

    def staged_resources(self, cfg: Dict) -> Dict:
        """Prepare the three queues without borrowing a layout detector."""
        self._ensure_started(cfg)
        return {
            "layout_pool": self._slots,
            "layout_slots": self._slot_count,
            "upright": self._upright_pool,
            "engine": self._engine,
        }

    def borrow(self, cfg: Dict) -> Dict:
        """Borrow one layout model. Call release when finished. Do not wait for this page's crops to finish."""
        self._ensure_started(cfg)
        return self._slots.get()

    def release(self, slot: Dict) -> None:
        self._slots.put(slot)

    def resources_for(self, slot: Dict) -> Dict:
        return {"detectors": [slot["detector"]], "upright": self._upright_pool,
                "engine": self._engine}

    @contextlib.contextmanager
    def acquire(self, cfg: Dict) -> Iterator[Dict]:
        """Borrow one layout model. The rotation-adaptation queue is shared by every request."""
        slot = self.borrow(cfg)
        try:
            yield self.resources_for(slot)
        finally:
            self.release(slot)

    def resources_status(self) -> Dict:
        return {
            "loaded":  self._engine is not None,
            "layout_workers": self._slot_count,
            "layout_idle": self._slots.qsize(),
            "upright": self._upright_pool is not None and (
                UPRIGHT_WORKERS > 0 or _fresh_upright_registry()
            ),
            "engine":  self._engine is not None,
        }
