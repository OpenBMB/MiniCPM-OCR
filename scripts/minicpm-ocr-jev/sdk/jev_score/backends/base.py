"""What a forward-pass backend has to provide.

The three engines this SDK targets agree on what they compute and on almost
nothing else. vLLM takes a chat content list and applies the model's template;
SGLang takes a finished prompt string and applies no template; llama.cpp is
different again. They also disagree about where the two class logits come back
(`data[0].probs` vs `embedding`).

So the adapter boundary is drawn at the narrowest place where they still agree:

    give me this candidate's prompt and its two images -> give me two raw logits

Everything above the line (softmax, probabilities, the HTTP shell) is written
once. Everything below it is per engine.

`logits`, not probabilities, is the contract on purpose. An engine that applies
its own activation returns numbers that look right, rank right, and are not the
published scale; asking for raw logits and doing the softmax ourselves is the
only version of this that cannot drift quietly.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from ..prompt import PromptParts

__all__ = ["Backend", "BackendError"]


class BackendError(RuntimeError):
    """The engine could not be reached, or answered with something unusable."""


@runtime_checkable
class Backend(Protocol):
    """One forward-pass engine."""

    async def forward(
        self,
        parts: PromptParts,
        original_data_url: str,
        render_data_url: str,
    ) -> list[float]:
        """Two raw class logits for one candidate, in class order [0, 1].

        Raises `BackendError` if the engine is unreachable, is still loading, or
        returns anything other than exactly two numbers.
        """
        ...

    async def served_name(self) -> str | None:
        """What the engine calls the model, or None while it is still loading.

        Asked rather than configured: the only name that works is the one the
        engine was started with. A constant here is wrong in exactly the case
        nobody is watching -- the two halves started from different revisions,
        startup looks fine, and the first real request comes back 404.
        """
        ...

    async def tokenize(self, parts: PromptParts) -> list[int] | None:
        """Token ids for the prompt as *this engine* would assemble it.

        None if the engine exposes no such endpoint. Used by `selfcheck.py` to
        prove, before the service accepts traffic, that the engine's assembly
        still equals the training prompt. An engine that cannot answer this
        cannot be checked, which is a fact worth surfacing rather than hiding.
        """
        ...

    async def aclose(self) -> None:
        """Release connections."""
        ...
