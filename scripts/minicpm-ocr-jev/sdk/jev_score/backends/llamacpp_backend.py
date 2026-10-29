"""llama.cpp adapter: `llama-server` with the decision-model endpoint.

This engine is the far end of the spectrum the other two adapters sit on. vLLM
holds the model's `chat_template.jinja` and assembles the prompt from a content
list; SGLang holds no template and runs the finished string we send. llama.cpp
holds a template too -- `systemone`, baked into the GGUF at conversion time --
but unlike vLLM's it cannot be read back out over HTTP. So `/v1/systemone` takes
only the parts that vary: the candidate text in `state`, the two images in
`files`.

Two consequences, both of which the rest of the SDK has to be told about rather
than left to discover:

  the prompt cannot be verified   There is no endpoint that returns what the
      server will build. `selfcheck.py` reports that as a fact instead of
      pretending to check it -- the `server_template` branch there. What still
      gets checked is the forward pass itself.

  the scores arrive activated     `/v1/systemone` answers with the class
      probabilities, not the two raw logits. `output_kind` says so, and
      `scorer.py` takes the number rather than softmaxing it twice. The scale is
      the published one because this softmax is the same one -- temperature 1
      over the same value head -- which is the only reason this is acceptable;
      see `base.py`.

`type: "choice"` rather than `"noul"`: both ask the same question, but `choice`
with an empty criterion per class returns the whole distribution, and two
numbers are what the startup shape check needs in order to be a check at all.
A single number cannot distinguish a decision model from anything else that
returns a float.
"""
from __future__ import annotations

from typing import Any

import httpx

from ..prompt import PromptParts
from .base import BackendError

__all__ = ["LlamaCppBackend"]


class LlamaCppBackend:
    """Talks to one `llama-server` process over HTTP."""

    #: The engine builds the prompt from a template we cannot read. `selfcheck.py`
    #: branches on this and reports the prompt as unverifiable rather than green.
    prompt_source = "server_template"

    #: `/v1/systemone` has already applied the softmax. See `base.py`.
    output_kind = "probabilities"

    #: The question this model answers. One question per request, named so the
    #: answer can be found again in the response.
    QUESTION = "consistency"

    def __init__(
        self,
        base_url: str,
        *,
        model: str | None = None,
        timeout: float = 120.0,
        max_in_flight: int = 32,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._model_override = model
        self._model: str | None = model
        self._client = httpx.AsyncClient(timeout=timeout)
        import asyncio

        self._gate = asyncio.Semaphore(max_in_flight)

    # ── identity ─────────────────────────────────────────────────────────────

    async def served_name(self) -> str | None:
        """What `llama-server` was started with, via the OpenAI-shaped listing.

        `/v1/models` is the one endpoint of that family this server implements
        usefully here: it reports the GGUF it loaded. The scoring endpoint itself
        is not OpenAI-shaped and takes no model name.
        """
        if self._model:
            return self._model
        try:
            resp = await self._client.get(f"{self.base_url}/v1/models", timeout=5.0)
        except httpx.HTTPError:
            return None
        if resp.status_code != 200:
            return None
        try:
            entries = resp.json().get("data") or []
            name = entries[0].get("id")
        except (AttributeError, IndexError, TypeError, ValueError):
            return None
        if name:
            self._model = str(name)
        return self._model

    # ── request shape ────────────────────────────────────────────────────────

    def _systemone_body(
        self, parts: PromptParts, original_data_url: str, render_data_url: str
    ) -> dict[str, Any]:
        """The exact body `forward` posts. Separate so the self-check can read it.

        Image order is load-bearing and silent when wrong: the baked template
        puts the first image before the OCR text and the second after it, and
        says so in words. Swapping them asks the model a different question and
        still returns a number in range.

        No `instructions`: the task is fixed by the model, and the template has
        it. Sending one here would put a second copy of the task in the prompt.
        """
        return {
            "state": parts.ocr_text,
            "files": [original_data_url, render_data_url],
            "questions": {
                self.QUESTION: {"type": "choice", "criteria": {"0": None, "1": None}}
            },
        }

    def describe_scoring_request(self, parts: PromptParts) -> dict[str, Any]:
        """`_systemone_body` with the image payloads elided, for the self-check."""
        return self._systemone_body(parts, "<original>", "<render>")

    def _read_probabilities(self, payload: Any, raw: str) -> list[float]:
        """The two class probabilities out of the `systemone` answer shape.

        Reads the classes by name rather than by position: the response holds a
        mapping, and a mapping has no order to rely on. Getting this backwards
        would invert every score while every score stayed in range.
        """
        try:
            answer = payload["answers"][self.QUESTION]
        except (KeyError, TypeError):
            raise BackendError(
                f"the response carries no answer named {self.QUESTION!r}: {raw[:300]}"
            ) from None
        probs = answer.get("probabilities") if isinstance(answer, dict) else None
        if not isinstance(probs, dict):
            raise BackendError(
                "the answer carries no 'probabilities' mapping. A server that "
                "answers with a single number was asked a different question "
                f"type than 'choice': {raw[:300]}"
            )
        missing = [k for k in ("0", "1") if k not in probs]
        if missing:
            raise BackendError(
                f"the answer is missing class {', '.join(missing)}. Ask with "
                "criteria {\"0\": null, \"1\": null} to get both classes."
            )
        try:
            return [float(probs["0"]), float(probs["1"])]
        except (TypeError, ValueError) as exc:
            raise BackendError(f"unreadable class probabilities: {raw[:300]}") from exc

    # ── the two calls ────────────────────────────────────────────────────────

    async def forward(
        self,
        parts: PromptParts,
        original_data_url: str,
        render_data_url: str,
    ) -> list[float]:
        body = self._systemone_body(parts, original_data_url, render_data_url)
        try:
            async with self._gate:
                resp = await self._client.post(f"{self.base_url}/v1/systemone", json=body)
        except httpx.HTTPError as exc:
            raise BackendError(f"backend unreachable: {exc}") from exc
        if resp.status_code != 200:
            raise BackendError(f"backend HTTP {resp.status_code}: {resp.text[:300]}")

        try:
            payload = resp.json()
        except ValueError as exc:
            raise BackendError(f"unreadable response: {resp.text[:300]}") from exc
        return self._read_probabilities(payload, resp.text)

    async def tokenize(self, parts: PromptParts) -> list[int] | None:
        """Not available: the prompt is assembled inside the server.

        `llama-server` does expose a tokenizer, but tokenizing anything we could
        send it would describe our string rather than the one the baked template
        produces -- the gap between the two is precisely what a prompt check
        would be for. None is the honest answer; `selfcheck.py` surfaces it.
        """
        return None

    async def aclose(self) -> None:
        await self._client.aclose()
