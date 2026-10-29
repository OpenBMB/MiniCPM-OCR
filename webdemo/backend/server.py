#!/usr/bin/env python3
"""MiniCPM-V-OCR parse backend. The only public entry.

Deployment and the API are in docs/webdemo_deploy_zh.md. Internal service, no auth.
FastAPI and uvicorn. The pipeline blocks, so it always runs in a thread pool and
the event loop only receives and sends. Rotation adaptation, layout, and crop
recognition each have their own queue. The layout pool size is
model_manager.LAYOUT_WORKERS. A detector is held only while this page is being cut.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import shutil
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional

BASE = Path(__file__).resolve().parent
if str(BASE.parent) not in __import__("sys").path:
    __import__("sys").path.insert(0, str(BASE.parent))

import model_manager as model_manager_mod  # noqa: E402
from model_manager import (  # noqa: E402
    DATA_DIR, DEFAULT_MODE, JOBS_DIR, TTS_RECIPES, Runner,
    new_job_id,
)
from recognition_client import OcrService, VLLM_URL, SERVED_MODEL  # noqa: E402
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response, StreamingResponse
from starlette.concurrency import run_in_threadpool
import urllib.error
import urllib.request

import uvicorn

PORT = int(os.environ.get("PORT", "8966"))
# source_token is the full-page job id (32 lowercase hex characters). It locates the original job directory.
SOURCE_TOKEN = re.compile(r"^[a-f\d]{32}$")

# Store the uploaded image as-is, without decoding and re-encoding. Only these formats are accepted (PIL format → suffix).
IMAGE_SUFFIX = {"PNG": ".png", "JPEG": ".jpg", "BMP": ".bmp", "WEBP": ".webp", "TIFF": ".tif"}

# -------------------------------------------------------------------
# Process-wide singletons, created in the lifespan.
# -------------------------------------------------------------------
RUNNER:  Runner     = None   # type: ignore[assignment]
OCR_SVC: OcrService = None   # type: ignore[assignment]

app = FastAPI(title="minicpmvocr-webdemo", version="1.0")


def _proxy_to_worker(request: Request):
    """The user process does not run models. Page parsing is forwarded to the local worker."""
    base = os.environ.get("OCR_LOCAL_WORKER_URL", "http://127.0.0.1:8966").rstrip("/")
    url = base + request.url.path
    if request.url.query:
        url += "?" + request.url.query
    headers = {}
    for name in ("content-type", "x-ocr-upright"):
        value = request.headers.get(name)
        if value:
            headers["Content-Type" if name == "content-type" else "X-OCR-Upright"] = value

    def _do(body: bytes):
        method = request.method.upper()
        data = body if method not in ("GET", "HEAD") else None
        outgoing = urllib.request.Request(url, data=data, headers=headers, method=method)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(outgoing, timeout=600) as resp:
                return resp.status, resp.headers.get("content-type", "application/json"), resp.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.headers.get("content-type", "application/json"), exc.read()
        except Exception as exc:
            payload = json.dumps({"error": f"本机工人不可用：{exc}"}, ensure_ascii=False).encode()
            return 502, "application/json", payload

    return _do


@app.middleware("http")
async def _gateway_split(request: Request, call_next):
    if os.environ.get("OCR_PAGE_ROLE") != "gateway":
        return await call_next(request)
    path = request.url.path
    if path == "/health":
        return await call_next(request)
    body = await request.body()
    status, content_type, payload = await run_in_threadpool(_proxy_to_worker(request), body)
    media = (content_type or "application/json").split(";")[0].strip()
    return Response(content=payload, status_code=status, media_type=media)


# ===================================================================
# Helpers. Same behavior as the previous version.
# ===================================================================

def _make_request_id() -> str:
    return hashlib.md5(os.urandom(16) + str(time.time()).encode()).hexdigest()


def _read_json(path: Path) -> Dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _mode_to_recipe(mode: str) -> str:
    return {"standard": "ocr", "scored": "score", "high-precision": "adaptive"}[mode]


def _rotation_record(raw: Optional[Dict], enabled: bool) -> Dict:
    out: Dict = {
        "enabled": bool(enabled), "applied": False,
        "predicted_angle": None, "predicted_score": None,
        "confirmed": None, "orientation_angle": 0,
        "deskew_angle": 0.0, "total_angle": 0.0,
        "skipped_reason": None,
    }
    if not raw:
        return out
    if raw.get("gated"):
        out["skipped_reason"] = "gated"
        return out
    vetoed = raw.get("label_vetoed")
    label = int(raw.get("label") or 0)
    out.update({
        "applied": bool(raw.get("applied")),
        "predicted_angle": int(vetoed) if vetoed is not None else label,
        "predicted_score": raw.get("score"),
        "confirmed": False if vetoed is not None else (
                       True if "vote" in raw else None),
        "orientation_angle": label,
        "deskew_angle": float(raw.get("deskew") or 0.0),
        "total_angle": float(raw.get("correction") or 0.0),
    })
    return out


def _best_score(block: Dict) -> Optional[float]:
    tts = block.get("tts") or {}
    if tts.get("best_score") is not None:
        return float(tts["best_score"])
    scores, idx = tts.get("scores") or [], tts.get("best_index")
    if isinstance(idx, int) and 0 <= idx < len(scores) and scores[idx] is not None:
        return float(scores[idx])
    return None


def _block_to_api(lb: Dict, rb: Dict) -> Dict:
    """A layout block plus a recognition block becomes one API block."""
    regions = lb.get("regions") or [lb.get("bbox", [0, 0, 0, 0])]
    tts = rb.get("tts") or {}
    score = _best_score(rb)
    block: Dict = {
        "order": lb.get("order", 0),
        "label": lb.get("label", ""),
        "bbox": lb.get("bbox", [0, 0, 0, 0]),
        "regions": regions,
        "content": rb.get("content", ""),
        "status": rb.get("status", ""),
    }
    if score is not None:
        block["score"] = score
    if tts.get("rounds_used") is not None:
        block["rounds_used"] = tts["rounds_used"]
        block["stop_reason"] = tts.get("stop_reason")
        block["exhausted"] = bool(tts.get("exhausted"))
    # Cross-page merge (see /api/image-parse/merge): a score only covers the half table from before the merge.
    if rb.get("tts_invalid"):
        block["tts_invalid"] = True
    if rb.get("merged_into_previous_page"):
        block["merged_into_previous_page"] = True
    return block


def _build_page_response(image_id, layout, result, request_id, mode,
                         upright_enabled, created_at, source_token,
                         page_index: int) -> Dict:
    by_crop = {b.get("crop_filename", ""): b
               for b in (result.get("crop_blocks") or [])}
    blocks = [_block_to_api(lb, by_crop.get(lb.get("crop_filename", ""), {}))
              for lb in layout.get("blocks", [])]

    upright_raw = layout.get("upright")
    rotation = _rotation_record(upright_raw, upright_enabled)

    mode_str = {"standard": "ocr_only", "scored": "stp",
                "high-precision": "tts"}.get(mode, mode)
    # Echo the request's page_index. The frontend uses it to check which page a response belongs to.
    # A single-image layout always leaves source.page_index empty, so that field cannot be used.

    resp: Dict = {
        "metadata": {"page_index": page_index},
        "choices": [{"message": {"content": result.get("markdown", "")}}],
        "minicpm_ocr": {
            "request_id": request_id,
            "mode": mode_str,
            "image_width": layout.get("image_width", 0),
            "image_height": layout.get("image_height", 0),
            "blocks": blocks,
        },
    }
    # Omit rotation when rotation adaptation is off. The frontend treats a missing field as not adapted.
    if upright_enabled:
        resp["minicpm_ocr"]["rotation"] = rotation

    if mode in ("scored", "high-precision"):
        total = len(blocks)
        scored = sum(1 for b in blocks if b.get("score") is not None)
        if total:
            resp["minicpm_ocr"]["passthrough"] = {
                "passed": scored, "total": total,
                "rate": round(scored / total, 4),
            }

    if mode in ("scored", "high-precision"):
        resp["map_ocr_source"] = {
            "request_id": request_id,
            "model": {"scored": "minicpm-ocr-stp",
                      "high-precision": "minicpm-ocr-tts"}[mode],
            "page_index": page_index,
            "created_at": created_at,
            "expires_at": created_at + 86400,
            "token": source_token,
        }
    return resp


JOB_META = "webdemo_meta.json"

# A single-block rerun rewrites results_json in place, so reruns of one job run one at a time.
_JOB_LOCKS: Dict[str, threading.Lock] = {}
_JOB_LOCKS_GUARD = threading.Lock()


def _job_lock(job_id: str) -> threading.Lock:
    with _JOB_LOCKS_GUARD:
        return _JOB_LOCKS.setdefault(job_id, threading.Lock())


def _decode_upload(image_b64: str):
    """base64 → (raw bytes, suffix). The format comes from the file header, without decoding the whole image."""
    from PIL import Image
    _, _, b64data = image_b64.partition(",")
    raw = base64.b64decode(b64data or image_b64)
    with Image.open(io.BytesIO(raw)) as img:
        fmt = img.format
    if fmt not in IMAGE_SUFFIX:
        raise ValueError(f"不支持的图片格式：{fmt}")
    return raw, IMAGE_SUFFIX[fmt]


def _err(code: int, msg: str) -> JSONResponse:
    return JSONResponse(status_code=code, content={"error": msg})


# ===================================================================
# Routes
# ===================================================================

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/ready")
def ready():
    vllm = OCR_SVC.health()
    res = RUNNER.resources_status()
    is_ready = vllm["reachable"] and vllm["model_match"]
    body = {
        "status": "ready" if is_ready else "not_ready",
        "vllm": vllm,
        "upright": {"loaded": bool(res.get("upright"))},
        "layout": {"workers": res["layout_workers"], "idle": res["layout_idle"]},
    }
    return JSONResponse(status_code=200 if is_ready else 503, content=body)


@app.get("/api/image-parse/capabilities")
def capabilities():
    modes = ["standard"]
    res = RUNNER.resources_status()
    return {
        "enabled": True,
        "modes": modes,
        "upright": bool(res.get("upright")),
        "seal": True,
        "kie": True,
    }


@app.get("/metrics")
def metrics():
    """Forward the OCR vLLM Prometheus metrics. LIS scrapes them every 15s, and a missing endpoint is a 404."""
    import urllib.request
    try:
        with urllib.request.urlopen(VLLM_URL + "/metrics", timeout=5) as r:
            return Response(content=r.read(), media_type=r.headers.get("content-type", "text/plain"))
    except Exception as exc:
        return PlainTextResponse(f"# upstream OCR metrics unavailable: {exc}\n", status_code=503)


# ===================================================================
# LIS entry: OpenAI Chat Completions shape.
# ===================================================================
# The LIS gateway routes by `model` equal to the service name (--served-model-name)
# to /v1/chat/completions, so a call through LIS cannot put the tier in `model`.
# Read it from `minicpm_ocr.mode` instead. The four tier names still work as `model`.
# Business fields can sit inside `minicpm_ocr`, or at the top level the same way as
# /api/image-parse (image / page_index / order / source_token / pages).
LIS_SERVED_MODEL_NAME = os.environ.get("LIS_SERVED_MODEL_NAME", "").strip()
PAGE_MODELS = ("minicpm-ocr", "minicpm-ocr-stp", "minicpm-ocr-tts")
BLOCK_MODEL = "minicpm-ocr-tts-block"
LIS_MODES = {
    "ocr_only": "minicpm-ocr", "standard": "minicpm-ocr",
    "stp": "minicpm-ocr-stp", "scored": "minicpm-ocr-stp",
    "tts": "minicpm-ocr-tts", "high-precision": "minicpm-ocr-tts",
    "tts_block": BLOCK_MODEL, "block": BLOCK_MODEL,
    "merge": "merge",
}
LIS_USAGE_TEXT = (
    "本服务是页图解析（版面 + 摆正 + OCR + 质量打分），输入是一张页图。用法：messages 里放一个 "
    '{"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}；'
    "档位用 minicpm_ocr.mode 选：ocr_only（默认，只识别）/ stp（每块一个质量分）/ tts（自适应选优）；"
    "单块重算 mode=tts_block + source_token + order + page_index；跨页表格合并 mode=merge + pages。"
)


def _image_from_messages(messages) -> str:
    for message in messages or []:
        content = message.get("content") if isinstance(message, dict) else None
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    url = part.get("image_url")
                    url = url.get("url", "") if isinstance(url, dict) else url
                    if url:
                        return url
    return ""


def _chat_envelope(content: Dict, model: str) -> Dict:
    """Add the OpenAI chat.completion fields around the business response. Business fields stay as they are."""
    choices = content.get("choices") or [{"message": {"content": ""}}]
    for i, choice in enumerate(choices):
        choice.setdefault("index", i)
        choice.setdefault("finish_reason", "stop")
        choice.setdefault("message", {}).setdefault("role", "assistant")
    return {"id": f"chatcmpl-{_make_request_id()}", "object": "chat.completion",
            "created": int(time.time()), "model": model, **content, "choices": choices,
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}}


def _chat_response(resp: JSONResponse, model: str, stream: bool):
    if resp.status_code != 200:
        return resp
    body = _chat_envelope(json.loads(resp.body), model)
    if not stream:
        return JSONResponse(content=body)
    # Streaming sends the whole result as one chunk. Recognition finishes a page in one pass.
    chunk = dict(body, object="chat.completion.chunk",
                 choices=[{"index": 0, "finish_reason": "stop",
                           "delta": {"role": "assistant",
                                     "content": body["choices"][0]["message"].get("content", "")}}])
    chunk.pop("usage", None)
    payload = f"data: {json.dumps(chunk, ensure_ascii=False)}\n\ndata: [DONE]\n\n"
    return StreamingResponse(iter([payload]), media_type="text/event-stream")


@app.get("/v1/models")
def list_models():
    names = ([LIS_SERVED_MODEL_NAME] if LIS_SERVED_MODEL_NAME else []) + [
        m for m in (*PAGE_MODELS, BLOCK_MODEL) if m != LIS_SERVED_MODEL_NAME]
    created = int(time.time())
    return {"object": "list", "data": [
        {"id": n, "object": "model", "created": created, "owned_by": "minicpmv-ocr"} for n in names]}


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    params = dict(body.get("minicpm_ocr") or {})
    model = str(body.get("model", ""))
    stream = bool(body.get("stream"))

    if model == "minicpm-ocr-1.0":
        model = "minicpm-ocr"
    if model in PAGE_MODELS or model == BLOCK_MODEL:
        target = model
    else:
        mode = str(params.get("mode") or body.get("mode") or "ocr_only").strip()
        target = LIS_MODES.get(mode)
        if target is None:
            return _err(400, f"未知 minicpm_ocr.mode: {mode!r}，可选 {' / '.join(LIS_MODES)}")

    # A top-level field loses to the same field inside minicpm_ocr.
    merged = {k: body[k] for k in ("image", "page_index", "order", "source_token", "pages") if k in body}
    merged.update({k: v for k, v in params.items() if k != "mode"})
    if "source_token" not in merged and merged.get("request_id"):
        merged["source_token"] = merged["request_id"]

    if target == "merge":
        return _chat_response(await run_in_threadpool(_handle_merge, merged), model, stream)
    if target == BLOCK_MODEL:
        return _chat_response(await run_in_threadpool(_handle_rerun_block, merged), model, stream)

    merged["image"] = merged.get("image") or _image_from_messages(body.get("messages"))
    if not merged["image"]:
        # LIS's Chat Completions self-test sends plain text. A 4xx response fails that check.
        return _chat_response(JSONResponse(content={"choices": [{"message": {"content": LIS_USAGE_TEXT}}]}),
                              model, stream)
    return _chat_response(await run_in_threadpool(_handle_full_page, merged, target), model, stream)


@app.post("/api/image-parse/merge")
async def image_parse_merge(request: Request):
    body = await request.json()
    return await run_in_threadpool(_handle_merge, body)


@app.post("/api/page-parse")
async def page_parse(request: Request):
    """Return a ticket once rotation adaptation and layout finish. Crops keep decoding on this machine's queue."""
    raw = await request.body()
    if not raw:
        return _err(400, "缺少页面图片")
    header = request.headers.get("x-ocr-upright")
    if header is None:
        upright = None
    elif header == "0":
        upright = False
    elif header == "1":
        upright = True
    else:
        return _err(400, "X-OCR-Upright 只能是 0 或 1")
    try:
        import page_fleet
        handle = await run_in_threadpool(page_fleet.launch_local_page, RUNNER, raw, upright)
        ready = await run_in_threadpool(handle.layout_done.wait, 180)
    except Exception as exc:
        return _err(500, f"识别失败：{exc}")
    if not ready:
        return _err(504, "版面超时")
    if handle.error is not None and not handle.laid_out:
        return _err(500, f"识别失败：{handle.error}")
    return {"ticket": page_fleet.remember(handle)}


