#!/usr/bin/env python3

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Dict, List, Optional

from PIL import Image

RM_MODEL_DIR = os.environ.get("OCR_RM_MODEL_DIR", "/models/rm")
RM_INPUT_FORM = os.environ.get("OCR_RM_INPUT_FORM", "")


class RmService:
    '进程内 RM 推理服务。'

    def __init__(
        self,
        model_dir: str = RM_MODEL_DIR,
        input_form: str = RM_INPUT_FORM,
    ) -> None:
        self._model_dir = model_dir
        self._input_form = input_form
        self._model = None
        self._error = ""
        self._lock = threading.Lock()


    def configured(self) -> bool:
        'RM 是否已正确配置（input_form 存在且合法）。'
        return self._input_form in ("binary", "ternary")

    def loaded(self) -> bool:
        return self._model is not None

    def error(self) -> str:
        return self._error

    def score(
        self,
        image: Image.Image,
        candidates: List[str],
        label: str,
        case_id: str,
    ) -> Dict:
        '给一批候选文本打分，返回最优下标和各候选的分数。'
        if not self.configured():
            return self._error_result("RM 未配置：OCR_RM_INPUT_FORM 未设置")
        if not candidates:
            return self._error_result("候选列表为空")
        try:
            model = self._get_model()
        except Exception as exc:
            return self._error_result(f"RM 模型加载失败：{exc}")
        try:
            return model.score_best(
                image=image,
                candidates=candidates,
                label=label,
                case_id=case_id,
            )
        except Exception as exc:
            return self._error_result(f"{type(exc).__name__}: {exc}")

    def health(self) -> Dict:
        return {
            "configured": self.configured(),
            "loaded": self.loaded(),
            "input_form": self._input_form,
            "model_dir": self._model_dir,
            "error": self._error or None,
        }

    def close(self) -> None:
        with self._lock:
            if self._model is not None:
                try:
                    self._model.close()
                except Exception:
                    pass
                self._model = None


    def _get_model(self):

        if self._model is not None:
            return self._model
        with self._lock:
            if self._model is not None:
                return self._model
            self._model = self._load_model()
        return self._model

    def _load_model(self):

        model_path = Path(self._model_dir)
        if not model_path.is_dir():
            raise FileNotFoundError(f"RM 模型目录不存在：{self._model_dir}")


        try:
            from minicpmvocr.rm import build_rm_scorer  # type: ignore[import]
            model = build_rm_scorer(
                model_dir=str(model_path),
                input_form=self._input_form,
            )
            print(f"[scoring_service] loaded RM model from {self._model_dir}", flush=True)
            return model
        except ImportError:
            pass


        import importlib.util
        candidate = model_path / "rm_model.py"
        if candidate.is_file():
            spec = importlib.util.spec_from_file_location("rm_model", candidate)
            module = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
            spec.loader.exec_module(module)  # type: ignore[union-attr]
            model = module.build_rm_scorer(
                model_dir=str(model_path),
                input_form=self._input_form,
            )
            print(f"[scoring_service] loaded RM model (standalone) from {self._model_dir}", flush=True)
            return model

        raise ImportError(
            "找不到 RM 模型实现：需要 minicpmvocr.rm 子包或 "
            f"{self._model_dir}/rm_model.py"
        )

    @staticmethod
    def _error_result(msg: str) -> Dict:
        return {
            "best_index": 0,
            "scores": [],
            "verdicts": [],
            "rm_error": msg,
            "stage_sec": {"precheck": 0.0, "render": 0.0, "forward": 0.0},
        }
