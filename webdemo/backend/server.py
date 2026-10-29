#!/usr/bin/env python3
"""MiniCPM-V-OCR 解析后端 — 对外唯一入口。

工作台接口见同目录 SERVICE.md。纯内部服务，无鉴权。
用 FastAPI + uvicorn。pipeline 是阻塞的，一律丢进线程池跑，事件循环只做收发；
摆正、版面、分块识别各走各的队列。版面池的大小是 model_manager.LAYOUT_WORKERS，检测器只在切这一页时占着。
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
# source_token 就是整页请求的 job id（32 位小写 hex），据此定位原 job 目录
SOURCE_TOKEN = re.compile(r"^[a-f\d]{32}$")

# 上传图原样落盘，不解码重编码；只认这些格式（PIL format → 后缀）
IMAGE_SUFFIX = {"PNG": ".png", "JPEG": ".jpg", "BMP": ".bmp", "WEBP": ".webp", "TIFF": ".tif"}

# -------------------------------------------------------------------
# 全局单例 — 在 lifespan 里初始化
# -------------------------------------------------------------------
RUNNER:  Runner     = None   # type: ignore[assignment]
OCR_SVC: OcrService = None   # type: ignore[assignment]

app = FastAPI(title="minicpmvocr-webdemo", version="1.0")


def _proxy_to_worker(request: Request):
    """用户进程不跑模型。页面解析转到本机工人。"""
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
# 工具函数（与旧版完全一致，保持逻辑不变）
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
    """layout 块 + 识别结果块 → API 块对象。"""
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
    # 跨页合并（见 /api/image-parse/merge）：分数只代表合并前的半张表
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
    # page_index 原样回填请求值：前端按它校验响应属于哪一页。
    # （单图输入时版面结果里的 source.page_index 恒为空，不能用。）

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
    # 没开摆正就不带 rotation（前端按字段缺失处理为未摆正）
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

# 同一个 job 的单块重算会原地改 results_json，按 job 串行
_JOB_LOCKS: Dict[str, threading.Lock] = {}
_JOB_LOCKS_GUARD = threading.Lock()


def _job_lock(job_id: str) -> threading.Lock:
    with _JOB_LOCKS_GUARD:
        return _JOB_LOCKS.setdefault(job_id, threading.Lock())


def _decode_upload(image_b64: str):
    """base64 → (原始字节, 后缀)。只读文件头判断格式，不做整图解码。"""
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
# 路由
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
    """转发 OCR vLLM 的 Prometheus 指标：LIS 每 15s 抓一次（没有它就是 404）。"""
    import urllib.request
    try:
        with urllib.request.urlopen(VLLM_URL + "/metrics", timeout=5) as r:
            return Response(content=r.read(), media_type=r.headers.get("content-type", "text/plain"))
    except Exception as exc:
        return PlainTextResponse(f"# upstream OCR metrics unavailable: {exc}\n", status_code=503)


# ===================================================================
# LIS 入口：OpenAI Chat Completions 形状
# ===================================================================
# LIS 网关按 `model`＝服务名（--served-model-name）路由到 /v1/chat/completions，
# 所以经 LIS 调用时档位不能再放在 `model` 里，改从 `minicpm_ocr.mode` 读。
# 四个档位名直接当 `model` 也照旧可用。业务字段既可放在 `minicpm_ocr` 里，也可以按
# /api/image-parse 的写法放在顶层（image / page_index / order / source_token / pages）。
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
    """在业务响应外补齐 OpenAI chat.completion 的必需字段（业务字段原样保留）。"""
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
    # 流式只是把整份结果作为一个 chunk 发出去：识别是整页一次完成的
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

    # 顶层字段 < minicpm_ocr 里的字段
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
        # LIS 的「Chat Completions 自测」发纯文本；回 4xx 服务就过不了自测
        return _chat_response(JSONResponse(content={"choices": [{"message": {"content": LIS_USAGE_TEXT}}]}),
                              model, stream)
    return _chat_response(await run_in_threadpool(_handle_full_page, merged, target), model, stream)


@app.post("/api/image-parse/merge")
async def image_parse_merge(request: Request):
    body = await request.json()
    return await run_in_threadpool(_handle_merge, body)


@app.post("/api/page-parse")
async def page_parse(request: Request):
    """摆正和版面做完就返回票据。切片在这台机器的队列里继续解码。"""
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
    """票据对应的页还在解码时 ready 为 false。"""
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
        # 有分数的两档要支持单块重算，而重算从磁盘读 crop，所以落 crop
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

    # request_id 即 job id：单块重算 / 跨页合并凭它找回这次的结果
    request_id = job_id
    created_at = int(time.time())
    source_token = request_id

    upright_enabled = bool(cfg.get("upright", {}).get("enabled", True))
    # 跨页合并时要按原样重建这一页的响应
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
    """整张图当作印章，直接送给识别模型。不摆正，不检测版面，不落 job。"""
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
    """按训练里的英文抽字段句式拼提示。字段名原样放进引号。"""
    quoted = ", ".join(f'"{name}"' for name in fields)
    return (
        f'Extract the {quoted}. Format the output as a JSON object with keys: {quoted}. '
        'If an item is not in the image, use "###".'
    )


def normalize_kie_fields(value) -> List[str]:
    """校验字段名。空串、引号、换行、重名和超长列表都拒绝。"""
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
    """去掉首尾空白和包住整段的 json 围栏，不改字段内容。"""
    stripped = (text or "").strip()
    fenced = _KIE_FENCE.match(stripped)
    return fenced.group(1).strip() if fenced else stripped


def _handle_kie(body: Dict) -> JSONResponse:
    """整图按字段抽取。不摆正，不检测版面，不落 job。"""
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
    """跨页表格合并：一份 PDF 的各页都识别完后调用一次。

    只读不写——逐页结果保持原样（单块重算仍基于原页），合并结果只在响应里。
    页码不连续处（中间有失败页）断开，不跨缺口合并。只返回有变化的页。
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
        # image_id 在每个 job 里都是 page_xxxx，用 request_id 做键才不会撞
        pages.append({"image_id": rid, "page_index": int(meta["page_index"]),
                      "markdown": result.get("markdown", ""),
                      "blocks": result.get("crop_blocks") or []})
        ctx[rid] = {"meta": meta, "result": result, "layout": layout}

    # 页码连续的一段算一个 document，缺口处断开
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
        # absorbed：页首的续表并到了上一页；extended：页尾的表接上了下一页（可同时为真）
        resp["minicpm_ocr"]["cross_page"] = {"absorbed": absorbed, "extended": extended}
        out.append(resp)
    return JSONResponse(content={"merged_pages": len(out), "pages": out})


def _handle_rerun_block(body: Dict) -> JSONResponse:
    del body
    return _err(400, "这个演示不包含单块重算")


# ===================================================================
# 入口
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