@app.get("/api/page-markdown/{ticket}")
def page_markdown(ticket: str):
    """ready is false while the page for this ticket is still decoding."""
    import page_fleet
    try:
        page = page_fleet.take_markdown(ticket)
    except KeyError:
        return _err(404, "没有这一页")
    except Exception as exc:
        return _err(500, f"识别失败：{exc}")
    if page is None:
        return {"ready": False}
    return {"ready": True, **page}


@app.post("/api/kie")
async def kie(request: Request):
    body = await request.json()
    return await run_in_threadpool(_handle_kie, body)


@app.post("/api/image-parse")
async def image_parse(request: Request):
    body = await request.json()
    model = body.get("model", "")

    if model == "minicpm-ocr-tts-block":
        return await run_in_threadpool(_handle_rerun_block, body)
    elif model == "minicpm-ocr-seal":
        return await run_in_threadpool(_handle_seal, body)
    elif model == "minicpm-ocr-kie":
        return await run_in_threadpool(_handle_kie, body)
    elif model in ("minicpm-ocr", "minicpm-ocr-stp", "minicpm-ocr-tts"):
        return await run_in_threadpool(_handle_full_page, body, model)
    else:
        return _err(400, f"未知 model: {model!r}，"
                    "可选 minicpm-ocr / minicpm-ocr-stp / "
                    "minicpm-ocr-tts / minicpm-ocr-tts-block / minicpm-ocr-seal / "
                    "minicpm-ocr-kie")


