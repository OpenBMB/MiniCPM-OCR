"""The score layer as an HTTP service: a thin shell over `Scorer`, and nothing else.

Thin is the design, not an apology for it. The render+score layer (`sdk/app.py`)
does not reach the model through this shell -- it imports `Scorer` directly, in
the same process -- so nothing here is on the hot path of a full deployment. This
exists for the deployment that wants scoring only: renders made elsewhere,
scores wanted over HTTP, no Chromium anywhere on the host.

The startup gate runs before the first request is served, and a failing gate
stops the process. Starting anyway and reporting "degraded" would mean answering
requests with numbers that are wrong in a way the caller cannot see.
"""
from __future__ import annotations

import base64
import binascii
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .backends import BackendError, load_backend
from .prompt import PROMPT_TEMPLATE_MD5
from .scorer import ScoreInput, Scorer
from .selfcheck import SelfCheckResult, run_selfcheck

__all__ = ["app", "create_app"]

#: Set to "1" to start even if the prompt gate fails. For bringing up a new
#: engine, where the gate failing is the thing being worked on -- never for
#: serving, where it means the scores are off scale.
ALLOW_UNVERIFIED = os.environ.get("JEV_ALLOW_UNVERIFIED") == "1"
MAX_ITEMS = int(os.environ.get("JEV_MAX_ITEMS", "64"))

STATE: dict[str, Any] = {"scorer": None, "selfcheck": None, "served": None}


# ── wire types ───────────────────────────────────────────────────────────────

class ScoreItem(BaseModel):
    original_image: str = Field(..., description="base64 of the original block image")
    render_image: str = Field(..., description="base64 of the candidate rendered back to an image")
    ocr_text: str = Field(..., description="the candidate text, verbatim -- it is not stripped")


class ScoreRequest(BaseModel):
    items: list[ScoreItem]


class ScoreResultItem(BaseModel):
    prob_1: float | None = Field(
        None, description="P(the candidate is consistent with the original image)"
    )
    error: str | None = None


class ScoreResponse(BaseModel):
    results: list[ScoreResultItem]


def _decode(b64: str, field: str, index: int) -> bytes:
    try:
        return base64.b64decode(b64, validate=False)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(422, f"items[{index}].{field}: not valid base64 ({exc})")


# ── app ──────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    scorer = Scorer(load_backend(os.environ.get("JEV_BACKEND_CONFIG") or None,
                                 base_url=os.environ.get("JEV_BACKEND_URL")))
    STATE["scorer"] = scorer
    STATE["served"] = await scorer.backend.served_name()

    result: SelfCheckResult = await run_selfcheck(scorer.backend)
    STATE["selfcheck"] = result
    if not result.passed:
        if not ALLOW_UNVERIFIED:
            await scorer.aclose()
            raise RuntimeError(
                "\n".join([
                    "refusing to start: the engine does not assemble the prompt this "
                    "checkpoint was trained on.",
                    *result.notes,
                    "",
                    "Set JEV_ALLOW_UNVERIFIED=1 to start anyway. Scores produced that "
                    "way are not comparable to any published number.",
                ])
            )
        print("!!  starting UNVERIFIED: " + "; ".join(result.notes), flush=True)

    try:
        yield
    finally:
        await scorer.aclose()


def create_app() -> FastAPI:
    app = FastAPI(title="minicpm-ocr-jev score (SDK)", lifespan=lifespan)

    @app.get("/healthz")
    async def healthz() -> JSONResponse:
        check: SelfCheckResult | None = STATE.get("selfcheck")
        scorer: Scorer | None = STATE.get("scorer")
        served = STATE.get("served")
        if scorer is not None and served is None:
            served = STATE["served"] = await scorer.backend.served_name()
        body = {
            "status": "ok" if (check and check.passed) else "unverified",
            "served_model": served,
            "prompt": {
                "template_md5": PROMPT_TEMPLATE_MD5,
                "last_token": check.last_token if check else None,
                "expected_last_token": check.expected_last_token if check else None,
                "token_equality": check.token_equality if check else None,
                "notes": check.notes if check else [],
            },
        }
        return JSONResponse(body, status_code=200 if served else 503)

    @app.post("/v1/score", response_model=ScoreResponse)
    async def score(req: ScoreRequest) -> ScoreResponse:
        if not req.items:
            return ScoreResponse(results=[])
        if len(req.items) > MAX_ITEMS:
            raise HTTPException(413, f"at most {MAX_ITEMS} items per request, got {len(req.items)}")

        scorer: Scorer = STATE["scorer"]
        inputs = [
            ScoreInput(
                original=_decode(it.original_image, "original_image", i),
                render=_decode(it.render_image, "render_image", i),
                ocr_text=it.ocr_text,
            )
            for i, it in enumerate(req.items)
        ]
        # One bad item must not take the batch down with it: a caller that sent
        # twenty candidates and one unreadable PNG wants the nineteen scores.
        import asyncio

        settled = await asyncio.gather(
            *(scorer.score(i) for i in inputs), return_exceptions=True
        )
        results = []
        for outcome in settled:
            if isinstance(outcome, BaseException):
                if not isinstance(outcome, (BackendError, ValueError, OSError)):
                    raise outcome
                results.append(ScoreResultItem(error=str(outcome)))
            else:
                results.append(ScoreResultItem(prob_1=outcome))
        return ScoreResponse(results=results)

    return app


app = create_app()
