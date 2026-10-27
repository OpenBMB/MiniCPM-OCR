#!/usr/bin/env python3

from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ENV_FILE = Path(os.environ.get(
    "RM_BRIDGE_ENV",
    Path(os.environ.get("OCRWEB_DATA_DIR", Path(__file__).resolve().parent / "data")) / "rm_score.env",
))
PORT = int(os.environ.get("RM_BRIDGE_PORT", "18022"))
WORKERS = int(os.environ.get("RM_BRIDGE_WORKERS", "4"))
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _load_env(path: Path) -> dict:
    out = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


CFG = _load_env(ENV_FILE) if ENV_FILE.is_file() else {}
for _key in ("RM_SCORE_URL", "RM_SCORE_USER", "RM_SCORE_PASSWORD", "RM_SCORE_TIMEOUT"):
    if _key in os.environ:
        CFG[_key] = os.environ[_key]
_missing = [key for key in ("RM_SCORE_URL", "RM_SCORE_USER", "RM_SCORE_PASSWORD") if not CFG.get(key)]
if _missing:
    raise RuntimeError("Set " + ", ".join(_missing) + " through environment variables or RM_BRIDGE_ENV")
REMOTE = CFG["RM_SCORE_URL"]
USER = CFG["RM_SCORE_USER"]
PASSWORD = CFG["RM_SCORE_PASSWORD"]
TIMEOUT = float(CFG.get("RM_SCORE_TIMEOUT") or 60)
TOKEN = base64.b64encode(f"{USER}:{PASSWORD}".encode()).decode("ascii")
POOL = ThreadPoolExecutor(max_workers=max(1, WORKERS))


def _data_uri(image: str) -> str:
    image = image or ""
    if image.startswith("data:"):
        return image
    return "data:image/png;base64," + image


def _score_one(image: str, text: str, category: str) -> dict:
    body = json.dumps({
        "image": _data_uri(image),
        "ocr_text": text,
        "category": category or "text",
    }).encode()
    req = urllib.request.Request(
        REMOTE,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Basic {TOKEN}",
        },
    )
    try:
        with OPENER.open(req, timeout=TIMEOUT) as resp:
            payload = json.loads(resp.read().decode())
        score = payload.get("prob_yes")
        if not isinstance(score, (int, float)):
            return {"score": None, "verdict": "error"}
        return {"score": float(score), "verdict": str(payload.get("verdict") or "scored")}
    except Exception:
        return {"score": None, "verdict": "error"}


def _score_items(items: list) -> list:

    jobs = []
    for item_i, item in enumerate(items):
        image = str(item.get("image") or "")
        category = str(item.get("category") or "text")
        for cand_i, text in enumerate(item.get("candidates") or []):
            jobs.append((item_i, cand_i, image, str(text), category))
    scored = list(POOL.map(lambda job: _score_one(job[2], job[3], job[4]), jobs))
    grouped = []
    for item in items:
        n = len(item.get("candidates") or [])
        grouped.append([{"score": None, "verdict": "error"} for _ in range(n)])
    for (item_i, cand_i, *_rest), row in zip(jobs, scored):
        grouped[item_i][cand_i] = row
    results = []
    for rows in grouped:
        if not rows:
            results.append({"best_index": 0, "scores": [], "verdicts": []})
            continue
        scores = [row["score"] if row["score"] is not None else -1.0 for row in rows]
        verdicts = [row["verdict"] for row in rows]
        usable = [i for i, row in enumerate(rows) if row["score"] is not None]
        best = max(usable, key=lambda i: rows[i]["score"]) if usable else 0
        results.append({"best_index": best, "scores": scores, "verdicts": verdicts})
    return results


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        return

    def _send(self, code: int, payload: dict) -> None:
        raw = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path.split("?", 1)[0] in ("/healthz", "/health"):
            self._send(200, {"status": "ok"})
            return
        self._send(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length).decode() or "{}")
        except Exception:
            self._send(400, {"error": "invalid json"})
            return
        path = self.path.split("?", 1)[0]
        if path == "/v1/rm/score_best":
            self._send(200, _score_items([body])[0])
            return
        if path == "/v1/rm/score_best_batch":
            results = _score_items(list(body.get("items") or []))
            self._send(200, {"results": results, "batch_size": len(results)})
            return
        self._send(404, {"error": "not found"})


if __name__ == "__main__":
    print(f"rm bridge on 127.0.0.1:{PORT} -> remote binary RM", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
