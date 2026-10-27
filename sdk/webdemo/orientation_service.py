#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional, Tuple

import numpy as np


class UprightService:
    '整页旋转摆正；进程内直接调用，整页图不做 base64 序列化。'

    def __init__(self, cfg: Dict) -> None:
        self._corrector = None
        self._error = ""
        try:
            from minicpmvocr import UprightCorrector


            upright_cfg = dict(cfg)
            upright_cfg["upright"] = dict(cfg.get("upright") or {}, enabled=True)
            self._corrector = UprightCorrector(upright_cfg)
        except Exception as exc:
            self._error = f"{type(exc).__name__}: {exc}"
            print(f"[orientation_service] unavailable: {exc}", flush=True)

    def enabled(self) -> bool:
        return self._corrector is not None

    def error(self) -> str:
        return self._error

    def correct(self, image_rgb: np.ndarray) -> Tuple[np.ndarray, Dict]:
        '摆正一张页面图。'
        if self._corrector is None:
            return image_rgb, {}
        return self._corrector.correct(image_rgb)

    def status(self) -> Dict:
        return {"loaded": self.enabled(), "error": self._error or None}
