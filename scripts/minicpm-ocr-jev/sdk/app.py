"""render+score: the high layer. Original image + candidate text in, prob_yes out.

The score layer is given a rendered image; this layer is the one that makes it. Precheck,
render, score -- the same three stages `infer_vllm.py` runs offline, served over
the same HTTP contract the published image serves, so a caller can move between
them without changing a field name.

What it is not is a second implementation of either half:

  * rendering and precheck come from `rm_render.py` and `serve/render_pool.py`,
    imported, not copied
  * scoring goes through `jev_score`, in this process -- not over HTTP. Running
    the score service separately is for deployments that want *only* scoring;
    putting a socket between two halves of one process would buy nothing and
    cost a hop.
  * `serve/app.py` is deliberately not imported. Importing it builds a second
    FastAPI application and reads the image deployment's environment as a side
    effect of the import.

Start it with sdk/start_render_score.sh, against an engine from sdk/start_engine.sh.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import os
import shutil
import sys
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
for path in (str(ROOT), str(HERE), str(ROOT / "serve")):
    if path not in sys.path:
        sys.path.insert(0, path)

from rm_render import CATEGORIES, Candidate, RenderResult, render_candidates  # noqa: E402

from jev_score import PROMPT_TEMPLATE_MD5, BackendError, ScoreInput, Scorer  # noqa: E402
from jev_score.selfcheck import run_selfcheck  # noqa: E402

# ── settings ─────────────────────────────────────────────────────────────────

BACKEND_URL = os.environ.get("JEV_BACKEND_URL") or None
BACKEND_CONFIG = os.environ.get("JEV_BACKEND_CONFIG") or None
WEIGHTS = os.environ.get("JEV_WEIGHTS") or None
#: Threshold for the throughput rate in the summary only. It is reported with
#: every response and never applied to an item's score: `prob_yes` leaves this
#: service unrounded and undecided, exactly as the score layer produces it.
THRESHOLD = float(os.environ.get("RM_THRESHOLD", "0.5"))
MAX_ITEMS = int(os.environ.get("RM_MAX_ITEMS", "64"))
RENDER_MODE = os.environ.get("RM_RENDER_MODE", "persistent")
RENDER_BROWSERS = int(os.environ.get("RM_RENDER_BROWSERS", "2"))
BROWSER_CONCURRENCY = int(os.environ.get("RM_BROWSER_CONCURRENCY", "8"))
WORK_ROOT = os.environ.get("RM_WORK_ROOT") or tempfile.gettempdir()
KEEP_WORK = os.environ.get("RM_KEEP_WORK", "0") == "1"
PRECHECK = os.environ.get("RM_PRECHECK", "1") == "1"
ALLOW_UNVERIFIED = os.environ.get("JEV_ALLOW_UNVERIFIED") == "1"

INPUT_FORMS = ("ternary",)

#: prob_yes for items that never reached the model -- the same two values as the
#: Docker image's serve/app.py, because callers switch between the two without
#: touching their code:
#:   0.0  -- the candidate was judged unusable (bad LaTeX, render failed).
#:  -1.0  -- we never found out (bad input bytes, backend error).
#: Both lose every argmax and fail every threshold, and the summary counts only
#: `scored` items, so neither value moves a mean or a rate.
SENTINEL = {"precheck_reject": 0.0, "render_error": 0.0,
            "missing_original_image": 0.0, "encode_error": -1.0, "forward_error": -1.0}

STATE: dict[str, Any] = {"scorer": None, "pool": None, "selfcheck": None}


# ── schema ───────────────────────────────────────────────────────────────────
# Field names follow serve/app.py so callers do not change when they move.

class ScoreItem(BaseModel):
    case_id: str
    image: str = Field(..., description="original block image, base64 (PNG/JPEG)")
    ocr_text: str
    category: str = "text"
    render_image: Optional[str] = Field(
        default=None,
        description="rendered image, base64. Omit it and this service renders the "
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
                         "threshold. This is NOT the throughput rate.")
    throughput_rate: float = Field(
        ..., description="(scored items with prob_yes >= threshold) / total. The test "
                         "is >=, and only items with verdict=scored are counted.")
    mean_prob_yes: Optional[float] = None


class ScoreSummary(BaseModel):
    total: int
    scored: int
    precheck_reject: int
    render_error: int
    forward_error: int = 0
    pass_rate: float
    throughput_rate: float
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
    render_images: Optional[list[str]] = None
    threshold: Optional[float] = None

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


# ── helpers ──────────────────────────────────────────────────────────────────

def _decode(b64: str) -> bytes:
    try:
        return base64.b64decode(b64, validate=False)
    except (ValueError, binascii.Error) as exc:
        raise ValueError(str(exc)) from None


def _workdir() -> Path:
    path = Path(tempfile.mkdtemp(prefix="jev_l2_", dir=WORK_ROOT))
    return path


def _cleanup(work: Path) -> None:
    if not KEEP_WORK:
        shutil.rmtree(work, ignore_errors=True)


async def _render(items: list[ScoreItem], work: Path,
                  originals: dict[str, Path],
                  timings: dict[str, float] | None = None) -> dict[str, RenderResult]:
    """Render whatever has no render supplied. Returns {case_id: RenderResult}.

    The pool is used when it started; otherwise each batch gets its own browser
    through `render_candidates`, which is slower per request but needs nothing of
    this process to be healthy -- the thing to fall back to when the pool will
    not start.
    """
    todo = [i for i in items if i.render_image is None]
    if not todo:
        return {}

    candidates = [
        Candidate(case_id=i.case_id, image_path=str(originals[i.case_id]),
                  text=i.ocr_text, category=i.category)
        for i in todo
    ]
    pool = STATE.get("pool")
    if pool is not None:
        results = await pool.render(candidates, work, timings)
    else:
        results = await asyncio.to_thread(
            render_candidates, candidates, work_dir=work, precheck=PRECHECK,
            browser_concurrency=BROWSER_CONCURRENCY,
        )
    return {r.case_id: r for r in results}


def _stats_for(items: list[ScoreResultItem], thr: float) -> CategoryStats:
    total = len(items)
    scored = [i for i in items if i.verdict == "scored"]
    counts = {k: sum(1 for i in items if i.verdict == k)
              for k in ("precheck_reject", "render_error", "forward_error")}
    through = sum(1 for i in scored if i.prob_yes >= thr)
    return CategoryStats(
        total=total, scored=len(scored),
        precheck_reject=counts["precheck_reject"], render_error=counts["render_error"],
        forward_error=counts["forward_error"],
        pass_rate=len(scored) / total if total else 0.0,
        throughput_rate=through / total if total else 0.0,
        mean_prob_yes=(sum(i.prob_yes for i in scored) / len(scored)) if scored else None,
    )


def _summarize(items: list[ScoreResultItem], thr: float, form: str) -> ScoreSummary:
    overall = _stats_for(items, thr)
    by_category = {
        cat: _stats_for([i for i in items if i.category == cat], thr)
        for cat in sorted({i.category for i in items})
    }
    return ScoreSummary(
        total=overall.total, scored=overall.scored,
        precheck_reject=overall.precheck_reject, render_error=overall.render_error,
        forward_error=overall.forward_error, pass_rate=overall.pass_rate,
        throughput_rate=overall.throughput_rate, threshold_used=thr,
        input_form=form, by_category=by_category,
    )


async def _run(items: list[ScoreItem], thr: float,
               stage_sec: dict[str, float] | None = None) -> list[ScoreResultItem]:
    """precheck -> render -> score, for one batch. Every input gets a result."""
    scorer: Scorer = STATE["scorer"]
    work = _workdir()
    timings: dict[str, float] = {} if stage_sec is None else stage_sec
    t_start = time.perf_counter()
    try:
        # The original has to be on disk for the renderer, which takes a path.
        originals: dict[str, Path] = {}
        failed: dict[str, ScoreResultItem] = {}
        for item in items:
            try:
                raw = _decode(item.image)
            except ValueError as exc:
                failed[item.case_id] = ScoreResultItem(
                    case_id=item.case_id, category=item.category,
                    verdict="encode_error", prob_yes=SENTINEL["encode_error"],
                    detail=f"image is not valid base64: {exc}")
                continue
            path = work / f"{uuid.uuid4().hex}.png"
            path.write_bytes(raw)
            originals[item.case_id] = path

        pending = [i for i in items if i.case_id not in failed]
        t_render = time.perf_counter()
        renders = await _render(pending, work, originals, timings)
        timings["render_sec"] = round(time.perf_counter() - t_render, 6)

        scorable: list[tuple[ScoreItem, bytes]] = []
        for item in pending:
            if item.render_image is not None:
                try:
                    scorable.append((item, _decode(item.render_image)))
                except ValueError as exc:
                    failed[item.case_id] = ScoreResultItem(
                        case_id=item.case_id, category=item.category,
                        verdict="encode_error", prob_yes=SENTINEL["encode_error"],
                        detail=f"render_image is not valid base64: {exc}")
                continue
            result = renders.get(item.case_id)
            if result is None or not result.ok or not result.render_image_path:
                reason = (result.reason if result else "render_error") or "render_error"
                failed[item.case_id] = ScoreResultItem(
                    case_id=item.case_id, category=item.category, verdict=reason,
                    prob_yes=SENTINEL.get(reason, 0.0),
                    detail=(result.detail if result else "") or "")
                continue
            render_path = Path(result.render_image_path)
            if not render_path.is_file():
                # The renderer reported success and the file is not there. Say so
                # here rather than letting it surface as a FileNotFoundError from
                # inside the image loader, where the cause is unrecognisable.
                failed[item.case_id] = ScoreResultItem(
                    case_id=item.case_id, category=item.category,
                    verdict="render_error", prob_yes=SENTINEL["render_error"],
                    detail=f"render reported ok but {render_path} is missing")
                continue
            scorable.append((item, render_path.read_bytes()))

        t_forward = time.perf_counter()
        settled = await asyncio.gather(*(
            scorer.score(ScoreInput(
                original=originals[item.case_id].read_bytes(),
                render=render, ocr_text=item.ocr_text))
            for item, render in scorable
        ), return_exceptions=True)
        timings["forward_sec"] = round(time.perf_counter() - t_forward, 6)
        timings["forward_rows"] = float(len(scorable))

        scored: dict[str, ScoreResultItem] = {}
        for (item, _), outcome in zip(scorable, settled):
            if isinstance(outcome, BaseException):
                if not isinstance(outcome, (BackendError, ValueError, OSError)):
                    raise outcome
                scored[item.case_id] = ScoreResultItem(
                    case_id=item.case_id, category=item.category,
                    verdict="forward_error", prob_yes=SENTINEL["forward_error"],
                    detail=str(outcome))
            else:
                scored[item.case_id] = ScoreResultItem(
                    case_id=item.case_id, category=item.category, verdict="scored",
                    prob_yes=outcome, prob_no=1.0 - outcome)

        return [scored.get(i.case_id) or failed[i.case_id] for i in items]
    finally:
        timings["total_sec"] = round(time.perf_counter() - t_start, 6)
        _cleanup(work)


# ── app ──────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    scorer = Scorer(config=BACKEND_CONFIG, base_url=BACKEND_URL)
    STATE["scorer"] = scorer

    check = await run_selfcheck(scorer.backend, weights=WEIGHTS)
    STATE["selfcheck"] = check
    if not check.passed and not ALLOW_UNVERIFIED:
        await scorer.aclose()
        raise RuntimeError("\n".join([
            "refusing to start: the engine does not assemble the prompt this "
            "checkpoint was trained on.", *check.notes, "",
            "Set JEV_ALLOW_UNVERIFIED=1 to start anyway. Scores produced that way "
            "are not comparable to any published number.",
        ]))
    if not check.passed:
        print("!!  starting UNVERIFIED: " + "; ".join(check.notes), flush=True)

    if RENDER_MODE == "persistent":
        from render_pool import RenderPool

        pool = RenderPool(browsers=RENDER_BROWSERS,
                          pages_per_browser=BROWSER_CONCURRENCY, precheck=PRECHECK)
        try:
            await pool.start()
            STATE["pool"] = pool
        except Exception as exc:  # noqa: BLE001
            # Falling back is right here and wrong for the prompt check above.
            # A browser that will not start costs latency; a prompt that is not
            # the training prompt costs correctness, invisibly.
            print(f"!!  render pool did not start ({exc}); falling back to "
                  f"one browser per batch", flush=True)
            STATE["pool"] = None
    try:
        yield
    finally:
        pool = STATE.get("pool")
        if pool is not None:
            await pool.close()
        await scorer.aclose()


app = FastAPI(title="minicpm-ocr-jev render+score (SDK)", lifespan=lifespan)


@app.get("/healthz")
async def healthz() -> JSONResponse:
    scorer: Scorer | None = STATE.get("scorer")
    check = STATE.get("selfcheck")
    served = await scorer.backend.served_name() if scorer else None
    pool = STATE.get("pool")
    body = {
        "status": "ok" if (served and check and check.passed) else "degraded",
        "served_model": served,
        "render": {"mode": "persistent" if pool else "subprocess",
                   **(pool.describe() if pool else {})},
        "input_forms": {"supported": list(INPUT_FORMS),
                        "template_md5": PROMPT_TEMPLATE_MD5},
        "prompt_selfcheck": {
            "passed": check.passed if check else None,
            # Who assembled the prompt, which decides which checks below could run.
            "source": check.prompt_source if check else None,
            "last_token": check.last_token if check else None,
            "token_equality": check.token_equality if check else None,
            "scoring_request": check.scoring_request if check else None,
            "forward_shape": check.forward_shape if check else None,
        },
        "threshold_default": THRESHOLD,
    }
    return JSONResponse(body, status_code=200 if served else 503)


@app.post("/v1/rm/score", response_model=ScoreResponse)
async def score(req: ScoreRequest) -> ScoreResponse:
    # 400 for both, as the Docker image answers; the SDK's own /v1/score keeps
    # its 413 -- that endpoint has no counterpart in the image.
    if not req.items:
        raise HTTPException(400, "items must not be empty")
    if len(req.items) > MAX_ITEMS:
        raise HTTPException(400, f"at most {MAX_ITEMS} items per request, got {len(req.items)}")
    seen = {i.case_id for i in req.items}
    if len(seen) != len(req.items):
        raise HTTPException(422, "case_id must be unique within a request")

    thr = THRESHOLD if req.threshold is None else req.threshold
    results = await _run(req.items, thr)
    return ScoreResponse(results=results,
                         summary=_summarize(results, thr, req.input_form))


def _expand(req: ScoreBestRequest, prefix: str = "") -> list[ScoreItem]:
    renders = req.render_images or [None] * len(req.candidates)
    return [
        ScoreItem(case_id=f"{prefix}{req.case_id}__{i}", image=req.image,
                  ocr_text=text, category=req.category, render_image=renders[i])
        for i, text in enumerate(req.candidates)
    ]


def _pick_best(req: ScoreBestRequest, results: list[ScoreResultItem],
               **extra: Any) -> ScoreBestResponse:
    """argmax over the candidates that actually scored.

    No threshold is involved: picking the best candidate is a ranking question,
    and the threshold only ever decides whether a block counts as passing. If
    every candidate failed, index 0 comes back -- a degraded answer the caller
    can detect from `verdicts`, rather than an error that loses the whole block.
    """
    scores = [r.prob_yes for r in results]
    verdicts = [r.verdict for r in results]
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

    thr = THRESHOLD if req.threshold is None else req.threshold
    stage_sec: dict[str, float] = {}
    results = await _run(items, thr, stage_sec)
    return _pick_best(req, results, stage_sec=stage_sec,
                      batch_size=int(stage_sec.get("forward_rows", 0)))


@app.post("/v1/rm/score_best_batch", response_model=ScoreBestBatchResponse)
async def score_best_batch(req: ScoreBestBatchRequest) -> ScoreBestBatchResponse:
    """Several blocks in one request, flattened into a single pipeline run.

    Kept because callers already use it. Note that it no longer carries the
    advantage it used to: the backend batches across HTTP requests on its own,
    so separate `score_best` calls now reach the GPU in the same batch anyway.
    What this endpoint still saves is one render driver start-up per block.
    """
    items: list[ScoreItem] = []
    spans: list[tuple[int, int]] = []
    for n, sub in enumerate(req.items):
        expanded = _expand(sub, prefix=f"b{n}__")
        spans.append((len(items), len(items) + len(expanded)))
        items.extend(expanded)
    if len(items) > MAX_ITEMS:
        raise HTTPException(400, f"at most {MAX_ITEMS} candidates per request, got {len(items)}")

    # No per-request threshold here: ScoreBestBatchRequest carries none, and the
    # Docker image's endpoint of the same name does not take one either. The
    # fields of the two must stay identical -- callers switch between image and
    # SDK without touching their payloads.
    thr = THRESHOLD
    stage_sec: dict[str, float] = {}
    results = await _run(items, thr, stage_sec)
    return ScoreBestBatchResponse(
        results=[_pick_best(sub, results[start:end])
                 for sub, (start, end) in zip(req.items, spans)],
        stage_sec=stage_sec, batch_size=int(stage_sec.get("forward_rows", 0)),
    )
