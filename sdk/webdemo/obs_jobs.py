from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Dict, Optional, Tuple

from model_manager import DATA_DIR, JOBS_DIR, new_job_id

OBSUTIL = os.environ.get(
    "OBSUTIL",
    "obsutil",
)
OBS_ENDPOINT = os.environ.get(
    "OBS_ENDPOINT",
    "",
)
DEFAULT_BUCKET = os.environ.get("OBS_BUCKET", "")
OBS_ROOT = DATA_DIR / "obs_jobs"
MAX_PAGES = 500
ALLOWED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff"}
_JOB_ID = re.compile(r"^[a-f\d]{32}$")
_THREADS: Dict[str, threading.Thread] = {}
_GUARD = threading.Lock()


def parse_object_ref(body: Dict) -> Tuple[str, str]:
    '把请求里的桶内对象收成 (bucket, key)。'
    raw = str(body.get("id") or body.get("object") or "").strip()
    bucket = str(body.get("bucket") or "").strip()
    if raw.startswith("obs://"):
        rest = raw[len("obs://"):]
        parsed_bucket, _, key = rest.partition("/")
        bucket = parsed_bucket or bucket
    else:
        key = raw
        if not bucket:
            bucket = DEFAULT_BUCKET
        prefix = bucket + "/"
        if key.startswith(prefix):
            key = key[len(prefix):]
    if not bucket or not key or key.startswith("/") or any(part == ".." for part in key.split("/")):
        raise ValueError("id 需要是华为云对象名，或 obs://桶名/对象名")
    suffix = Path(key).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise ValueError("只接受 PDF 或图片（png/jpg/webp/bmp/tif）")
    return bucket, key


def submit(body: Dict, runner) -> Dict:
    bucket, key = parse_object_ref(body)
    model = str(body.get("model") or "minicpm-ocr")
    if model not in ("minicpm-ocr", "minicpm-ocr-stp", "minicpm-ocr-tts"):
        raise ValueError("model 只能是 minicpm-ocr / minicpm-ocr-stp / minicpm-ocr-tts")
    import page_fleet
    if "upright" in body:
        upright = page_fleet.coerce_upright(body.get("upright"))
    else:
        upright = None
    job_id = new_job_id()
    record = {
        "id": job_id,
        "status": "Running",
        "phase": "download",
        "bucket": bucket,
        "object": key,
        "model": model,
        "pages_done": 0,
        "pages_total": None,
        "error": "",
    }
    if upright is not None:
        record["upright"] = upright
    if os.environ.get("OCR_PAGE_ROLE") == "gateway":
        record["phase"] = "queued"
        _write_state(job_id, record)
        return {"id": job_id, "status": "Running"}
    _write_state(job_id, record)
    thread = threading.Thread(
        target=_run,
        args=(job_id, bucket, key, model, runner),
        name=f"obs-parse-{job_id[:8]}",
        daemon=True,
    )
    with _GUARD:
        _THREADS[job_id] = thread
    thread.start()
    return {"id": job_id, "status": "Running"}


def lookup(job_id: str) -> Optional[Dict]:
    if not _JOB_ID.match(job_id):
        return None
    state = _read_state(job_id)
    if state is None:
        return None
    if state.get("status") == "Success":
        result = _read_json(_result_path(job_id))
        if result:
            return result
    if state.get("status") == "Running" and state.get("phase") == "parse":
        state["pages_done"] = _pages_done(job_id)
    public = {
        "id": state.get("id", job_id),
        "status": state.get("status", "Running"),
        "pages_done": state.get("pages_done", 0),
        "pages_total": state.get("pages_total"),
    }
    if state.get("status") == "Failed":
        public["error"] = state.get("error") or "识别失败"
    return public


def recover_interrupted() -> None:
    '进程重启后，原先还在跑的任务不会自己继续，标成 Failed。'
    if not OBS_ROOT.is_dir():
        return
    for path in OBS_ROOT.glob("*/state.json"):
        state = _read_json(path)
        if state.get("status") != "Running":
            continue
        state["status"] = "Failed"
        state["error"] = "服务重启，解析已中断"
        _write_json(path, state)


def dispatch_queued(runner) -> None:
    '分发进程领走用户进程写下的排队任务。领走之后才下载、拆页。'
    if not OBS_ROOT.is_dir():
        return
    for path in list(OBS_ROOT.glob("*/state.json")):
        state = _read_json(path)
        if state.get("status") != "Running" or state.get("phase") != "queued":
            continue
        job_id = str(state.get("id") or path.parent.name)
        if not _claim(job_id):
            continue
        thread = threading.Thread(
            target=_run,
            args=(job_id, state.get("bucket") or "", state.get("object") or "", state.get("model") or "minicpm-ocr", runner),
            name=f"obs-parse-{job_id[:8]}",
            daemon=True,
        )
        with _GUARD:
            _THREADS[job_id] = thread
        thread.start()


