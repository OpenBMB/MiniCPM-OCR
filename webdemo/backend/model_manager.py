#!/usr/bin/env python3
"""模型资源管理。

负责：
  1. 模型资源懒加载（layout detector、upright corrector、vLLM backend）
  2. 构建每次请求的 SDK 配置（build_cfg）
并发模型：摆正、版面、分块识别各有一条队列。
请求先进入摆正队列；摆正结束才从版面池借一套检测器，这一页切完立刻归还；
切出来的块进入共享识别队列。检测器不会在等摆正或等 vLLM 时空占着。
layout detector 是 paddle predictor，不能多线程共用，所以按 LAYOUT_WORKERS
建池，一页借一套。多张卡时按 OCR_LAYOUT_DEVICES 把副本摊到各卡上，池子仍是一条。
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

# 版面池大小。每套检测器同一时刻只服务一页，页切完就归还。
LAYOUT_WORKERS = int(os.environ.get("OCR_LAYOUT_WORKERS", "3"))
# 摆正队列的工人数。每个工人一套模型，页可以来自不同请求、不同文件。
UPRIGHT_WORKERS = int(os.environ.get("OCR_UPRIGHT_WORKERS", "8"))

# pipeline 级别的固定覆盖：人在等，所以版面与识别重叠。
# 整页图和 crop 默认不落盘（大图 PNG 编码是版面阶段的大头）；
# 只有单块重算要从磁盘读 crop，由 build_cfg(save_crops=True) 单独打开。
WEBUI_OVERRIDES: Dict = {
    "pipeline": {
        "overlap_layout": True,
        "save_crops": False,
        "save_pages": False,
    },
    "logging": {"progress_log_every": 5},
}

# RM/TTS 配方（见 docs/rm-tts-pipeline.md）
# rm_url / rm_input_form 通过 ${VAR:-fallback} 语法在 load_config 时展开
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
# 工具函数
# ===================================================================

def new_job_id() -> str:
    """生成唯一 job id，同时也用作 request_id（32 位小写 hex）。"""
    return hashlib.md5(os.urandom(16) + str(time.time()).encode()).hexdigest()


def _fresh_upright_registry() -> bool:
    """登记目录里有一份 90 秒内更新过的工人记录，才算有远程摆正。"""
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
    """每套版面模型放哪张卡。池子仍是一条，空闲的那套接下一个页。

    OCR_LAYOUT_DEVICES=cuda:0,cuda:0,cuda:1,cuda:1 时按列出的顺序。
    没写时，可见卡多于一张就轮流放；只有一张卡就全部用 OCR_LAYOUT_DEVICE。
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
    """把 WEBUI_OVERRIDES 和本次请求的覆盖合并，浅合并一层。"""
    merged = {key: dict(value) for key, value in WEBUI_OVERRIDES.items()}
    for key, value in sections.items():
        merged.setdefault(key, {}).update(value)
    return merged


# ===================================================================
# Runner — 模型资源管理 + 单块重算
# ===================================================================

class Runner:
    """模型只加载一次，跨请求复用。线程安全。"""

    def __init__(self) -> None:
        JOBS_DIR.mkdir(parents=True, exist_ok=True)
        self._res_lock  = threading.Lock()
        self._engine = None
        self._slots: "queue.Queue[Dict]" = queue.Queue()
        self._slot_count = 0
        self._upright_pool = None
        self._upright_loaded = False

    # ----------------------------------------------------------------
    # 配置构建
    # ----------------------------------------------------------------

    def build_cfg(self, job_id: str, upright: bool,
                  mode: str = DEFAULT_MODE, save_crops: bool = False) -> Dict:
        """构建一次请求的完整 SDK 配置。"""
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
            # 工作台的印章/图表开关只改展示。识别侧始终打开，否则这两类块会被跳过。
            layout={
                "use_chart_recognition": True,
                "use_seal_recognition": True,
            },
            pipeline={"save_crops": bool(save_crops)},
            # 配方里有嵌套 dict，并发请求之间不能共享同一份
            tts=copy.deepcopy(TTS_RECIPES[mode]),
        )
        return load_config(str(CONFIG_PATH), overrides)

    # ----------------------------------------------------------------
    # 模型资源
    # ----------------------------------------------------------------

    def _ensure_started(self, cfg: Dict) -> None:
        """模型懒加载：第一次调用时建 engine 和 LAYOUT_WORKERS 套版面资源。"""
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
        """准备三条队列，但不借出版面检测器。"""
        self._ensure_started(cfg)
        return {
            "layout_pool": self._slots,
            "layout_slots": self._slot_count,
            "upright": self._upright_pool,
            "engine": self._engine,
        }

    def borrow(self, cfg: Dict) -> Dict:
        """借一套版面模型。用完调用 release，不必等到这一页的切片结束。"""
        self._ensure_started(cfg)
        return self._slots.get()

    def release(self, slot: Dict) -> None:
        self._slots.put(slot)

    def resources_for(self, slot: Dict) -> Dict:
        return {"detectors": [slot["detector"]], "upright": self._upright_pool,
                "engine": self._engine}

    @contextlib.contextmanager
    def acquire(self, cfg: Dict) -> Iterator[Dict]:
        """借一套版面模型；摆正队列是所有请求共用的。"""
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
