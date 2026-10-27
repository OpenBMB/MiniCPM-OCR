#!/usr/bin/env python3

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
from PIL import Image

from minicpmvocr.pipeline.upright import build_upright_pool


def _cfg() -> dict:
    assets = Path(os.environ.get("OCR_ASSETS_DIR", Path(__file__).resolve().parents[2] / "models"))
    root = os.environ.get("OCR_UPRIGHT_DIR", str(assets / "paddle_upright")).rstrip("/")
    return {
        "upright": {
            "enabled": True,
            "model_dir": f"{root}/PP-LCNet_x1_0_doc_ori",
            "det_model_dir": f"{root}/PP-OCRv5_mobile_det",
            "textline_model_dir": f"{root}/PP-LCNet_x1_0_textline_ori",
            "device": os.environ.get("OCR_UPRIGHT_DEVICE", "cpu"),
        }
    }


def _own_ip() -> str:
    configured = os.environ.get("OCR_ADVERTISE_HOST", "").strip()
    if configured:
        return configured
    try:
        return socket.gethostbyname(socket.gethostname())
    except OSError:
        return "127.0.0.1"


POOL = None
ADVERTISE = ""


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        return

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?", 1)[0] != "/health":
            self._json(404, {"error": "not found"})
            return
        self._json(200, {"ok": True, "workers": POOL.workers, "url": ADVERTISE})

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/v1/upright":
            self._json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            image = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"))
            corrected, record = POOL.correct(image)
        except Exception as exc:
            self._json(500, {"error": str(exc) or exc.__class__.__name__})
            return
        payload = {"applied": bool(record.get("applied")), "record": record}
        if payload["applied"]:
            buf = io.BytesIO()
            Image.fromarray(corrected).save(buf, format="PNG")
            payload["image_png_b64"] = base64.b64encode(buf.getvalue()).decode("ascii")
        self._json(200, payload)


def _advertise(registry: str, url: str, workers: int) -> None:
    os.makedirs(registry, exist_ok=True)
    host = socket.gethostname()
    path = os.path.join(registry, f"{host}.json")
    body = json.dumps({"url": url, "workers": workers, "host": host}, ensure_ascii=False)
    while True:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(body)
        os.replace(tmp, path)
        time.sleep(15)


def main() -> None:
    global POOL, ADVERTISE
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=18080)
    args = parser.parse_args()
    workers = int(os.environ.get("OCR_UPRIGHT_WORKERS", "20"))
    print(f"[upright_server] loading {workers} workers", flush=True)
    POOL = build_upright_pool(_cfg(), workers)
    ip = _own_ip()
    ADVERTISE = f"http://{ip}:{args.port}"
    registry = os.environ.get(
        "OCR_UPRIGHT_REGISTRY",
        str(Path(os.environ.get("OCRWEB_DATA_DIR", Path(__file__).resolve().parent / "data")) / "upright-workers"),
    )
    threading.Thread(target=_advertise, args=(registry, ADVERTISE, POOL.workers), daemon=True).start()
    print(f"[upright_server] listening {ADVERTISE}", flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
