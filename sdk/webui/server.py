#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import parse_qs, unquote

BASE = Path(__file__).resolve().parent
if str(BASE.parent) not in sys.path:
    sys.path.insert(0, str(BASE.parent))

import runner as runner_mod  # noqa: E402
from runner import JOBS_DIR, SUPPORTED_SUFFIXES, Runner, list_jobs, new_job_id, read_job  # noqa: E402

PORT = int(os.environ.get("PORT", "8950"))
STATIC = BASE / "static"

SAFE_ID = re.compile(r"^[A-Za-z0-9_.\-]{1,128}$")
MAX_UPLOAD_BYTES = int(os.environ.get("OCRWEB_MAX_UPLOAD_MB", "512")) * 1024 * 1024

PAGE_DELIMITER = "\n\n<!-- page-break -->\n\n"


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

CTYPES = {
    "html": "text/html; charset=utf-8",
    "js": "application/javascript; charset=utf-8",
    "css": "text/css; charset=utf-8",
    "json": "application/json; charset=utf-8",
    "md": "text/markdown; charset=utf-8",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "svg": "image/svg+xml",
    "woff": "font/woff",
    "woff2": "font/woff2",
    "ttf": "font/ttf",
    "ico": "image/x-icon",
}


RUNNER: Runner = None  # type: ignore[assignment]


def ctype_for(path: Path) -> str:
    return CTYPES.get(path.suffix.lower().lstrip("."), "application/octet-stream")


def safe_under(root: Path, *parts: str) -> Optional[Path]:
    'Resolve `parts` under `root`, rejecting anything that escapes it.'
    for part in parts:
        if not part or not SAFE_ID.match(part) or part in (".", ".."):
            return None
    candidate = root.joinpath(*parts)
    try:
        resolved = candidate.resolve()
        resolved.relative_to(root.resolve())
    except (ValueError, OSError):
        return None
    return resolved


def _read_json(path: Path) -> Dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _merge_flag(query: Dict, *, cfg_default: bool = False) -> bool:

    raw = (query.get("merge_tables") or [""])[0].strip().lower()
    if raw:
        return raw not in ("0", "false", "no", "off")
    if not cfg_default:
        return False
    cfg = RUNNER.base_cfg()
    return bool((cfg.get("pipeline") or {}).get("merge_cross_page_tables", False))


def build_result(job_id: str, merge_tables: bool = False) -> Dict:
    'Merge the four artifact trees the pipeline writes into what the viewer needs per page: base image + boxes + markdown + upright record.'
    job_dir = JOBS_DIR / job_id
    inter = job_dir / "runtime" / "intermediate"
    layouts_dir = inter / "layouts"
    results_dir = job_dir / "results_json"
    upright_dir = inter / "upright"

    tasks_path = job_dir / "runtime" / "page_tasks.jsonl"
    ordered: List[str] = []
    if tasks_path.is_file():
        for line in tasks_path.read_text(encoding="utf-8").splitlines():
            try:
                image_id = json.loads(line).get("image_id")
            except Exception:
                continue
            if image_id and image_id not in ordered:
                ordered.append(image_id)
    if not ordered and layouts_dir.is_dir():
        ordered = sorted(p.stem for p in layouts_dir.glob("*.json"))

    pages = []
    for image_id in ordered:
        layout = _read_json(layouts_dir / f"{image_id}.json")
        result = _read_json(results_dir / f"{image_id}.json")
        if not layout and not result:
            continue

        by_crop = {
            b.get("crop_filename", ""): b for b in (result.get("crop_blocks") or [])
        }
        blocks = []
        for lb in layout.get("blocks", []):
            crop = lb.get("crop_filename", "")
            rb = by_crop.get(crop, {})
            blocks.append({
                "order": lb.get("order", 0),
                "label": lb.get("label", ""),
                "bbox": lb.get("bbox", [0, 0, 0, 0]),


                "regions": lb.get("regions") or [lb.get("bbox", [0, 0, 0, 0])],
                "score": lb.get("score", 0.0),
                "skip_vlm": bool(lb.get("skip_vlm", False)),
                "status": rb.get("status", ""),
                "content": rb.get("content", ""),
                "crop_url": (
                    f"/api/jobs/{job_id}/crop/{image_id}/{crop}" if crop else ""
                ),
            })
        upright = layout.get("upright") or _read_json(upright_dir / f"{image_id}.json")
        page_image = layout.get("page_image", "")
        source = layout.get("source") or {}
        page_index = source.get("page_index")
        is_pdf = str(source.get("type") or "") == "pdf" or page_index is not None
        pages.append({
            "image_id": image_id,
            "width": layout.get("image_width", 0),
            "height": layout.get("image_height", 0),
            "page_url": f"/api/jobs/{job_id}/page/{image_id}.png" if page_image else "",
            "markdown": result.get("markdown", ""),
            "upright": upright or None,
            "source": source,
            "blocks": blocks,

            "document": str(source.get("path") or "") if is_pdf else "",
            "page_index": int(page_index) if page_index is not None else -1,
        })

    merges = 0
    if merge_tables and pages:
        from minicpmvocr import apply_cross_page_merge, load_prompt_map

        changes = apply_cross_page_merge(pages, load_prompt_map(RUNNER.base_cfg()))
        merges = sum(1 for c in changes.values() if c["absorbed"])
        for page in pages:
            change = changes.get(page["image_id"])
            if not change:
                continue
            page["markdown"] = change["markdown"]
            page["merge"] = {"extended": change["extended"], "absorbed": change["absorbed"]}


            moved = {
                b.get("order")
                for b in change["blocks"]
                if b.get("merged_into_previous_page")
            }
            for block in page["blocks"]:
                if block["order"] in moved:
                    block["merged_into_previous_page"] = True

    meta = read_job(job_id) or {}
    return {"job": meta, "pages": pages, "merges": merges}


