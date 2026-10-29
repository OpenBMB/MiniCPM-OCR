from __future__ import annotations

import base64
import io
import json
import os
import queue
import threading
import time
import urllib.request
from concurrent.futures import Future
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

SMALL = 1100


def _cv2():
    import cv2

    return cv2


def binarize(img_bgr, size=None):
    cv2 = _cv2()
    g = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    h, w = g.shape
    s = (size or SMALL) / max(h, w)
    if s < 1:
        g = cv2.resize(g, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)

    m = int(0.02 * max(g.shape))
    g = g[m:g.shape[0] - m, m:g.shape[1] - m]
    b = cv2.adaptiveThreshold(g, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                              cv2.THRESH_BINARY_INV, max(15, int((size or SMALL) / 35)) | 1, 15)

    b = cv2.morphologyEx(b, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return b


def rotate_keep(b, angle):
    cv2 = _cv2()
    h, w = b.shape
    c = (w / 2, h / 2)
    M = cv2.getRotationMatrix2D(c, angle, 1.0)
    cos, sin = abs(M[0, 0]), abs(M[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    M[0, 2] += nw / 2 - c[0]
    M[1, 2] += nh / 2 - c[1]
    return cv2.warpAffine(b, M, (nw, nh), flags=cv2.INTER_NEAREST, borderValue=0)


def profile_sharpness(b):
    "How 'line-like' each axis is: mean squared gradient of the profile, scale-normalized."
    cv2 = _cv2()
    out = []
    for ax in (1, 0):
        p = b.sum(axis=ax).astype(np.float64)
        p = cv2.GaussianBlur(p.reshape(-1, 1), (1, 5), 0).ravel()
        mu = p.mean()
        if mu < 1e-6:
            out.append(0.0)
            continue
        d = np.diff(p)
        out.append(float((d * d).mean() / (mu * mu)))
    return out


_PROBE_ANGLES = (0.0, -1.0, 1.0, -2.0, 2.0, -4.0, 4.0)


_NEAR_MARGIN = 2.0
_FAR_MARGIN = 4.0


def _downscale_bin(b, limit):
    cv2 = _cv2()
    if max(b.shape) <= limit:
        return b
    s = limit / max(b.shape)
    return cv2.resize(b, (int(b.shape[1] * s), int(b.shape[0] * s)), interpolation=cv2.INTER_AREA)


def _score_angles(small, angles):
    scores = {}
    best_a, best_s = 0.0, -1.0
    for angle in angles:
        score = max(profile_sharpness(rotate_keep(small, float(angle))))
        scores[float(angle)] = score
        if score > best_s:
            best_a, best_s = float(angle), score
    return best_a, scores


def estimate_skew(b):
    'Return skew in (-45,45]: rotating the image by the result (CCW) aligns text to the grid.'
    small = _downscale_bin(b, 700)
    _, probe = _score_angles(small, _PROBE_ANGLES)
    near = max(probe[-1.0], probe[1.0], 1e-9)
    far = max(probe[-2.0], probe[2.0], probe[-4.0], probe[4.0], 1e-9)
    if probe[0.0] >= _NEAR_MARGIN * near and probe[0.0] >= _FAR_MARGIN * far:
        return 0.0
    best, _ = _score_angles(small, np.arange(-44.0, 44.001, 2.0))
    best, _ = _score_angles(small, np.arange(best - 1.2, best + 1.2001, 0.2))
    return float(best)


def refine_skew(b, span=1.0, step=0.05, res=1400):
    'Local skew refinement at higher resolution; returns extra CCW rotation.'
    cv2 = _cv2()
    small = b
    if max(small.shape) > res:
        s = res / max(small.shape)
        small = cv2.resize(small, (int(small.shape[1] * s), int(small.shape[0] * s)),
                           interpolation=cv2.INTER_AREA)
    angles = np.arange(-span, span + 1e-9, step)
    sc = [max(profile_sharpness(rotate_keep(small, a))) for a in angles]
    return float(angles[int(np.argmax(sc))])


def segment_lines(b):
    'Rows of text lines from the horizontal profile; returns list of (y0, y1).'
    cv2 = _cv2()
    p = b.sum(axis=1).astype(np.float64)
    p = cv2.GaussianBlur(p.reshape(-1, 1), (1, 5), 0).ravel()
    th = 0.15 * np.percentile(p, 95) if p.max() > 0 else 0
    on = p > th
    lines, y0 = [], None
    for i, v in enumerate(on):
        if v and y0 is None:
            y0 = i
        elif not v and y0 is not None:
            if i - y0 >= 4:
                lines.append((y0, i))
            y0 = None
    if y0 is not None and len(on) - y0 >= 4:
        lines.append((y0, len(on)))
    return lines


def rotate_full(img, angle, interp=None):
    'Rotate a full-resolution page by `angle` degrees CCW on a white canvas.'
    cv2 = _cv2()
    if interp is None:
        interp = cv2.INTER_CUBIC
    h, w = img.shape[:2]
    c = (w / 2, h / 2)
    M = cv2.getRotationMatrix2D(c, angle, 1.0)
    cos, sin = abs(M[0, 0]), abs(M[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    M[0, 2] += nw / 2 - c[0]
    M[1, 2] += nh / 2 - c[1]
    return cv2.warpAffine(img, M, (nw, nh), flags=interp, borderValue=(255, 255, 255))


class UprightCorrector:
    'Stateful wrapper: loads the PP-LCNet doc-orientation classifier once.'

    def __init__(self, cfg: Dict):
        up = cfg["upright"]
        self.doc_gate = bool(up.get("doc_gate", True))
        self.min_apply = float(up.get("min_apply_deg", 0.3))
        self.cls_long_side = int(up.get("cls_long_side", 1600))
        self.gate_min_side = int(up.get("gate_min_side", 500))
        self.gate_min_lines = int(up.get("gate_min_lines", 6))
        model_dir = up.get("model_dir", "")
        try:
            from paddleocr import DocImgOrientationClassification
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(f"upright.enabled requires paddleocr: {exc}") from exc
        kwargs = _predictor_kwargs("PP-LCNet_x1_0_doc_ori", model_dir, up)
        self._model = DocImgOrientationClassification(**kwargs)
        self._lock = threading.Lock()

        self.confirm = bool(up.get("orientation_confirm", True))
        self.vote_lines = int(up.get("vote_lines", 12))
        self.vote_min_lines = int(up.get("vote_min_lines", 5))
        self.vote_axis_margin = float(up.get("vote_axis_margin", 1.5))
        self.vote_flip_majority = float(up.get("vote_flip_majority", 0.75))
        self._det = None
        self._textline = None
        if self.confirm:
            from paddleocr import TextDetection, TextLineOrientationClassification
            det_kwargs = _predictor_kwargs("PP-OCRv5_mobile_det", up.get("det_model_dir") or "", up)

            det_kwargs["enable_mkldnn"] = False
            self._det = TextDetection(**det_kwargs)
            tl_kwargs = _predictor_kwargs("PP-LCNet_x1_0_textline_ori", up.get("textline_model_dir") or "", up)
            self._textline = TextLineOrientationClassification(**tl_kwargs)

    def _horiz_lines(self, img):

        r = list(self._det.predict(img, batch_size=1))[0]
        out = []
        for poly, sc in zip(r["dt_polys"], r["dt_scores"]):
            p = np.asarray(poly)
            w = p[:, 0].max() - p[:, 0].min()
            h = p[:, 1].max() - p[:, 1].min()
            if sc < 0.5 or h <= 0:
                continue
            if w / h >= 2.0 and w >= 0.08 * img.shape[1]:
                out.append((int(w), int(p[:, 0].min()), int(p[:, 1].min()),
                            int(p[:, 0].max()), int(p[:, 1].max())))
        out.sort(reverse=True)
        return out

    def _vote_orientation(self, img_bgr):

        cv2 = _cv2()
        img = img_bgr
        s = self.cls_long_side / max(img.shape[:2])
        if s < 1:
            img = cv2.resize(img, (int(img.shape[1] * s), int(img.shape[0] * s)),
                             interpolation=cv2.INTER_AREA)
        img = np.ascontiguousarray(img)
        img90 = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
        l0 = self._horiz_lines(img)
        l90 = self._horiz_lines(img90)
        if max(len(l0), len(l90)) < self.vote_min_lines:
            return None
        if len(l0) >= self.vote_axis_margin * max(len(l90), 1) and len(l0) > len(l90):
            base, lines, axis = img, l0, 0
        elif len(l90) >= self.vote_axis_margin * max(len(l0), 1) and len(l90) > len(l0):
            base, lines, axis = img90, l90, 90
        else:
            return None
        crops = []
        for _, x1, y1, x2, y2 in lines[:self.vote_lines]:
            c = base[max(0, y1 - 2):y2 + 2, max(0, x1 - 2):x2 + 2]
            if c.size:
                crops.append(np.ascontiguousarray(c))
        if len(crops) < self.vote_min_lines:
            return None
        n180 = 0
        for c in crops:
            r = list(self._textline.predict(c, batch_size=1))[0]
            if str(r["label_names"][0]).startswith("180"):
                n180 += 1
        frac = n180 / len(crops)
        if frac >= self.vote_flip_majority:
            return (axis + 180) % 360
        if frac <= 1 - self.vote_flip_majority:
            return axis
        return None

    def correct(self, image_rgb: np.ndarray) -> Tuple[np.ndarray, Dict]:
        'Upright-correct one page.'
        cv2 = _cv2()
        img = image_rgb[:, :, ::-1]
        b = binarize(np.ascontiguousarray(img))
        if self.doc_gate:
            nlines = max(len(segment_lines(b)),
                         len(segment_lines(cv2.rotate(b, cv2.ROTATE_90_CLOCKWISE))))
            if min(img.shape[:2]) < self.gate_min_side or nlines < self.gate_min_lines:
                return image_rgb, {"gated": True}

        deskew = estimate_skew(b)


        if abs(deskew) >= self.min_apply:
            b_big = binarize(np.ascontiguousarray(img), size=2000)
            deskew += refine_skew(rotate_keep(b_big, deskew), step=0.2)
            deskew_search = "refined"
        else:
            deskew_search = "straight" if deskew == 0.0 else "coarse"


        cls_img = img
        s = self.cls_long_side / max(img.shape[:2])
        if s < 1:
            cls_img = cv2.resize(img, (int(img.shape[1] * s), int(img.shape[0] * s)),
                                 interpolation=cv2.INTER_AREA)
        if deskew:
            cls_img = rotate_full(np.ascontiguousarray(cls_img), deskew, interp=cv2.INTER_LINEAR)
        else:
            cls_img = np.ascontiguousarray(cls_img)
        with self._lock:
            r = list(self._model.predict(cls_img, batch_size=1))[0]
        label, score = int(r["label_names"][0]), float(r["scores"][0])

        record = {
            "deskew": round(deskew, 3),
            "label": label,
            "score": round(score, 4),
            "deskew_search": deskew_search,
        }
        if label != 0 and self.confirm:


            with self._lock:
                vote = self._vote_orientation(cls_img)
            record["vote"] = vote
            if vote != label:
                record["label_vetoed"] = label
                label = 0
                record["label"] = 0
        corr = deskew + label
        record["correction"] = round(corr, 3)
        resid = abs(corr) % 360
        if min(resid, 360 - resid) < self.min_apply:
            record["applied"] = False
            return image_rgb, record
        record["applied"] = True
        out = rotate_full(np.ascontiguousarray(img), corr)
        return np.ascontiguousarray(out[:, :, ::-1]), record


def _predictor_kwargs(model_name: str, model_dir: str, up: Dict) -> Dict:

    kwargs = {"model_name": model_name}
    if model_dir:
        kwargs["model_dir"] = model_dir
    device = str(up.get("device") or os.environ.get("OCR_UPRIGHT_DEVICE") or "").strip()
    if device:
        kwargs["device"] = device
    if device == "cpu":
        kwargs["enable_mkldnn"] = False
        kwargs["cpu_threads"] = int(up.get("cpu_threads") or os.environ.get("OCR_UPRIGHT_CPU_THREADS") or 1)
    return kwargs


def upright_enabled(cfg: Dict) -> bool:
    return bool(cfg.get("upright", {}).get("enabled", False))


class UprightPool:
    '全局摆正队列。不同请求、不同文件的页都进同一条队列。'

    def __init__(self, cfg: Dict, workers: int):
        cv2 = _cv2()
        cv2.setNumThreads(max(1, int(os.environ.get("OCR_CV2_THREADS", "2"))))
        self.workers = max(1, int(workers))
        self._queue: "queue.Queue" = queue.Queue()
        self._correctors = [UprightCorrector(cfg) for _ in range(self.workers)]
        self._threads = [
            threading.Thread(
                target=self._loop,
                args=(corrector,),
                name=f"upright-{index}",
                daemon=True,
            )
            for index, corrector in enumerate(self._correctors)
        ]
        for thread in self._threads:
            thread.start()

    def submit(self, image_rgb: np.ndarray) -> Future:
        future: Future = Future()
        self._queue.put((image_rgb, future, time.perf_counter()))
        return future

    def correct(self, image_rgb: np.ndarray):
        corrected, record, _wait = self.submit(image_rgb).result()
        return corrected, record

    def _loop(self, corrector: UprightCorrector) -> None:
        while True:
            image, future, _queued = self._queue.get()
            if image is None:
                return
            started = time.perf_counter()
            try:
                corrected, record = corrector.correct(image)
                record["upright_sec"] = round(time.perf_counter() - started, 6)
                future.set_result((corrected, record, time.perf_counter() - _queued))
            except Exception as exc:
                future.set_exception(exc)


def build_upright_pool(cfg: Dict, workers: int) -> "UprightPool | None":
    '共享队列。没打开摆正时返回 None，调用方就跳过这一步。'
    upright_cfg = dict(cfg)
    upright_cfg["upright"] = dict(cfg.get("upright") or {}, enabled=True)
    count = int(os.environ.get("OCR_UPRIGHT_WORKERS", str(workers)) or workers)
    return UprightPool(upright_cfg, count)


class _FleetSlot:
    def __init__(self, name: str, capacity: int):
        self.name = name
        self.capacity = max(1, int(capacity))
        self.inflight = 0
        self.down_until = 0.0


class UprightFleet:
    '本机工人和远程摆正服务合成一条队列。'

    def __init__(self, local: "UprightPool | None", registry: str):
        self._local_pool = local
        self._registry = Path(registry) if registry else None
        self._local = _FleetSlot("local", local.workers) if local is not None else None
        self._remotes: Dict[str, _FleetSlot] = {}
        self._cv = threading.Condition()
        self._refreshed_at = 0.0

    @property
    def workers(self) -> int:
        self._refresh()
        with self._cv:
            now = time.time()
            total = self._local.capacity if self._local is not None else 0
            for slot in self._remotes.values():
                if slot.down_until <= now:
                    total += slot.capacity
            return total

    def submit(self, image_rgb: np.ndarray) -> Future:
        future: Future = Future()
        threading.Thread(
            target=self._dispatch, args=(image_rgb, future),
            name="upright-dispatch", daemon=True,
        ).start()
        return future

    def correct(self, image_rgb: np.ndarray):
        corrected, record, _wait = self.submit(image_rgb).result()
        return corrected, record

    def _dispatch(self, image_rgb: np.ndarray, future: Future) -> None:
        tried: List[str] = []
        last = "没有可用的摆正工人"
        while len(tried) < 6:
            slot = self._acquire(exclude=set(tried))
            if slot is None:
                break
            try:
                if slot.name == "local" and self._local_pool is not None:
                    result = self._local_pool.submit(image_rgb).result()
                else:
                    result = _remote_correct(slot.name, image_rgb)
                future.set_result(result)
                return
            except Exception as exc:
                last = str(exc) or exc.__class__.__name__
                with self._cv:
                    slot.down_until = time.time() + 30
                tried.append(slot.name)
            finally:
                with self._cv:
                    slot.inflight = max(0, slot.inflight - 1)
                    self._cv.notify_all()
        future.set_exception(RuntimeError(last))

    def _acquire(self, exclude: set) -> Optional[_FleetSlot]:
        with self._cv:
            deadline = time.time() + 120
            while time.time() < deadline:
                self._refresh_locked()
                now = time.time()
                local = [self._local] if self._local is not None else []
                choices = [
                    slot for slot in local + list(self._remotes.values())
                    if slot.name not in exclude and slot.down_until <= now
                ]
                if not choices:
                    return None
                free = [slot for slot in choices if slot.inflight < slot.capacity]
                if free:
                    slot = max(free, key=lambda item: item.capacity - item.inflight)
                    slot.inflight += 1
                    return slot
                self._cv.wait(timeout=0.5)
        return None

    def _refresh(self) -> None:
        with self._cv:
            self._refresh_locked()

    def _refresh_locked(self) -> None:
        now = time.time()
        if now - self._refreshed_at < 5:
            return
        self._refreshed_at = now
        found: Dict[str, int] = {}
        if self._registry and self._registry.is_dir():
            for path in self._registry.glob("*.json"):
                try:
                    if now - path.stat().st_mtime > 90:
                        continue
                    row = json.loads(path.read_text(encoding="utf-8"))
                except Exception:
                    continue
                url = str(row.get("url") or "").rstrip("/")
                if url:
                    found[url] = max(1, int(row.get("workers") or 1))
        for url in list(self._remotes):
            if url not in found and self._remotes[url].inflight == 0:
                del self._remotes[url]
        for url, capacity in found.items():
            slot = self._remotes.get(url)
            if slot is None:
                self._remotes[url] = _FleetSlot(url, capacity)
            else:
                slot.capacity = capacity


def _remote_correct(url: str, image_rgb: np.ndarray):
    from PIL import Image
    buf = io.BytesIO()
    Image.fromarray(image_rgb).save(buf, format="PNG")
    request = urllib.request.Request(
        url + "/v1/upright",
        data=buf.getvalue(),
        headers={"Content-Type": "image/png"},
        method="POST",
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=60) as response:
        body = json.loads(response.read().decode("utf-8"))
    record = body.get("record") or {}
    if body.get("applied") and body.get("image_png_b64"):
        raw = base64.b64decode(body["image_png_b64"])
        corrected = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"))
        return corrected, record, float(record.get("upright_sec") or 0)
    return image_rgb, record, float(record.get("upright_sec") or 0)


def build_upright_fleet(local: "UprightPool | None", registry: str) -> UprightFleet:
    return UprightFleet(local, registry)


def build_upright_corrector(cfg: Dict) -> "UprightCorrector | None":
    'A corrector when the config asks for one, else None.'
    return UprightCorrector(cfg) if upright_enabled(cfg) else None
