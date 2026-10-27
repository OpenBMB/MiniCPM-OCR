#!/usr/bin/env python3


from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import time
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image


_EMPTY_1X1_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
    "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _b64_to_image(b64: str) -> Image.Image:
    raw = base64.b64decode(b64)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def _image_to_b64(img: Image.Image | np.ndarray, fmt: str = "PNG") -> str:
    if isinstance(img, np.ndarray):
        img = Image.fromarray(img)
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode()


def _is_json_request(h: BaseHTTPRequestHandler) -> bool:
    ct = h.headers.get("Content-Type", "")
    return ct.startswith("application/json")


try:
    from shapely.geometry import Polygon
    from shapely.validation import make_valid  # type: ignore[import-untyped]

    _HAS_SHAPELY = True
except ImportError:
    _HAS_SHAPELY = False


def _bbox_area(bbox: List[float]) -> float:
    return max(0.0, float(bbox[2] - bbox[0]) * float(bbox[3] - bbox[1]))


def _polygon_to_list(poly) -> List[List[float]]:
    if poly is None:
        return []
    points = poly.tolist() if hasattr(poly, "tolist") else list(poly)
    out: List[List[float]] = []
    for pt in points:
        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
            out.append([float(pt[0]), float(pt[1])])
    return out


def _polygon_overlap_ratio(poly1, poly2, mode: str = "small") -> float:
    if not _HAS_SHAPELY or not poly1 or not poly2:
        return 0.0
    try:
        p1 = make_valid(Polygon(poly1))
        p2 = make_valid(Polygon(poly2))
        inter = p1.intersection(p2).area
        if mode == "union":
            ref = p1.union(p2).area
        elif mode == "small":
            ref = min(p1.area, p2.area)
        else:
            ref = max(p1.area, p2.area)
        return float(inter / ref) if ref > 0 else 0.0
    except Exception:
        return 0.0