def _handle_full_page(body: Dict, model: str) -> JSONResponse:
    mode_map = {
        "minicpm-ocr": "standard",
        "minicpm-ocr-stp": "scored",
        "minicpm-ocr-tts": "high-precision",
    }
    mode = mode_map[model]

    if mode in ("scored", "high-precision"):
        return _err(400, "这个演示只做识别")

    image_b64 = body.get("image", "")
    if not image_b64:
        return _err(400, "缺少 image 字段")
    page_index = int(body.get("page_index", 0) or 0)
    try:
        import page_fleet
        upright_choice = page_fleet.coerce_upright(body.get("upright")) if "upright" in body else None
    except ValueError as exc:
        return _err(400, str(exc))

    job_id = new_job_id()
    job_dir = JOBS_DIR / job_id
    input_dir = job_dir / "input"
    input_dir.mkdir(parents=True, exist_ok=True)

    try:
        raw_bytes, suffix = _decode_upload(image_b64)
        img_stem = f"page_{page_index:04d}"
        img_path = input_dir / f"{img_stem}{suffix}"
        img_path.write_bytes(raw_bytes)
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        return _err(400, f"图片解码失败：{exc}")

    try:
        upright_on = page_fleet.resolve_upright(upright_choice)
        # The two scored tiers must support a single-block rerun, and a rerun reads the crop from disk, so those crops are saved.
        cfg = RUNNER.build_cfg(job_id, upright=upright_on,
                               mode=_mode_to_recipe(mode),
                               save_crops=mode != "standard")
        page_fleet.run_releasing_layout(RUNNER, cfg)
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        return _err(500, f"识别失败：{exc}")

    inter = job_dir / "runtime" / "intermediate"
    layout = _read_json(inter / "layouts" / f"{img_stem}.json")
    result = _read_json(job_dir / "results_json" / f"{img_stem}.json")

    # request_id is the job id. A single-block rerun and a cross-page merge find this result with it.
    request_id = job_id
    created_at = int(time.time())
    source_token = request_id

    upright_enabled = bool(cfg.get("upright", {}).get("enabled", True))
    # A cross-page merge rebuilds this page's response from the saved fields.
    (job_dir / JOB_META).write_text(json.dumps({
        "mode": mode, "page_index": page_index, "created_at": created_at,
        "upright_enabled": upright_enabled, "image_id": img_stem,
    }), encoding="utf-8")
    resp = _build_page_response(
        image_id=img_stem, layout=layout, result=result,
        request_id=request_id, mode=mode,
        upright_enabled=upright_enabled,
        created_at=created_at, source_token=source_token,
        page_index=page_index,
    )
    return JSONResponse(content=resp)


