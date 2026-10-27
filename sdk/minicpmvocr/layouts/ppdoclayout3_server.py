from __future__ import annotations

import base64
import io
import json
import time
from typing import Dict, List, Optional, Sequence
from urllib.error import URLError
from urllib.request import Request, urlopen

import numpy as np

from .base import BaseLayoutDetector, LayoutError


def _image_to_b64(img) -> str:
    from PIL import Image

    if isinstance(img, np.ndarray):
        img = Image.fromarray(img)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


class PPDocLayoutV3ServerDetector(BaseLayoutDetector):
    'PP-DocLayoutV3 through a local HTTP detection server (pure torch).'

    name = "ppdoclayout3_server"

    def __init__(self, config: Dict):
        super().__init__(config)
        url = str(config.get("server_url", "http://localhost:8110")).rstrip("/")
        if not url.startswith(("http://", "https://")):
            url = "http://" + url
        self._server_url = url
        self._timeout = float(config.get("timeout", 60))

    def _start(self) -> None:
        self.device = "remote"


        try:
            info = self._http("GET", "/info")
        except Exception:
            info = {}
        self._model_dir = str(info.get("data", {}).get("model_dir", "") or "")

    def detect(self, images: Sequence) -> List[List[Dict]]:
        return [self._detect_one(image) for image in images]

    def _detect_one(self, image) -> List[Dict]:
        payload = json.dumps({"image": _image_to_b64(image)}).encode()
        result = self._http("POST", "/detect", payload)
        boxes = list((result.get("data", {}) or {}).get("boxes", []))
        return [
            {
                "index": idx,
                "label": str(b["label"]),
                "class_id": int(b["class_id"]),
                "score": float(b["score"]),
                "bbox": [float(v) for v in b["bbox"]],
                "polygon": [],
            }
            for idx, b in enumerate(boxes)
        ]

    def crop(self, image, detections: Sequence[Dict]) -> List[Dict]:
        'Rectangle crop — no server-side merge (use ppdoclayout3_paddlex for the full PaddleOCR-VL filter/merge chain).'
        return super().crop(image, detections)

    def model_ref(self) -> str:
        return self._model_dir


    def _http(self, method: str, path: str, data: Optional[bytes] = None) -> Dict:
        url = self._server_url + path
        req = Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        try:
            with urlopen(req, timeout=self._timeout) as resp:
                return json.loads(resp.read().decode())
        except URLError as e:
            raise LayoutError(
                "PP-DocLayoutV3 server unreachable at %s: %s. "
                "Start it with: minicpmvocr serve-layout --model-dir PATH"
                % (self._server_url, e)
            ) from e

    @staticmethod
    def validate_config(layout_cfg: Dict) -> None:
        url = str(layout_cfg.get("server_url", "") or "").strip()
        if not url:
            raise ValueError(
                "layout.server_url is required for provider ppdoclayout3_server"
            )
