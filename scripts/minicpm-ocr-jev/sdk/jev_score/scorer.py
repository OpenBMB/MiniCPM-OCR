"""score: original image + rendered image + candidate text -> prob_1.

This is the whole of the score layer. It does three things -- arrange the prompt,
encode the two images, softmax the two logits the backend returns -- and
deliberately does not do a fourth.

What it does not do is decide. There is no threshold here, no `pred_label`, and
the raw logits do not leave the layer. A probability is a comparable quantity;
a label is a probability plus somebody's threshold, and a threshold that travels
inside a scoring library ends up applied to runs it was never calibrated on. The
caller owns that choice because only the caller knows what the number is for.

Rendering is not here either: this layer is given the rendered image. That keeps
it free of Chromium, Node and the font stack -- a deployment that renders
elsewhere, or has the renders already, installs none of it. `sdk/app.py` is the
layer that renders.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from .backends import Backend, BackendError, load_backend
from .images import to_data_url
from .prompt import PROMPT_TEMPLATE_MD5, build_parts

__all__ = ["Scorer", "ScoreInput", "BackendError", "PROMPT_TEMPLATE_MD5", "softmax_prob_1"]


@dataclass(frozen=True)
class ScoreInput:
    """One candidate: the block as it was, the block as the candidate reads it."""

    original: bytes
    render: bytes
    ocr_text: str

    @classmethod
    def from_paths(
        cls, original: str | Path, render: str | Path, ocr_text: str
    ) -> "ScoreInput":
        return cls(Path(original).read_bytes(), Path(render).read_bytes(), ocr_text)


def softmax_prob_1(logits: Sequence[float]) -> float:
    """P(class 1) from the two class logits.

    Shifted by the max before exponentiating -- the logits are unbounded and the
    naive form overflows on confident inputs, which are exactly the ones a reward
    model produces most.
    """
    if len(logits) != 2:
        raise ValueError(
            f"expected 2 class logits from the value head, got {len(logits)}. "
            "This checkpoint may not be a 2-class sequence-classification model."
        )
    a, b = float(logits[0]), float(logits[1])
    top = max(a, b)
    exp_a, exp_b = math.exp(a - top), math.exp(b - top)
    return exp_b / (exp_a + exp_b)


class Scorer:
    """The score layer, as a library. `sdk/jev_score/server.py` is the thin HTTP shell over it."""

    def __init__(self, backend: Backend | None = None, *, config: str | Path | None = None,
                 base_url: str | None = None) -> None:
        self.backend = backend or load_backend(config, base_url=base_url)

    async def score(self, item: ScoreInput) -> float:
        """`prob_1` for one candidate.

        Raises `BackendError` rather than returning a sentinel. A score of 0.0
        and "the engine was down" are different facts, and a library that
        conflates them hands its caller a number that looks like a judgement.
        """
        logits = await self.backend.forward(
            build_parts(item.ocr_text),
            to_data_url(item.original),
            to_data_url(item.render),
        )
        return softmax_prob_1(logits)

    async def score_many(self, items: Sequence[ScoreInput]) -> list[float]:
        """`score` over a batch, concurrently, results in input order.

        Concurrency is bounded by the backend adapter, not here: the engine's own
        queue is what actually sets throughput, and a second limit above it would
        only make the real one harder to find.
        """
        import asyncio

        if not items:
            return []
        return list(await asyncio.gather(*(self.score(i) for i in items)))

    async def aclose(self) -> None:
        await self.backend.aclose()
