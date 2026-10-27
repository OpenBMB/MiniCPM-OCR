from __future__ import annotations

import time
from abc import ABC, abstractmethod
from typing import Dict, List, Sequence

import numpy as np


class LayoutError(RuntimeError):
    pass


from ..constants import IMAGE_LABELS  # noqa: E402


DEFAULT_SKIP_VLM_LABELS = IMAGE_LABELS + ("chart", "seal")


def resolve_skip_vlm_labels(layout_cfg: Dict | None) -> frozenset:
    'The one rule for deciding which labels never reach the VLM.'
    cfg = layout_cfg or {}
    configured = cfg.get("skip_vlm_labels")
    if configured is not None:
        return frozenset(configured)

    labels = set() if cfg.get("use_ocr_for_image_block") else set(IMAGE_LABELS)
    if not cfg.get("use_chart_recognition"):
        labels.add("chart")
    if not cfg.get("use_seal_recognition"):
        labels.add("seal")
    return frozenset(labels)


class BaseLayoutDetector(ABC):
    """A layout detector plugged into the `parse-layout` stage.

    The contract is plain data, deliberately independent of any framework's
    output format. `detect()` takes PIL images and returns, per image, the
    detections in reading order:

        {
            "index": int,             # detection index within the page
            "label": str,             # raw class name, already resolved
            "class_id": int,          # numeric class id, kept for raw artifacts
            "score": float,           # confidence
            "bbox": [x1, y1, x2, y2], # pixel coords in the input image
            "polygon": [[x, y], ...], # optional, [] when unavailable
        }

    `crop()` turns one page's detections into the blocks the OCR stage
    consumes, still in reading order:

        {
            "label": str,
            "class_id": int,
            "score": float,
            "bbox": [x1, y1, x2, y2],   # int pixel coords
            "image": np.ndarray | None, # RGB crop; None = folded into the
                                        #   previous block's image
            "polygon": [[x, y], ...],
            "skip_vlm": bool,           # crop is kept but never sent to the VLM
        }

    Coordinates stay in input-image pixels rather than a normalized 0-1000
    range because the pipeline crops straight from those coordinates; rounding
    through a normalized form would shift crop edges and change OCR output.
    """

    name = "base"

    def __init__(self, config: Dict):
        self.config = config


        self.skip_vlm_labels = resolve_skip_vlm_labels(config)
        self.device = "cpu"
        self.model_load_sec = 0.0
        self._started = False

    def start(self) -> None:
        if self._started:
            return
        started = time.time()
        self._start()
        self.model_load_sec = time.time() - started
        self._started = True

    def stop(self) -> None:
        return None

    @abstractmethod
    def _start(self) -> None:
        pass

    @abstractmethod
    def detect(self, images: Sequence) -> List[List[Dict]]:
        'Batch-detect layout regions. One result list per input image.'

    def crop(self, image, detections: Sequence[Dict]) -> List[Dict]:
        'Rectangle crop, one block per detection. Providers override to filter / mask / merge before cropping.'
        width, height = image.size
        pixels = np.asarray(image)
        blocks: List[Dict] = []
        for detection in detections:
            x1, y1, x2, y2 = clamp_bbox(detection["bbox"], width, height)
            blocks.append(
                {
                    "label": detection["label"],
                    "class_id": int(detection["class_id"]),
                    "score": float(detection["score"]),
                    "bbox": [x1, y1, x2, y2],
                    "image": pixels[y1:y2, x1:x2].copy(),
                    "polygon": list(detection.get("polygon") or []),
                    "skip_vlm": detection["label"] in self.skip_vlm_labels,
                }
            )
        return blocks

    def model_ref(self) -> str:
        'Human-readable pointer to the loaded weights, recorded in run summaries.'
        return ""

    def describe(self) -> Dict:
        return {
            "provider": self.name,
            "device": self.device,
            "model_ref": self.model_ref(),
            "model_load_sec": round(self.model_load_sec, 6),
        }

    @staticmethod
    def validate_config(layout_cfg: Dict) -> None:
        'Optional per-provider config validation hook, called by config loading.'
        return None


def clamp_bbox(bbox: Sequence[float], width: int, height: int) -> List[int]:
    'Round to int pixels and keep at least a 1x1 box inside the image.'
    x1 = max(0, min(width - 1, int(round(float(bbox[0])))))
    y1 = max(0, min(height - 1, int(round(float(bbox[1])))))
    x2 = max(x1 + 1, min(width, int(round(float(bbox[2])))))
    y2 = max(y1 + 1, min(height, int(round(float(bbox[3])))))
    return [x1, y1, x2, y2]


def polygon_to_list(polygon) -> List[List[float]]:
    if polygon is None:
        return []
    points = polygon.tolist() if hasattr(polygon, "tolist") else list(polygon)
    out: List[List[float]] = []
    for point in points:
        if isinstance(point, (list, tuple)) and len(point) >= 2:
            out.append([float(point[0]), float(point[1])])
    return out