def _handle_seal(body: Dict) -> JSONResponse:
    """Treat the whole image as a seal and send it straight to the recognition model. No rotation adaptation, no layout, and no job on disk."""
    image_b64 = body.get("image", "")
    if not image_b64:
        return _err(400, "缺少 image 字段")
    try:
        raw_bytes, _suffix = _decode_upload(image_b64)
        from PIL import Image
        with Image.open(io.BytesIO(raw_bytes)) as opened:
            image = opened.convert("RGB").copy()
        width, height = image.size
        if width <= 0 or height <= 0:
            raise ValueError("空图")
    except Exception as exc:
        return _err(400, f"图片解码失败：{exc}")

    try:
        from minicpmvocr.postprocess.markdown import postprocess_content
        from minicpmvocr.prompts import DEFAULT_PROMPT_MAP, get_element_cfg
        elem = get_element_cfg(DEFAULT_PROMPT_MAP, "seal")
        if not elem:
            raise RuntimeError("印章 prompt 未配置")
        recognized = OCR_SVC.recognize(
            image,
            prompt=elem["prompt"],
            max_new_tokens=int(elem["max_new_tokens"]),
            slice_nums=elem.get("slice_nums"),
        )
        text = postprocess_content(recognized.get("text") or "", elem["output_format"], label="seal")
    except Exception as exc:
        return _err(500, f"识别失败：{exc}")

    return JSONResponse(content={
        "choices": [{"message": {"content": text}}],
        "minicpm_ocr": {
            "mode": "seal",
            "image_width": width,
            "image_height": height,
            "blocks": [{
                "order": 0,
                "label": "seal",
                "bbox": [0, 0, width, height],
                "regions": [[0, 0, width, height]],
                "content": text,
                "status": "ok",
            }],
        },
    })