def _claim(job_id: str) -> bool:
    flag = OBS_ROOT / job_id / "dispatcher.claim"
    try:
        fd = os.open(flag, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    except FileExistsError:
        return False
    os.close(fd)
    _update(job_id, phase="download")
    return True


def _run(job_id: str, bucket: str, key: str, model: str, runner) -> None:
    try:
        local = _download(job_id, bucket, key)
        pages_total = _count_pages(local)
        if pages_total > MAX_PAGES:
            raise RuntimeError(f"文件有 {pages_total} 页，超过 {MAX_PAGES} 页")
        _update(job_id, phase="parse", pages_total=pages_total, pages_done=0)
        _parse(job_id, local, model, runner)
        result = _assemble(job_id, bucket, key, pages_total)
        _write_json(_result_path(job_id), result)
        _update(job_id, status="Success", phase="done", pages_done=pages_total, pages_total=pages_total)
    except Exception as exc:
        _update(job_id, status="Failed", phase="done", error=_public_error(exc))


def _download(job_id: str, bucket: str, key: str) -> str:
    if not OBS_ENDPOINT:
        raise RuntimeError("Set OBS_ENDPOINT before downloading OBS objects")
    dest_dir = JOBS_DIR / job_id / "input"
    dest_dir.mkdir(parents=True, exist_ok=True)
    local = dest_dir / Path(key).name
    ak, sk = _credentials()
    env = os.environ.copy()
    for name in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
        env.pop(name, None)
    env["no_proxy"] = "*"
    env["NO_PROXY"] = "*"
    proc = subprocess.run(
        [
            OBSUTIL, "cp", f"obs://{bucket}/{key}", str(local),
            f"-e={OBS_ENDPOINT}", f"-i={ak}", f"-k={sk}",
        ],
        capture_output=True,
        text=True,
        env=env,
    )
    if proc.returncode != 0 or not local.is_file():
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        message = detail[-1] if detail else "下载失败"
        raise RuntimeError(f"从华为云拉取失败：{message}")
    return str(local)


def _public_error(exc: BaseException) -> str:
    text = str(exc) or exc.__class__.__name__
    ak, sk = "", ""
    try:
        ak, sk = _credentials()
    except Exception:
        return text
    if ak:
        text = text.replace(ak, "")
    if sk:
        text = text.replace(sk, "")
    return text


def _credentials() -> Tuple[str, str]:
    ak = os.environ.get("OBS_AK", "")
    sk = os.environ.get("OBS_SK", "")
    if ak and sk:
        return ak, sk
    raise RuntimeError("Set OBS_AK and OBS_SK before downloading OBS objects")


def _count_pages(local: str) -> int:
    path = Path(local)
    if path.suffix.lower() != ".pdf":
        return 1
    import fitz
    doc = fitz.open(path)
    try:
        return int(doc.page_count)
    finally:
        doc.close()


def _job_upright(job_id: str):

    state = _read_state(job_id) or {}
    return state.get("upright") if "upright" in state else None


def _parse(job_id: str, local: str, model: str, runner) -> None:
    import page_fleet
    role = os.environ.get("OCR_PAGE_ROLE")
    if model == "minicpm-ocr" and (role == "dispatcher" or page_fleet.fleet_enabled()):
        if role == "dispatcher":
            deadline = time.time() + 90
            while not page_fleet.fleet_enabled():
                if time.time() >= deadline:
                    raise RuntimeError("没有可用的解析机器")
                time.sleep(0.5)
        page_fleet.dispatch_file(job_id, local, runner, _job_upright(job_id))
        return
    mode = {"minicpm-ocr": "ocr", "minicpm-ocr-stp": "score", "minicpm-ocr-tts": "adaptive"}[model]
    upright_on = page_fleet.resolve_upright(_job_upright(job_id))
    cfg = runner.build_cfg(job_id, upright=upright_on, mode=mode, save_crops=mode != "ocr")
    cfg["input"]["file_path"] = local
    cfg["input"]["files_dir"] = ""
    cfg["input"]["image_dir"] = ""
    cfg["input"]["manifest"] = ""
    page_fleet.run_releasing_layout(runner, cfg)


def _assemble(job_id: str, bucket: str, key: str, pages_total: int) -> Dict:
    result_dir = JOBS_DIR / job_id / "results_json"
    files = sorted(result_dir.glob("*.json"), key=_page_sort)
    pages = []
    for index, path in enumerate(files):
        row = _read_json(path)
        pages.append({
            "page_index": index,
            "image_id": row.get("image_id") or path.stem,
            "markdown": row.get("markdown") or "",
            "image_width": row.get("image_width") or 0,
            "image_height": row.get("image_height") or 0,
            "source_width": row.get("source_width") or 0,
            "source_height": row.get("source_height") or 0,
            "rotation": row.get("rotation"),
            "blocks": row.get("blocks") or [],
        })
    return {
        "id": job_id,
        "status": "Success",
        "bucket": bucket,
        "object": key,
        "pages_total": pages_total,
        "pages_done": len(pages),
        "markdown": "\n\n".join(page["markdown"] for page in pages if page["markdown"]),
        "pages": pages,
    }


def _page_sort(path: Path) -> Tuple[int, str]:
    match = re.search(r"_page_(\d+)$", path.stem)
    if match:
        return int(match.group(1)), path.name
    return 10**9, path.name


def _pages_done(job_id: str) -> int:
    result_dir = JOBS_DIR / job_id / "results_json"
    if not result_dir.is_dir():
        return 0
    return sum(1 for _ in result_dir.glob("*.json"))


def _state_path(job_id: str) -> Path:
    return OBS_ROOT / job_id / "state.json"


def _result_path(job_id: str) -> Path:
    return OBS_ROOT / job_id / "result.json"


def _write_state(job_id: str, state: Dict) -> None:
    _write_json(_state_path(job_id), state)


def _update(job_id: str, **fields) -> None:
    state = _read_state(job_id) or {"id": job_id}
    state.update(fields)
    _write_state(job_id, state)


def _read_state(job_id: str) -> Optional[Dict]:
    return _read_json(_state_path(job_id)) or None


def _read_json(path: Path) -> Dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_json(path: Path, payload: Dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)
