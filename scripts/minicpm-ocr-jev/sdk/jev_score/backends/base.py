"""What a forward-pass backend has to provide.

The three engines this SDK targets agree on what they compute and on almost
nothing else. vLLM takes a chat content list and applies the model's template;
SGLang takes a finished prompt string and applies no template; llama.cpp is
different again. They also disagree about where the two class logits come back
(`data[0].probs` vs `embedding`).

So the adapter boundary is drawn at the narrowest place where they still agree:

    give me this candidate's prompt and its two images -> give me the two class
    scores, in class order [0, 1]

Everything above the line (the HTTP shell, the probability) is written once.
Everything below it is per engine.

Two families of engine, and `output_kind` says which one an adapter is:

    "logits"        vLLM, SGLang -- two raw logits, this layer applies the softmax
    "probabilities" llama.cpp, Ollama -- the engine already applied it

Raw logits are preferred wherever an engine will hand them over, for the reason
the second family makes concrete: an engine that applies its own activation
returns numbers that look right, rank right, and need not be on the published
scale. `/v1/systemone` is accepted into the contract because its softmax is the
same one -- temperature 1 over the same two class scores -- not because the
distinction stopped mattering.

What that costs, and what replaces it: an adapter claiming "logits" cannot be
mistaken for one claiming "probabilities", because the softmax of a probability
pair is not a probability pair. So `scorer.py` checks the claim instead of
trusting it -- two numbers declared as probabilities must lie in [0, 1] and sum
to 1. That catches the one confusion this extension introduces, which is an
adapter that mislabels which family it belongs to.
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

    #: "logits" or "probabilities" -- which of the two families `forward` returns.
    #: Read with a default of "logits", so an adapter written before this existed
    #: keeps its old meaning rather than silently changing scale.
    output_kind: str

    async def forward(
        self,
        parts: PromptParts,
        original_data_url: str,
        render_data_url: str,
    ) -> list[float]:
        """The two class scores for one candidate, in class order [0, 1].

        Raw logits or probabilities according to `output_kind`.

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