KIE_MAX_FIELDS = 20
KIE_MAX_NEW_TOKENS = 1024
_KIE_FENCE = re.compile(r"^```(?:json)?\s*([\s\S]*?)\s*```$", re.IGNORECASE)


def kie_prompt(fields: List[str]) -> str:
    """Build the prompt with the English extract-fields sentence used in training. Field names go inside quotes unchanged."""
    quoted = ", ".join(f'"{name}"' for name in fields)
    return (
        f'Extract the {quoted}. Format the output as a JSON object with keys: {quoted}. '
        'If an item is not in the image, use "###".'
    )


def normalize_kie_fields(value) -> List[str]:
    """Check field names. Empty strings, quotes, newlines, duplicates, and lists that are too long are rejected."""
    if not isinstance(value, list) or not value:
        raise ValueError("缺少 fields")
    if len(value) > KIE_MAX_FIELDS:
        raise ValueError(f"fields 最多 {KIE_MAX_FIELDS} 个")
    names: List[str] = []
    seen = set()
    for item in value:
        if not isinstance(item, str):
            raise ValueError("fields 必须是字符串")
        name = item.strip()
        if not name or any(mark in name for mark in ('"', "'", "\n", "\r")):
            raise ValueError(f"字段名非法：{item!r}")
        if name in seen:
            raise ValueError(f"字段名重复：{name}")
        seen.add(name)
        names.append(name)
    return names


