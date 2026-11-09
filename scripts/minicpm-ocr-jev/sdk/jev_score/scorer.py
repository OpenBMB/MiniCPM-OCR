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

__all__ = [
    "Scorer",
    "ScoreInput",
    "BackendError",
    "PROMPT_TEMPLATE_MD5",
    "softmax_prob_1",
    "prob_1_from_probabilities",
]


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


#: How far a declared probability pair may stray from summing to 1 before we stop
#: believing it is one. Loose enough for float32 round-trips through JSON, far
#: tighter than any logit pair would land by accident.
_PROB_SUM_TOLERANCE = 1e-3


def prob_1_from_probabilities(scores: Sequence[float]) -> float:
    """P(class 1) from a pair the engine already softmaxed.

    Takes the number rather than recomputing it: a softmax applied twice is a
    different, flatter function, and it fails silently -- every score still lands
    in (0, 1) and the ranking survives, so no smoke test notices.

    The pair is checked rather than trusted. An adapter that declared
    `output_kind = "probabilities"` while handing over raw logits is the one
    mistake this path makes possible, and it is visible here: logits do not lie
    in [0, 1] and sum to 1.
    """
    if len(scores) != 2:
        raise ValueError(
            f"expected 2 class probabilities from the engine, got {len(scores)}. "
            "This checkpoint may not be a 2-class decision model."
        )
    p0, p1 = float(scores[0]), float(scores[1])
    if not (0.0 <= p0 <= 1.0 and 0.0 <= p1 <= 1.0):
        raise ValueError(
            f"the engine's two class scores are {p0!r} and {p1!r}, which are not "
            "probabilities. The adapter declares output_kind='probabilities'; if "
            "this engine returns raw logits, that declaration is what is wrong."
        )
    if abs(p0 + p1 - 1.0) > _PROB_SUM_TOLERANCE:
        raise ValueError(
            f"the engine's two class probabilities sum to {p0 + p1!r}, not 1. "
            "Either a class is missing from the response or these are not a "
            "distribution over the two classes."
        )
    return p1


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
        scores = await self.backend.forward(
            build_parts(item.ocr_text),
            to_data_url(item.original),
            to_data_url(item.render),
        )
        # Which of the two families this engine belongs to is the adapter's to
        # declare, not ours to guess -- and getting it wrong is the one failure
        # here that returns a plausible number instead of an error. See
        # backends/base.py for why the second family exists at all.
        if getattr(self.backend, "output_kind", "logits") == "probabilities":
            return prob_1_from_probabilities(scores)
        return softmax_prob_1(scores)

    def _batch_size(self) -> int:
        """How many candidates this backend wants in one forward pass.

        Asked of the adapter rather than configured here, and absent on the four
        HTTP adapters: their batching happens inside the engine, where requests
        from every client meet. Reading it with a default of 1 is what keeps this
        method unchanged for them.
        """
        if not hasattr(self.backend, "forward_batch"):
            return 1
        return max(1, int(getattr(self.backend, "max_batch_size", 1) or 1))

    async def score_many(self, items: Sequence[ScoreInput]) -> list[float]:
        """`score` over a batch, results in input order.

        Two paths. For an engine-backed adapter, and for any adapter at batch
        size 1, the candidates go out concurrently and the engine's own queue
        sets throughput -- a second limit above it would only make the real one
        harder to find. For an in-process adapter configured to batch, they are
        split into passes of `max_batch_size` instead: there is no engine queue
        to feed, so the width of the pass is the only throughput there is.
        """
        import asyncio

        if not items:
            return []
        size = self._batch_size()
        if size <= 1:
            return list(await asyncio.gather(*(self.score(i) for i in items)))

        out: list[float] = []
        for start in range(0, len(items), size):
            chunk = items[start : start + size]
            raw = await self.backend.forward_batch(
                [
                    (build_parts(i.ocr_text), to_data_url(i.original), to_data_url(i.render))
                    for i in chunk
                ]
            )
            if len(raw) != len(chunk):
                raise BackendError(
                    f"asked for {len(chunk)} scores in one pass and got {len(raw)}."
                )
            # The same two families as `score`, applied per row. Chunks run one
            # after another rather than concurrently on purpose: the adapter
            # admits one pass at a time, so gathering them here would queue on
            # its semaphore and only make the ordering harder to read.
            probabilities = getattr(self.backend, "output_kind", "logits") == "probabilities"
            out.extend(
                prob_1_from_probabilities(row) if probabilities else softmax_prob_1(row)
                for row in raw
            )
        return out

    async def score_many_settled(
        self, items: Sequence[ScoreInput]
    ) -> list[float | BaseException]:
        """`score_many`, but a failure is a value in the list rather than a raise.

        This is the shape a server wants: one bad candidate out of twenty should
        cost its own cell, not the other nineteen.

        What a failure costs differs by path, and the difference is honest rather
        than papered over. One candidate at a time, only that candidate fails.
        In a batched pass, the pass is what succeeded or failed -- so every
        candidate in it carries the error. Re-running the chunk one by one to
        narrow it down would turn a configuration chosen for throughput into its
        worst case exactly when things are already going wrong.
        """
        import asyncio

        if not items:
            return []
        size = self._batch_size()
        if size <= 1:
            return list(
                await asyncio.gather(*(self.score(i) for i in items), return_exceptions=True)
            )

        out: list[float | BaseException] = []
        for start in range(0, len(items), size):
            chunk = items[start : start + size]
            try:
                out.extend(await self.score_many(chunk))
            except (BackendError, ValueError, OSError) as exc:
                out.extend([exc] * len(chunk))
        return out

    async def aclose(self) -> None:
        await self.backend.aclose()
