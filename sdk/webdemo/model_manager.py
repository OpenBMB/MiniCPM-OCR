#!/usr/bin/env python3

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
from block_recompute import rerun_block  # noqa: E402

CONFIG_PATH = Path(os.environ.get(
    "OCRWEB_CONFIG",
    Path(minicpmvocr.__file__).parent / "configs" / "minicpmvocr.yaml",
))
DATA_DIR = Path(os.environ.get("OCRWEB_DATA_DIR", BASE / "data"))
JOBS_DIR = DATA_DIR / "jobs"


LAYOUT_WORKERS = int(os.environ.get("OCR_LAYOUT_WORKERS", "3"))

UPRIGHT_WORKERS = int(os.environ.get("OCR_UPRIGHT_WORKERS", "8"))


WEBUI_OVERRIDES: Dict = {
    "pipeline": {
        "overlap_layout": True,
        "save_crops": False,
        "save_pages": False,
    },
    "logging": {"progress_log_every": 5},
}


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


def new_job_id() -> str:
    '生成唯一 job id，同时也用作 request_id（32 位小写 hex）。'
    return hashlib.md5(os.urandom(16) + str(time.time()).encode()).hexdigest()


def _webui_overrides(**sections) -> Dict:

    merged = {key: dict(value) for key, value in WEBUI_OVERRIDES.items()}
    for key, value in sections.items():
        merged.setdefault(key, {}).update(value)
    server_urls = [url.strip() for url in os.environ.get("VLLM_URLS", "").split(",") if url.strip()]
    if server_urls:
        merged.setdefault("engine", {}).update(server_url="", server_urls=server_urls)
    return merged


class Runner:
    '模型只加载一次，跨请求复用。线程安全。'

    def __init__(self) -> None:
        JOBS_DIR.mkdir(parents=True, exist_ok=True)
        self._res_lock  = threading.Lock()
        self._engine = None
        self._slots: "queue.Queue[Dict]" = queue.Queue()
        self._slot_count = 0
        self._upright_pool = None
        self._upright_loaded = False


    def build_cfg(self, job_id: str, upright: bool,
                  mode: str = DEFAULT_MODE, save_crops: bool = False) -> Dict:
        '构建一次请求的完整 SDK 配置。'
        job_dir = JOBS_DIR / job_id
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
            pipeline={"save_crops": bool(save_crops)},

            tts=copy.deepcopy(TTS_RECIPES[mode]),
        )
        return load_config(str(CONFIG_PATH), overrides)


    def _ensure_started(self, cfg: Dict) -> None:

        with self._res_lock:
            if self._engine is not None:
                return
            for _ in range(max(1, LAYOUT_WORKERS)):
                self._slots.put(self._build_slot(cfg))
                self._slot_count += 1
            try:
                from minicpmvocr.pipeline.upright import build_upright_fleet, build_upright_pool
                local_pool = build_upright_pool(cfg, UPRIGHT_WORKERS)
                registry = os.environ.get(
                    "OCR_UPRIGHT_REGISTRY",
                    str(DATA_DIR / "upright-workers"),
                )
                if local_pool is None:
                    self._upright_pool = None
                elif str(registry).strip():
                    self._upright_pool = build_upright_fleet(local_pool, registry)
                else:
                    self._upright_pool = local_pool
                self._upright_loaded = self._upright_pool is not None
            except Exception as exc:
                print(f"[model_manager] upright unavailable: {exc}", flush=True)
            engine = create_backend(cfg)
            engine.start()
            self._engine = engine

    def _build_slot(self, cfg: Dict) -> Dict:
        detector = create_layout_detector(cfg["layout"])
        detector.start()
        return {"detector": detector}

    def borrow(self, cfg: Dict) -> Dict:
        '借一套版面模型。用完调用 release，不必等到这一页的切片结束。'
        self._ensure_started(cfg)
        return self._slots.get()

    def release(self, slot: Dict) -> None:
        self._slots.put(slot)

    def resources_for(self, slot: Dict) -> Dict:
        return {"detectors": [slot["detector"]], "upright": self._upright_pool,
                "engine": self._engine}

    @contextlib.contextmanager
    def acquire(self, cfg: Dict) -> Iterator[Dict]:
        '借一套版面模型；摆正队列是所有请求共用的。'
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
            "upright": self._upright_loaded,
            "engine":  self._engine is not None,
        }


    def recompute_block(self, job_id: str, image_id: str, order: int) -> Dict:
        '对一个已识别块做自适应重采。'
        cfg = self.build_cfg(job_id, upright=False, mode="adaptive")
        self._ensure_started(cfg)
        return rerun_block(
            cfg, JOBS_DIR / job_id, image_id, int(order),
            engine=self._engine,
        )