def strip_kie_fence(text: str) -> str:
    """Strip surrounding whitespace and a json fence around the whole text. Field contents stay unchanged."""
    stripped = (text or "").strip()
    fenced = _KIE_FENCE.match(stripped)
    return fenced.group(1).strip() if fenced else stripped


def _handle_kie(body: Dict) -> JSONResponse:
    """Extract fields from the whole image. No rotation adaptation, no layout, and no job on disk."""
    image_b64 = body.get("image", "")
    if not image_b64:
        return _err(400, "缺少 image 字段")
    try:
        fields = normalize_kie_fields(body.get("fields"))
    except ValueError as exc:
        return _err(400, str(exc))
    try:
        raw_bytes, _suffix = _decode_upload(image_b64)
        from PIL import Image
        with Image.open(io.BytesIO(raw_bytes)) as opened:
            image = opened.convert("RGB").copy()
        width, height = image.size
        if width <= 0 or height <= 0:
            raise ValueError("空图")
    except Exception as exc:
        return _err(400, f"图片解码失败：{exc}")

    prompt = kie_prompt(fields)
    try:
        recognized = OCR_SVC.recognize(
            image,
            prompt=prompt,
            max_new_tokens=KIE_MAX_NEW_TOKENS,
            slice_nums=9,
        )
        text = strip_kie_fence(recognized.get("text") or "")
    except Exception as exc:
        return _err(500, f"识别失败：{exc}")

    return JSONResponse(content={
        "choices": [{"message": {"content": text}}],
        "minicpm_ocr": {
            "mode": "kie",
            "prompt": prompt,
            "fields": fields,
            "image_width": width,
            "image_height": height,
            "blocks": [{
                "order": 0,
                "label": "kie",
                "bbox": [0, 0, width, height],
                "regions": [[0, 0, width, height]],
                "content": text,
                "status": "ok",
            }],
        },
    })