def _compute_pairwise_overlap(coords: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    x1, y1, x2, y2 = coords[:, 0], coords[:, 1], coords[:, 2], coords[:, 3]
    areas = np.abs((x2 - x1) * (y2 - y1))
    ix1 = np.maximum(x1[:, None], x1[None, :])
    iy1 = np.maximum(y1[:, None], y1[None, :])
    ix2 = np.minimum(x2[:, None], x2[None, :])
    iy2 = np.minimum(y2[:, None], y2[None, :])
    iw = np.maximum(0, ix2 - ix1)
    ih = np.maximum(0, iy2 - iy1)
    ia = iw * ih
    sa = np.minimum(areas[:, None], areas[None, :])
    with np.errstate(divide="ignore", invalid="ignore"):
        overlap = np.where(sa > 0, ia / sa, 0.0)
    return overlap, areas


def _box_overlap_ratio(
    b1: List[float], b2: List[float], mode: str = "union"
) -> float:
    x1 = max(b1[0], b2[0])
    y1 = max(b1[1], b2[1])
    x2 = min(b1[2], b2[2])
    y2 = min(b1[3], b2[3])
    iw = max(0.0, x2 - x1)
    ih = max(0.0, y2 - y1)
    iarea = iw * ih
    a1 = _bbox_area(b1)
    a2 = _bbox_area(b2)
    if mode == "union":
        ref = a1 + a2 - iarea
    elif mode == "small":
        ref = min(a1, a2)
    else:
        ref = max(a1, a2)
    return float(iarea / ref) if ref > 0 else 0.0


def filter_overlap_boxes(
    boxes: List[Dict], layout_shape_mode: str = "auto"
) -> List[Dict]:
    'Drop overlapping & tiny boxes, same logic as PaddleOCR-VL.'
    boxes = [b for b in boxes if b["label"] != "reference"]
    if not boxes:
        return boxes

    coords = np.array([b["coordinate"] for b in boxes], dtype=np.float64)
    widths = coords[:, 2] - coords[:, 0]
    heights = coords[:, 3] - coords[:, 1]
    overlap_matrix, areas = _compute_pairwise_overlap(coords)

    dropped = set()
    for i in range(len(boxes)):
        if widths[i] < 6 or heights[i] < 6:
            dropped.add(i)
            continue
        for j in range(i + 1, len(boxes)):
            if i in dropped or j in dropped:
                continue
            ratio = overlap_matrix[i, j]
            li = boxes[i]["label"]
            lj = boxes[j]["label"]
            if li == "inline_formula" or lj == "inline_formula":
                if ratio > 0.5:
                    if li == "inline_formula":
                        dropped.add(i)
                    if lj == "inline_formula":
                        dropped.add(j)
                    continue
            if ratio > 0.7:
                if (
                    layout_shape_mode != "rect"
                    and "polygon_points" in boxes[i]
                    and boxes[i]["polygon_points"] is not None
                    and len(boxes[i]["polygon_points"]) > 0
                ):
                    pr = _polygon_overlap_ratio(
                        boxes[i]["polygon_points"],
                        boxes[j]["polygon_points"],
                        "small",
                    )
                    if pr > 0.9:
                        if areas[i] >= areas[j]:
                            dropped.add(j)
                        else:
                            dropped.add(i)
                else:
                    if areas[i] >= areas[j]:
                        dropped.add(j)
                    else:
                        dropped.add(i)
    return [b for idx, b in enumerate(boxes) if idx not in dropped]


class LayoutServer:
    def __init__(
        self,
        model_dir: str,
        device: str = "cpu",
        threshold: float = 0.3,
        layout_nms: bool = True,
        layout_shape_mode: str = "auto",
    ):
        self.model_dir = model_dir
        self.device = device
        self.threshold = threshold
        self.layout_nms = layout_nms
        self.layout_shape_mode = layout_shape_mode
        self._model = None
        self._processor = None
        self._id2label: Dict[int, str] = {}
        self._started_at = time.time()
        self._n_batches = 0

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return

        import torch
        from transformers import (
            AutoModelForObjectDetection,
            AutoImageProcessor,
        )

        t0 = time.time()
        sys.stderr.write(
            f"[layout_server] loading {self.model_dir} → {self.device}\n"
        )
        sys.stderr.flush()


        if self.device.startswith("cuda") or self.device.startswith("gpu"):
            _idx = self.device.split(":")[-1] if ":" in self.device else "0"
            _idx = int(_idx) if _idx.isdigit() else 0
            if not torch.cuda.is_available():
                raise RuntimeError(
                    "device=%s but CUDA is not available" % self.device
                )
            torch.zeros(4, device=f"cuda:{_idx}")

        self._processor = AutoImageProcessor.from_pretrained(
            self.model_dir, local_files_only=True
        )
        self._model = AutoModelForObjectDetection.from_pretrained(
            self.model_dir,
            torch_dtype=torch.float32,
            local_files_only=True,
        ).eval()

        if self.device.startswith("cuda"):
            self._model = self._model.to(self.device)
        elif self.device.startswith("gpu"):
            self._model = self._model.to(
                "cuda:" + (self.device.split(":")[-1] if ":" in self.device else "0")
            )

        self._id2label = {
            int(k): str(v)
            for k, v in self._model.config.id2label.items()
        }
        sys.stderr.write(
            f"[layout_server] ready ({self._model.config.model_type}, "
            f"{len(self._id2label)} labels, {time.time() - t0:.1f}s)\n"
        )
        sys.stderr.flush()

    def info(self) -> Dict:
        self._ensure_loaded()
        return {
            "model_dir": self.model_dir,
            "model_type": self._model.config.model_type,
            "device": self.device,
            "threshold": self.threshold,
            "layout_nms": self.layout_nms,
            "layout_shape_mode": self.layout_shape_mode,
            "n_labels": len(self._id2label),
            "id2label": self._id2label,
            "uptime_sec": round(time.time() - self._started_at, 1),
            "n_batches": self._n_batches,
        }

    def detect(self, image_b64: str, threshold: Optional[float] = None) -> List[Dict]:
        self._ensure_loaded()
        import torch

        thr = float(threshold) if threshold is not None else self.threshold
        img = _b64_to_image(image_b64)

        inputs = self._processor(images=img, return_tensors="pt")
        if self.device != "cpu":
            inputs = {k: v.to(self._model.device) for k, v in inputs.items()}

        with torch.no_grad():
            outputs = self._model(**inputs)

        h, w = img.size[::-1]
        result = self._processor.post_process_object_detection(
            outputs, target_sizes=[(h, w)], threshold=thr
        )[0]

        boxes: List[Dict] = []
        for box, label_id, score in zip(
            result["boxes"].tolist(), result["labels"].tolist(), result["scores"].tolist()
        ):
            boxes.append(
                {
                    "label": self._id2label.get(int(label_id), str(label_id)),
                    "class_id": int(label_id),
                    "score": round(float(score), 6),
                    "bbox": [round(float(v), 2) for v in box],
                }
            )

        self._n_batches += 1
        return boxes

    def detect_raw(self, image_b64: str, threshold: Optional[float] = None) -> List[Dict]:
        'Raw detection only — no filter/merge/crop after.'
        return self.detect(image_b64, threshold)

    def detect_full(self, image_b64: str, threshold: Optional[float] = None) -> List[Dict]:
        'Full pipeline: detect → filter_overlap_boxes → NMS → merge.'
        boxes = self.detect(image_b64, threshold)


        pd_boxes = [
            {
                "cls_id": b["class_id"],
                "label": b["label"],
                "score": b["score"],
                "coordinate": b["bbox"],
            }
            for b in boxes
        ]


        filtered_boxes = filter_overlap_boxes(pd_boxes, self.layout_shape_mode)
        if not filtered_boxes:
            filtered_boxes = pd_boxes


        return [
            {
                "label": b["label"],
                "class_id": int(b["cls_id"]),
                "score": round(float(b["score"]), 6),
                "bbox": [round(float(v), 2) for v in b["coordinate"]],
            }
            for b in filtered_boxes
        ]


class LayoutHandler(BaseHTTPRequestHandler):
    server_obj: LayoutServer

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _json(self, code: int, data: Dict):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _ok(self, data: Any):
        self._json(200, {"ok": True, "data": data})

    def _err(self, code: int, msg: str):
        self._json(code, {"ok": False, "error": msg})

    def do_GET(self):
        if self.path == "/health":
            try:
                self.server_obj._ensure_loaded()
                self._json(200, {"ok": True, "status": "healthy"})
            except Exception as e:
                self._err(503, str(e))
        elif self.path == "/info":
            try:
                self._ok(self.server_obj.info())
            except Exception as e:
                self._err(500, str(e))
        else:
            self._err(404, "not found")

    def do_POST(self):
        if not _is_json_request(self):
            self._err(400, "Content-Type must be application/json")
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            payload = json.loads(raw) if raw else {}
        except Exception:
            self._err(400, "invalid JSON body")
            return

        image_b64 = str(payload.get("image") or "")
        if not image_b64:

            img_path = str(payload.get("image_path") or "")
            if img_path and os.path.isfile(img_path):
                pil = Image.open(img_path).convert("RGB")
                image_b64 = _image_to_b64(pil)
        if not image_b64:
            self._err(400, "missing 'image' (base64) or 'image_path'")
            return

        threshold = payload.get("threshold")
        if threshold is not None:
            threshold = float(threshold)

        try:
            if self.path == "/detect":
                boxes = self.server_obj.detect(image_b64, threshold)
            elif self.path == "/detect_full":
                boxes = self.server_obj.detect_full(image_b64, threshold)
            else:

                boxes = self.server_obj.detect(image_b64, threshold)
            self._ok({"boxes": boxes})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            self._err(500, str(e))


def make_handler(srv: LayoutServer):
    class _Handler(LayoutHandler):
        pass
    _Handler.server_obj = srv
    return _Handler


def _parse_args(argv=None):
    p = argparse.ArgumentParser(
        prog="minicpmvocr serve-layout",
        description="PP-DocLayoutV3 standalone detection server (pure torch)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument(
        "--model-dir",
        default=os.environ.get("LAYOUT_MODEL_DIR", ""),
        help="Model directory (config.json + model.safetensors)",
    )
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8110)
    p.add_argument("--device", default="cpu", help="cuda:0 / cpu / gpu:1 …")
    p.add_argument("--threshold", type=float, default=0.3)
    p.add_argument("--no-nms", action="store_true", help="disable layout NMS")
    p.add_argument("--shape-mode", default="auto", choices=["auto", "rect", "poly"])
    p.add_argument("--idle-ttl", type=float, default=0,
                   help="auto-exit after N seconds of idle (0 = never)")
    return p.parse_args(argv)


def main(argv=None):
    args = _parse_args(argv)

    if not args.model_dir:
        print("error: --model-dir is required (or set LAYOUT_MODEL_DIR)", file=sys.stderr)
        return 1

    if not os.path.isdir(args.model_dir):
        print(f"error: model-dir not found: {args.model_dir}", file=sys.stderr)
        return 1

    server = LayoutServer(
        model_dir=args.model_dir,
        device=args.device,
        threshold=args.threshold,
        layout_nms=not args.no_nms,
        layout_shape_mode=args.shape_mode,
    )


    try:
        sys.stderr.write("[layout_server] pre-loading model...\n")
        sys.stderr.flush()
        server._ensure_loaded()
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        return 1

    httpd = HTTPServer((args.host, args.port), make_handler(server))

    msg = (
        f"[layout_server] listening on {args.host}:{args.port}  "
        f"device={args.device}  model={args.model_dir}"
    )
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()
    if os.isatty(sys.stdout.fileno()):
        print(msg, flush=True)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