def merged_markdown(job_id: str, merge_tables: bool) -> str:
    'Whole-job markdown. `merge_tables` defaults to the deployment config.'
    from minicpmvocr import assemble_document_markdown, load_prompt_map

    cfg = RUNNER.base_cfg()
    markdown, _, _ = assemble_document_markdown(
        JOBS_DIR / job_id,
        load_prompt_map(cfg),
        merge_tables=bool(merge_tables),
        delimiter=PAGE_DELIMITER,
    )
    return markdown


def parse_multipart(body: bytes, boundary: bytes) -> Dict[str, List]:
    'Return {"fields": {name: text}, "files": [(filename, bytes)]}.'
    fields: Dict[str, str] = {}
    files: List = []
    sep = b"--" + boundary
    for part in body.split(sep):
        if not part or part in (b"--\r\n", b"--", b"\r\n"):
            continue
        head, _, data = part.partition(b"\r\n\r\n")
        if not _:
            continue
        data = data[:-2] if data.endswith(b"\r\n") else data
        disposition = ""
        for line in head.split(b"\r\n"):
            if line.lower().startswith(b"content-disposition:"):
                disposition = line.decode("utf-8", "replace")
                break
        if not disposition:
            continue
        name_m = re.search(r'name="([^"]*)"', disposition)
        file_m = re.search(r'filename="([^"]*)"', disposition)
        if file_m:
            filename = file_m.group(1)
            if filename:
                files.append((filename, data))
        elif name_m:
            fields[name_m.group(1)] = data.decode("utf-8", "replace")
    return {"fields": fields, "files": files}