def _handle_merge(body: Dict) -> JSONResponse:
    """Cross-page table merge. Call it once after every page of a PDF has been recognized.

    Read only. Each page's result stays as it was, so a single-block rerun still uses the original page. The merge exists only in the response.
    A gap in page numbers, such as a failed page in the middle, breaks the run. Nothing merges across that gap. Only changed pages are returned.
    """
    from minicpmvocr import load_prompt_map
    from minicpmvocr.postprocess.crosspage import apply_cross_page_merge

    items = body.get("pages")
    if not isinstance(items, list) or not items:
        return _err(400, "pages 不能为空")

    pages: List[Dict] = []
    ctx: Dict[str, Dict] = {}
    for item in items:
        rid = str((item or {}).get("request_id", ""))
        if not SOURCE_TOKEN.match(rid):
            return _err(400, f"request_id 非法：{rid!r}")
        job_dir = JOBS_DIR / rid
        meta = _read_json(job_dir / JOB_META)
        if not meta:
            return _err(404, f"识别结果已过期：{rid}")
        image_id = meta["image_id"]
        result = _read_json(job_dir / "results_json" / f"{image_id}.json")
        layout = _read_json(job_dir / "runtime" / "intermediate" / "layouts" / f"{image_id}.json")
        if not result or not layout:
            return _err(404, f"识别结果已过期：{rid}")
        # image_id is page_xxxx inside every job. Key by request_id so they do not collide.
        pages.append({"image_id": rid, "page_index": int(meta["page_index"]),
                      "markdown": result.get("markdown", ""),
                      "blocks": result.get("crop_blocks") or []})
        ctx[rid] = {"meta": meta, "result": result, "layout": layout}

    # A run of consecutive page numbers is one document. A gap starts a new run.
    pages.sort(key=lambda p: p["page_index"])
    run = 0
    for i, page in enumerate(pages):
        if i and page["page_index"] != pages[i - 1]["page_index"] + 1:
            run += 1
        page["document"] = run

    cfg = RUNNER.build_cfg(pages[0]["image_id"], upright=False)
    changes = apply_cross_page_merge(pages, load_prompt_map(cfg))

    out = []
    for page in pages:
        rid = page["image_id"]
        change = changes.get(rid)
        if not change:
            continue
        old = {b.get("crop_filename"): b.get("content") for b in page["blocks"]}
        blocks, absorbed, extended = [], False, False
        for b in change["blocks"]:
            b = dict(b)
            if b.get("merged_into_previous_page"):
                absorbed = True
                b["tts_invalid"] = True
            elif b.get("label") == "table" and b.get("content") != old.get(b.get("crop_filename")):
                extended = True
                b["tts_invalid"] = True
            blocks.append(b)
        c = ctx[rid]
        merged_result = dict(c["result"], crop_blocks=blocks, markdown=change["markdown"])
        meta = c["meta"]
        resp = _build_page_response(
            image_id=meta["image_id"], layout=c["layout"], result=merged_result,
            request_id=rid, mode=meta["mode"],
            upright_enabled=bool(meta.get("upright_enabled")),
            created_at=int(meta["created_at"]), source_token=rid,
            page_index=page["page_index"],
        )
        # absorbed: the continued table at the top of the page was merged into the previous page. extended: the table at the bottom continues onto the next page. Both can be true.
        resp["minicpm_ocr"]["cross_page"] = {"absorbed": absorbed, "extended": extended}
        out.append(resp)
    return JSONResponse(content={"merged_pages": len(out), "pages": out})


def _handle_rerun_block(body: Dict) -> JSONResponse:
    del body
    return _err(400, "这个演示不包含单块重算")


# ===================================================================
# Entry
# ===================================================================

from document_jobs import router as document_job_router  # noqa: E402

app.include_router(document_job_router)


@app.on_event("startup")
async def _startup():
    global RUNNER, OCR_SVC
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    RUNNER = Runner()
    if os.environ.get("OCR_PAGE_ROLE") == "worker":
        import page_fleet
        threading.Thread(target=page_fleet.advertise, args=(PORT,), name="page-advertise", daemon=True).start()
    OCR_SVC = OcrService(vllm_url=VLLM_URL, model_name=SERVED_MODEL)
    print(
        f"[webdemo] serving on http://0.0.0.0:{PORT}"
        f"  vllm={VLLM_URL}  model={SERVED_MODEL}",
        flush=True,
    )


if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=PORT,
        workers=1,
        log_level="info",
    )
