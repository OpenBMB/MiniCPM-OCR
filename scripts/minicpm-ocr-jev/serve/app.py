"""HTTP service for the OCR reward model.

This is the thin half of a two-process deployment:

    client ──> app.py (this file)  ──HTTP──>  vllm serve
                 precheck                       forward pass
                 render

The split is the point. Scoring one candidate costs roughly 0.26s of precheck,
0.88s of rendering and 0.10s of forward pass, so nine tenths of the work is CPU
and a browser, and one tenth is the GPU. Keeping them in one process means the
two compete for the same interpreter, and the only way to add rendering capacity
is to add GPUs. Split apart, this process is stateless and can be run N times
against one `vllm serve`, and vLLM's own scheduler -- continuous batching,
prefix caching -- handles the GPU side without any engine code of ours.

A second consequence worth knowing: because the backend batches across HTTP
requests, candidates from different requests are batched together automatically.
The old service had a dedicated endpoint to flatten several blocks into one batch
for that reason; here it comes for free, and `score_best_batch` is kept only
because callers already speak it.

Input form: this checkpoint is ternary (original image + text + rendered image).
`input_form` stays in the request schema, and must be "ternary"; "binary" is
rejected rather than ignored, because a silently accepted wrong form produces
scores that look fine.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, Field, model_validator

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from infer_vllm import MAX_ASPECT_RATIO, PROMPT_TEMPLATE_MD5, build_prompt  # noqa: E402
from render_pool import RenderPool  # noqa: E402
from rm_render import CATEGORIES, Candidate, render_candidates  # noqa: E402

# ── settings ─────────────────────────────────────────────────────────────────

VLLM_URL = os.environ.get("RM_VLLM_URL", "http://127.0.0.1:8026").rstrip("/")
#: What the backend calls this model. Asked for rather than assumed: the only
#: name that works is the one `vllm serve` was started with, so a constant here
#: is wrong in exactly the case nobody is watching -- the two halves started from
#: different revisions of this repo, start-up looking fine, and the first real
#: request coming back 404 from the backend. Set RM_VLLM_MODEL to pin it, which
#: you need only when the backend serves more than one model.
VLLM_MODEL_OVERRIDE = os.environ.get("RM_VLLM_MODEL") or None
VLLM_MODEL: str | None = VLLM_MODEL_OVERRIDE
THRESHOLD = float(os.environ.get("RM_THRESHOLD", "0.5"))
MAX_ITEMS = int(os.environ.get("RM_MAX_ITEMS", "64"))
#: "persistent" keeps one Chromium open for the life of the process; "subprocess"
#: starts a fresh one per batch. Persistent is the default because the fresh one
#: costs 2.28s before the first candidate is drawn, against 0.13s per candidate
#: after -- an overhead larger than the work on every realistic request. The
#: subprocess path stays reachable because it needs nothing of the service to be
#: healthy, which makes it the thing to fall back to when the pool will not start.
RENDER_MODE = os.environ.get("RM_RENDER_MODE", "persistent")
#: Persistent mode: how many Chromiums to keep open. This is the throughput knob
#: -- one browser is one set of processes and tops out well short of a busy
#: machine, however many pages it is allowed. Scale it with cores, not with
#: expected request rate.
RENDER_BROWSERS = int(os.environ.get("RM_RENDER_BROWSERS", "8"))
#: Pages rendering at once inside one browser. This is the per-request latency
#: knob: a request with twenty candidates renders them this many at a time. In
#: subprocess mode it is the same cap, applied per render driver.
BROWSER_CONCURRENCY = int(os.environ.get("RM_BROWSER_CONCURRENCY", "8"))
#: Subprocess mode only: how many render drivers may run at once, each with its
#: own Chromium. Ignored when the pool is in use, where one browser serves all.
RENDER_SLOTS = int(os.environ.get("RM_RENDER_SLOTS", "4"))
#: In-flight requests to the backend. vLLM queues past its own capacity, so this
#: only bounds our socket and memory use; the backend saturates around 16.
FORWARD_CONCURRENCY = int(os.environ.get("RM_FORWARD_CONCURRENCY", "32"))
WORK_ROOT = os.environ.get("RM_WORK_ROOT") or tempfile.gettempdir()
KEEP_WORK = os.environ.get("RM_KEEP_WORK", "0") == "1"
#: Interpreter used for the render driver. Set it when Playwright lives in a
#: different environment than this service -- in the reference image, a wrapper
#: script that also sets LD_LIBRARY_PATH and PLAYWRIGHT_BROWSERS_PATH.
RENDER_PYTHON = os.environ.get("RM_RENDER_PYTHON") or None

INPUT_FORMS = ("ternary",)
ENCODE_ERROR = "encode_error"
#: Failure kinds counted in `forward_error`. A new one must be added here, or the
#: four sub-counts stop adding up to `total` and blocks go missing silently.
FORWARD_FAILURES = {"forward_error", ENCODE_ERROR}

#: prob_yes for items that never reached the model. Two different values on
#: purpose, and callers must read `verdict` before the score:
#:   0.0  -- the candidate was judged unusable (bad LaTeX, render failed).
#:  -1.0  -- we never found out (bad input bytes, backend error).
#: Both lose every argmax and fail every threshold, so a caller that ignores
#: `verdict` degrades safely rather than wrongly.
SENTINEL = {"precheck_reject": 0.0, "render_error": 0.0,
            "missing_original_image": 0.0, ENCODE_ERROR: -1.0, "forward_error": -1.0}

RENDER_GATE = asyncio.Semaphore(RENDER_SLOTS)
FORWARD_GATE = asyncio.Semaphore(FORWARD_CONCURRENCY)
HTTP: httpx.AsyncClient | None = None
POOL: RenderPool | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global HTTP, POOL
    HTTP = httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=10.0),
                             limits=httpx.Limits(max_connections=FORWARD_CONCURRENCY * 2))
    if RENDER_MODE == "persistent":
        # A browser that will not start is a configuration problem -- a missing
        # Chromium, missing system libraries -- and it will not fix itself on the
        # first request. Failing here states the cause once, at start-up, instead
        # of once per request in a stack trace from inside Playwright.
        POOL = RenderPool(browsers=RENDER_BROWSERS,
                          pages_per_browser=BROWSER_CONCURRENCY)
        await POOL.start()
    try:
        yield
    finally:
        if POOL is not None:
            await POOL.close()
        await HTTP.aclose()


app = FastAPI(title="minicpm-ocr-jev (native vLLM)", lifespan=lifespan)


# ── schema ───────────────────────────────────────────────────────────────────
# Field names and semantics follow the existing service, so callers do not change.

class ScoreItem(BaseModel):
    case_id: str
    image: str = Field(..., description="original block image, base64 (PNG/JPEG)")
    ocr_text: str
    category: str = "text"
    render_image: Optional[str] = Field(
        default=None,
        description="rendered image, base64. Omit it and the service renders the "
                    "candidate itself; supplying it skips precheck and rendering.")

    @model_validator(mode="after")
    def check_category(self) -> "ScoreItem":
        if self.category not in CATEGORIES:
            raise ValueError(f"category must be one of {CATEGORIES}")
        return self


class ScoreRequest(BaseModel):
    input_form: str = Field(..., description=f"one of {INPUT_FORMS}")
    items: list[ScoreItem]
    threshold: Optional[float] = None

    @model_validator(mode="after")
    def check_form(self) -> "ScoreRequest":
        if self.input_form not in INPUT_FORMS:
            raise ValueError(f"input_form must be one of {INPUT_FORMS}")
        return self


class ScoreResultItem(BaseModel):
    case_id: str
    category: str = "text"
    verdict: str
    prob_yes: float
    prob_no: Optional[float] = None
    detail: str = ""


class CategoryStats(BaseModel):
    total: int
    scored: int
    precheck_reject: int
    render_error: int
    forward_error: int = 0
    pass_rate: float = Field(
        ..., description="scoring SUCCESS rate = scored / total. Independent of the "
                         "threshold. This is NOT the throughput rate -- for that, "
                         "read throughput_rate.")
    throughput_rate: float = Field(
        ..., description="throughput rate = (scored items with prob_yes >= threshold) "
                         "/ total. The test is >=, not >, and only items with "
                         "verdict=scored are counted.")
    mean_prob_yes: Optional[float] = None


class ScoreSummary(BaseModel):
    total: int
    scored: int
    precheck_reject: int
    render_error: int
    forward_error: int = 0
    pass_rate: float = Field(..., description="scoring SUCCESS rate, not the throughput rate.")
    throughput_rate: float = Field(..., description="throughput rate; test is >=.")
    threshold_used: float
    input_form: str = ""
    by_category: dict[str, CategoryStats] = {}


class ScoreResponse(BaseModel):
    results: list[ScoreResultItem]
    summary: ScoreSummary


class ScoreBestRequest(BaseModel):
    input_form: str = Field(..., description=f"one of {INPUT_FORMS}")
    case_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    image: str = Field(..., description="original block image, base64")
    candidates: list[str] = Field(..., min_length=1)
    category: str = "text"
    #: One render per candidate -- each renders its own text -- so this is a list
    #: as long as `candidates`, not a single image.
    render_images: Optional[list[str]] = None

    @model_validator(mode="after")
    def check_fields(self) -> "ScoreBestRequest":
        if self.input_form not in INPUT_FORMS:
            raise ValueError(f"input_form must be one of {INPUT_FORMS}")
        if self.category not in CATEGORIES:
            raise ValueError(f"category must be one of {CATEGORIES}")
        if self.render_images is not None and len(self.render_images) != len(self.candidates):
            raise ValueError(
                f"render_images must be the same length as candidates: "
                f"{len(self.render_images)} vs {len(self.candidates)}")
        return self


class ScoreBestResponse(BaseModel):
    best_index: int
    best_text: str
    #: prob_yes per candidate, in input order. See SENTINEL for failure values.
    scores: list[float]
    verdicts: list[str]
    #: Seconds per stage. Rendering dominates, so a caller tuning throughput needs
    #: to see the stages apart rather than one total.
    stage_sec: dict[str, float] = {}
    batch_size: int = 0


class ScoreBestBatchRequest(BaseModel):
    input_form: str = Field(..., description=f"one of {INPUT_FORMS}")
    items: list[ScoreBestRequest] = Field(..., min_length=1)

    @model_validator(mode="after")
    def check_form(self) -> "ScoreBestBatchRequest":
        if self.input_form not in INPUT_FORMS:
            raise ValueError(f"input_form must be one of {INPUT_FORMS}")
        return self


class ScoreBestBatchResponse(BaseModel):
    results: list[ScoreBestResponse]
    stage_sec: dict[str, float] = {}
    batch_size: int = 0


# ── images ───────────────────────────────────────────────────────────────────

def _slot_id(index: int, case_id: str) -> str:
    """A short fixed-length id for filenames within one request.

    Caller case ids carry document paths and run to 250+ bytes; ext4 caps a single
    filename at 255 bytes, and a Chinese character costs three. Hashing here keeps
    the real case id in the response and out of every path.
    """
    return f"{index:04d}_{hashlib.sha1(case_id.encode('utf-8')).hexdigest()[:16]}"


def _data_url(raw: bytes) -> str:
    """Bytes to a data URL the backend accepts, padding extreme aspect ratios.

    Qwen3.5-VL's preprocessor refuses images longer than 200:1, and document block
    crops are routinely a few pixels tall. Such an image is padded with white
    rather than resized: padding keeps the glyphs at their original scale, which
    is what the model was trained to compare against.

    Images that need no padding are forwarded byte for byte -- re-encoding every
    image would cost CPU on the hot path and change the pixels the model sees.
    """
    with Image.open(io.BytesIO(raw)) as img:
        fmt = (img.format or "PNG").upper()
        width, height = img.size
        longest, shortest = max(width, height), max(1, min(width, height))
        needs_pad = longest / shortest > MAX_ASPECT_RATIO
        if not needs_pad:
            mime = "image/jpeg" if fmt in ("JPEG", "JPG") else "image/png"
            return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")

        rgb = img.convert("RGB")
        if width >= height:
            new_w, new_h = width, max(height, int(width / MAX_ASPECT_RATIO + 0.999999))
        else:
            new_h, new_w = height, max(width, int(height / MAX_ASPECT_RATIO + 0.999999))
        canvas = Image.new("RGB", (new_w, new_h), "white")
        canvas.paste(rgb, ((new_w - width) // 2, (new_h - height) // 2))

    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _decode_b64(b64: str) -> bytes:
    """Decode caller-supplied base64, raising something we can turn into a verdict.

    Callers send malformed base64 often enough that this has to be per item: an
    exception escaping here would fail the whole request and throw away the
    results of every good item batched with it.
    """
    try:
        return base64.b64decode(b64, validate=False)
    except (ValueError, binascii.Error) as exc:
        raise ValueError(str(exc)) from None


# ── pipeline ─────────────────────────────────────────────────────────────────

async def _served_model() -> str | None:
    """The name the backend answers to, asked once and then remembered.

    None while the backend is still loading its weights; callers report that as a
    backend error rather than guessing a name and getting a 404 instead.
    """
    global VLLM_MODEL
    if VLLM_MODEL:
        return VLLM_MODEL
    assert HTTP is not None
    try:
        resp = await HTTP.get(f"{VLLM_URL}/v1/models", timeout=5.0)
        served = [m["id"] for m in resp.json().get("data", [])] if resp.status_code == 200 else []
    except Exception:
        return None
    if served:
        VLLM_MODEL = served[0]
    return VLLM_MODEL


async def _forward_one(prompt: str, original: str, render: str) -> dict[str, Any]:
    """Score one candidate. `original` and `render` are data URLs, in that order.

    The two images are listed before the text part because the backend binds the
    Nth image to the Nth placeholder in the rendered prompt, and build_prompt puts
    the original's placeholder first.
    """
    model = await _served_model()
    if model is None:
        return {"verdict": "forward_error", "prob_yes": SENTINEL["forward_error"],
                "detail": "backend not ready: /v1/models did not name a model"}
    body = {
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": original}},
                {"type": "image_url", "image_url": {"url": render}},
                {"type": "text", "text": prompt},
            ],
        }],
        # Raw logits: the softmax below weighs the two classes against each other,
        # which is what the reference setup does. Letting the server apply its own
        # activation would change the numbers without changing the ranking, and
        # silently break comparisons against published scores.
        "use_activation": False,
        "add_generation_prompt": False,
    }
    assert HTTP is not None
    async with FORWARD_GATE:
        resp = await HTTP.post(f"{VLLM_URL}/classify", json=body)
    if resp.status_code != 200:
        return {"verdict": "forward_error", "prob_yes": SENTINEL["forward_error"],
                "detail": f"backend HTTP {resp.status_code}: {resp.text[:300]}"}
    logits = resp.json()["data"][0]["probs"]
    if len(logits) != 2:
        return {"verdict": "forward_error", "prob_yes": SENTINEL["forward_error"],
                "detail": f"expected 2 class logits, got {len(logits)}"}
    import math

    a, b = float(logits[0]), float(logits[1])
    top = max(a, b)
    exp_a, exp_b = math.exp(a - top), math.exp(b - top)
    p_yes = exp_b / (exp_a + exp_b)
    return {"verdict": "scored", "prob_yes": p_yes, "prob_no": 1.0 - p_yes, "detail": ""}


async def _run_pipeline(items: list[ScoreItem], work: Path,
                        stage_sec: dict[str, float] | None = None) -> dict[str, dict[str, Any]]:
    """precheck -> render -> forward, for one batch of items.

    Returns {case_id: result}. Every input gets an entry, including the ones that
    never reached the model.
    """
    out: dict[str, dict[str, Any]] = {}
    originals: dict[str, str] = {}      # case_id -> data URL
    renders: dict[str, str] = {}        # case_id -> data URL
    to_render: list[Candidate] = []

    # --- decode the caller's images -----------------------------------------
    t0 = time.perf_counter()
    for i, item in enumerate(items):
        slot = _slot_id(i, item.case_id)
        try:
            raw = _decode_b64(item.image)
            originals[item.case_id] = _data_url(raw)
        except Exception as exc:
            out[item.case_id] = {"verdict": ENCODE_ERROR, "prob_yes": SENTINEL[ENCODE_ERROR],
                                 "detail": f"original image: {exc}"}
            continue

        if item.render_image is not None:
            try:
                renders[item.case_id] = _data_url(_decode_b64(item.render_image))
            except Exception as exc:
                out[item.case_id] = {"verdict": ENCODE_ERROR, "prob_yes": SENTINEL[ENCODE_ERROR],
                                     "detail": f"render image: {exc}"}
            continue

        # The renderer derives its geometry from the original image file, so the
        # bytes have to be on disk for it even though the forward pass uses the
        # data URL above.
        path = work / f"{slot}.img"
        path.write_bytes(raw)
        to_render.append(Candidate(case_id=item.case_id, image_path=str(path),
                                   text=item.ocr_text, category=item.category))
    if stage_sec is not None:
        stage_sec["decode_sec"] = round(time.perf_counter() - t0, 6)

    # --- precheck + render ---------------------------------------------------
    if to_render:
        t0 = time.perf_counter()
        if POOL is not None:
            # No gate here: the pool holds one process-wide semaphore of its own.
            # Adding a second cap around it would throttle requests rather than
            # pages, which is the wrong unit -- a request may carry one candidate
            # or thirty.
            results = await POOL.render(to_render, work / "render", timings=stage_sec)
        else:
            async with RENDER_GATE:
                results = await asyncio.to_thread(
                    render_candidates, to_render,
                    work_dir=work / "render",
                    precheck=True,
                    browser_concurrency=BROWSER_CONCURRENCY,
                    python_bin=RENDER_PYTHON,
                )
        if stage_sec is not None:
            stage_sec["render_sec"] = round(time.perf_counter() - t0, 6)

        for r in results:
            if r.ok and r.render_image_path and Path(r.render_image_path).is_file():
                renders[r.case_id] = _data_url(Path(r.render_image_path).read_bytes())
            else:
                reason = r.reason or "render_error"
                out[r.case_id] = {"verdict": reason,
                                  "prob_yes": SENTINEL.get(reason, 0.0),
                                  "detail": r.detail or ""}

    # --- forward -------------------------------------------------------------
    pending = [item for item in items if item.case_id not in out]
    t0 = time.perf_counter()
    scored = await asyncio.gather(*[
        _forward_one(build_prompt(item.ocr_text),
                     originals[item.case_id], renders[item.case_id])
        for item in pending
    ], return_exceptions=True)
    if stage_sec is not None:
        stage_sec["forward_sec"] = round(time.perf_counter() - t0, 6)
        stage_sec["forward_rows"] = len(pending)

    for item, result in zip(pending, scored):
        if isinstance(result, BaseException):
            out[item.case_id] = {"verdict": "forward_error",
                                 "prob_yes": SENTINEL["forward_error"],
                                 "detail": f"{type(result).__name__}: {result}"}
        else:
            out[item.case_id] = result
    return out


def _workdir() -> Path:
    return Path(tempfile.mkdtemp(dir=WORK_ROOT, prefix="rm_"))


def _cleanup(work: Path) -> None:
    if not KEEP_WORK:
        shutil.rmtree(work, ignore_errors=True)


# ── summary ──────────────────────────────────────────────────────────────────

def _stats_for(items: list[ScoreResultItem], thr: float) -> CategoryStats:
    total = len(items)
    scored = [r for r in items if r.verdict == "scored"]
    n_pass = sum(1 for r in scored if r.prob_yes >= thr)
    return CategoryStats(
        total=total,
        scored=len(scored),
        precheck_reject=sum(1 for r in items if r.verdict == "precheck_reject"),
        render_error=sum(1 for r in items if r.verdict in ("render_error", "missing_original_image")),
        forward_error=sum(1 for r in items if r.verdict in FORWARD_FAILURES),
        pass_rate=len(scored) / total if total else 0.0,
        throughput_rate=n_pass / total if total else 0.0,
        mean_prob_yes=(sum(r.prob_yes for r in scored) / len(scored)) if scored else None,
    )


def _summarize(items: list[ScoreResultItem], thr: float, form: str) -> ScoreSummary:
    overall = _stats_for(items, thr)
    by_category = {
        cat: _stats_for(group, thr)
        for cat in CATEGORIES
        if (group := [r for r in items if r.category == cat])
    }
    return ScoreSummary(
        total=overall.total, scored=overall.scored,
        precheck_reject=overall.precheck_reject, render_error=overall.render_error,
        forward_error=overall.forward_error, pass_rate=overall.pass_rate,
        throughput_rate=overall.throughput_rate, threshold_used=thr,
        input_form=form, by_category=by_category,
    )


# ── routes ───────────────────────────────────────────────────────────────────

@app.get("/healthz")
async def healthz() -> JSONResponse:
    """Readiness plus the identity of everything that decides a score.

    A service that answers 200 while pointed at the wrong weights or a different
    prompt produces numbers that look right, so the things that would make scores
    incomparable -- backend model, prompt fingerprint, renderer version -- are
    reported here rather than left to be inferred from the image tag.
    """
    global VLLM_MODEL
    backend: dict[str, Any] = {"url": VLLM_URL, "alive": False}
    try:
        assert HTTP is not None
        resp = await HTTP.get(f"{VLLM_URL}/v1/models", timeout=5.0)
        if resp.status_code == 200:
            backend["alive"] = True
            backend["served"] = [m["id"] for m in resp.json().get("data", [])]
            # Same discovery as the scoring path, so /healthz reports the name
            # that will actually be sent rather than one read from a constant.
            if VLLM_MODEL is None and backend["served"]:
                VLLM_MODEL = backend["served"][0]
    except Exception as exc:
        backend["error"] = f"{type(exc).__name__}: {exc}"
    backend["model"] = VLLM_MODEL

    body = {
        "status": "ok" if backend["alive"] else "loading",
        "backend": backend,
        "input_forms": {"supported": list(INPUT_FORMS), "template_md5": PROMPT_TEMPLATE_MD5},
        "scorer": {"model": VLLM_MODEL, "backend": "vllm-serve-classify",
                   "template_md5": PROMPT_TEMPLATE_MD5},
        "render": ({"enabled": True, **POOL.describe()} if POOL is not None else
                   {"enabled": True, "mode": "subprocess",
                    "browser_concurrency": BROWSER_CONCURRENCY, "slots": RENDER_SLOTS}),
        "settings": {"threshold": THRESHOLD, "max_items": MAX_ITEMS,
                     "forward_concurrency": FORWARD_CONCURRENCY},
    }
    return JSONResponse(body, status_code=200 if backend["alive"] else 503)


@app.post("/v1/rm/score", response_model=ScoreResponse)
async def score(req: ScoreRequest) -> ScoreResponse:
    if not req.items:
        raise HTTPException(400, "items must not be empty")
    if len(req.items) > MAX_ITEMS:
        raise HTTPException(400, f"at most {MAX_ITEMS} items per request")

    thr = req.threshold if req.threshold is not None else THRESHOLD
    work = _workdir()
    try:
        raw = await _run_pipeline(list(req.items), work)
    finally:
        _cleanup(work)

    results = [
        ScoreResultItem(
            case_id=item.case_id, category=item.category,
            verdict=raw[item.case_id]["verdict"],
            prob_yes=raw[item.case_id]["prob_yes"],
            prob_no=raw[item.case_id].get("prob_no"),
            detail=raw[item.case_id].get("detail", ""),
        )
        for item in req.items
    ]
    return ScoreResponse(results=results, summary=_summarize(results, thr, req.input_form))


def _expand(req: ScoreBestRequest, prefix: str = "") -> list[ScoreItem]:
    renders = req.render_images or [None] * len(req.candidates)
    return [
        ScoreItem(case_id=f"{prefix}{req.case_id}__{i}", image=req.image,
                  ocr_text=text, category=req.category, render_image=renders[i])
        for i, text in enumerate(req.candidates)
    ]


def _pick_best(req: ScoreBestRequest, items: list[ScoreItem],
               raw: dict[str, dict[str, Any]], **extra: Any) -> ScoreBestResponse:
    """argmax over the candidates that actually scored.

    No threshold is involved: picking the best candidate is a ranking question,
    and the threshold only ever decides whether a block counts as passing. If
    every candidate failed, index 0 comes back -- a degraded answer the caller can
    detect from `verdicts`, rather than an error that loses the whole block.
    """
    scores = [raw[i.case_id]["prob_yes"] for i in items]
    verdicts = [raw[i.case_id]["verdict"] for i in items]
    ok = [i for i, v in enumerate(verdicts) if v == "scored"]
    best = max(ok, key=lambda i: scores[i]) if ok else 0
    return ScoreBestResponse(best_index=best, best_text=req.candidates[best],
                             scores=scores, verdicts=verdicts, **extra)


@app.post("/v1/rm/score_best", response_model=ScoreBestResponse)
async def score_best(req: ScoreBestRequest) -> ScoreBestResponse:
    """N candidates for one block, sharing one original image; returns the best."""
    items = _expand(req)
    if len(items) > MAX_ITEMS:
        raise HTTPException(400, f"at most {MAX_ITEMS} candidates per request")

    work = _workdir()
    stage_sec: dict[str, float] = {}
    t0 = time.perf_counter()
    try:
        raw = await _run_pipeline(items, work, stage_sec=stage_sec)
    finally:
        _cleanup(work)
    stage_sec["total_sec"] = round(time.perf_counter() - t0, 6)

    return _pick_best(req, items, raw, stage_sec=stage_sec,
                      batch_size=int(stage_sec.get("forward_rows", 0)))


@app.post("/v1/rm/score_best_batch", response_model=ScoreBestBatchResponse)
async def score_best_batch(req: ScoreBestBatchRequest) -> ScoreBestBatchResponse:
    """Several blocks in one request, flattened into a single pipeline run.

    Kept because callers already use it. Note that it no longer carries the
    advantage it used to: the backend batches across HTTP requests on its own, so
    separate `score_best` calls now reach the GPU in the same batch anyway. What
    this endpoint still saves is one render driver start-up per block.

    `input_form` is taken from the batch; the per-block field is ignored, since
    one request is never half ternary.
    """
    per_block = [_expand(blk, prefix=f"b{bi}__") for bi, blk in enumerate(req.items)]
    items = [item for block in per_block for item in block]
    if len(items) > MAX_ITEMS:
        raise HTTPException(
            400, f"{len(items)} candidates after flattening, over the per-request "
                 f"limit of {MAX_ITEMS}; split the batch")

    work = _workdir()
    stage_sec: dict[str, float] = {}
    t0 = time.perf_counter()
    try:
        raw = await _run_pipeline(items, work, stage_sec=stage_sec)
    finally:
        _cleanup(work)
    stage_sec["total_sec"] = round(time.perf_counter() - t0, 6)

    # Per-block stage timings are left empty on purpose: one batch's wall clock
    # cannot be apportioned to the blocks inside it without inventing numbers.
    results = [_pick_best(blk, block_items, raw)
               for blk, block_items in zip(req.items, per_block)]
    return ScoreBestBatchResponse(results=results, stage_sec=stage_sec,
                                  batch_size=int(stage_sec.get("forward_rows", 0)))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.environ.get("HOST", "0.0.0.0"),
                port=int(os.environ.get("PORT", "8030")))