def sanitize_filename(name: str) -> str:
    "Keep the stem recognizable (it becomes the page's image_id) but strip any path component and anything that would break a URL segment."
    name = os.path.basename(name.replace("\\", "/")).strip()
    stem, dot, suffix = name.rpartition(".")
    if not dot:
        stem, suffix = name, ""
    stem = re.sub(r"[^A-Za-z0-9_.\-]+", "_", stem).strip("._-") or "file"
    suffix = re.sub(r"[^A-Za-z0-9]+", "", suffix).lower()
    return f"{stem[:80]}.{suffix}" if suffix else stem[:80]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "minicpmvocr-webui"

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))


    def _send_bytes(self, code: int, data: bytes, ctype: str, extra: Dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _send_json(self, code: int, obj) -> None:
        self._send_bytes(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                         CTYPES["json"])

    def _send_file(self, path: Path, extra: Dict | None = None) -> None:
        if not path.is_file():
            self._send_json(404, {"error": "not found"})
            return
        self._send_bytes(200, path.read_bytes(), ctype_for(path), extra)


    def do_GET(self):  # noqa: N802
        raw_path, _, query = self.path.partition("?")
        path = unquote(raw_path)
        try:
            self._route_get(path, parse_qs(query))
        except Exception as exc:
            self.log_message("GET %s failed: %r", path, exc)
            self._send_json(500, {"error": str(exc)})

    do_HEAD = do_GET

    def _route_get(self, path: str, query: Dict[str, List[str]] | None = None) -> None:
        query = query or {}
        if path in ("/", "/index.html"):
            self._send_file(STATIC / "index.html")
            return
        if path.startswith("/vendor/"):
            target = (STATIC / path.lstrip("/")).resolve()
            try:
                target.relative_to((STATIC / "vendor").resolve())
            except ValueError:
                self._send_json(403, {"error": "forbidden"})
                return
            self._send_file(target)
            return
        if path == "/api/health":
            self._send_json(200, self._health())
            return
        if path == "/api/jobs":
            self._send_json(200, {"jobs": list_jobs(), "current": RUNNER.current_job_id})
            return

        parts = [p for p in path.split("/") if p]

        if len(parts) >= 3 and parts[0] == "api" and parts[1] == "jobs":
            job_id = parts[2]
            if not SAFE_ID.match(job_id) or not (JOBS_DIR / job_id).is_dir():
                self._send_json(404, {"error": "no such job"})
                return
            rest = parts[3:]
            if not rest:
                self._send_json(200, read_job(job_id) or {})
                return
            if rest == ["result"]:
                self._send_json(200, build_result(job_id, _merge_flag(query, cfg_default=True)))
                return
            if rest == ["markdown.md"]:
                name = (read_job(job_id) or {}).get("name", job_id)

                data = merged_markdown(job_id, _merge_flag(query)).encode("utf-8")
                self._send_bytes(200, data, CTYPES["md"], {
                    "Content-Disposition": 'attachment; filename="%s.md"' % re.sub(
                        r'[^A-Za-z0-9_.\-]+', "_", str(name))[:80],
                })
                return
            if len(rest) == 2 and rest[0] == "page":
                target = safe_under(JOBS_DIR / job_id / "runtime" / "intermediate" / "pages", rest[1])
                self._send_file(target) if target else self._send_json(400, {"error": "bad path"})
                return
            if len(rest) == 3 and rest[0] == "crop":
                target = safe_under(
                    JOBS_DIR / job_id / "runtime" / "intermediate" / "crops", rest[1], rest[2])
                self._send_file(target) if target else self._send_json(400, {"error": "bad path"})
                return
        self._send_json(404, {"error": "not found"})

    def _health(self) -> Dict:
        status = {"ok": True, "engine": {}, "models": RUNNER.resources_status()}
        try:
            cfg = RUNNER.base_cfg()
            urls = cfg["engine"].get("server_urls") or [cfg["engine"].get("server_url", "")]
            url = (urls[0] if urls else "").rstrip("/")
            status["engine"]["url"] = url
            status["engine"]["model_name"] = cfg["engine"].get("model_name", "")
            with OPENER.open(url + "/v1/models", timeout=5) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            served = [m.get("id") for m in body.get("data", []) if m.get("id")]
            status["engine"]["served"] = served
            status["engine"]["reachable"] = True
            status["engine"]["model_match"] = cfg["engine"].get("model_name", "") in served
        except Exception as exc:
            status["ok"] = False
            status["engine"]["reachable"] = False
            status["engine"]["error"] = f"{type(exc).__name__}: {exc}"
        return status


    def do_POST(self):  # noqa: N802
        path = unquote(self.path.partition("?")[0])
        if path != "/api/jobs":
            self._send_json(404, {"error": "not found"})
            return
        try:
            self._create_job()
        except Exception as exc:
            self.log_message("POST %s failed: %r", path, exc)
            self._send_json(500, {"error": str(exc)})

    def _create_job(self) -> None:
        ctype = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ctype or "boundary=" not in ctype:
            self._send_json(400, {"error": "expected multipart/form-data"})
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0:
            self._send_json(400, {"error": "empty body"})
            return
        if length > MAX_UPLOAD_BYTES:
            self._send_json(413, {"error": "上传超过 %d MB 上限" % (MAX_UPLOAD_BYTES // 1048576)})
            return
        boundary = ctype.split("boundary=", 1)[1].strip().strip('"').encode()
        parsed = parse_multipart(self.rfile.read(length), boundary)

        job_id = new_job_id()
        input_dir = JOBS_DIR / job_id / "input"
        input_dir.mkdir(parents=True, exist_ok=True)
        saved: List[str] = []
        for filename, data in parsed["files"]:
            safe = sanitize_filename(filename)
            if Path(safe).suffix.lower() not in SUPPORTED_SUFFIXES or not data:
                continue

            target = input_dir / safe
            seq = 2
            while target.exists():
                target = input_dir / f"{Path(safe).stem}_{seq}{Path(safe).suffix}"
                seq += 1
            target.write_bytes(data)
            saved.append(target.name)
        if not saved:
            shutil.rmtree(JOBS_DIR / job_id, ignore_errors=True)
            self._send_json(400, {"error": "没有可解析的文件（支持 pdf/png/jpg/jpeg/bmp/webp/tif）"})
            return

        fields = parsed["fields"]
        upright = str(fields.get("upright", "true")).lower() not in ("false", "0", "off", "")
        name = (fields.get("name") or "").strip() or (
            saved[0] if len(saved) == 1 else f"{saved[0]} 等 {len(saved)} 个文件")
        meta = RUNNER.submit(job_id, name, saved, upright)
        self._send_json(200, meta)

    def do_DELETE(self):  # noqa: N802
        path = unquote(self.path.partition("?")[0])
        parts = [p for p in path.split("/") if p]
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "jobs":
            job_id = parts[2]
            if not SAFE_ID.match(job_id):
                self._send_json(400, {"error": "bad id"})
                return
            if RUNNER.delete(job_id):
                self._send_json(200, {"deleted": job_id})
            else:
                self._send_json(409, {"error": "任务不存在或正在运行"})
            return
        self._send_json(404, {"error": "not found"})


def main() -> None:
    global RUNNER
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    RUNNER = Runner()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    print(f"[webui] serving on http://0.0.0.0:{PORT}  (config={runner_mod.CONFIG_PATH})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
