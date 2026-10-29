"""SGLang adapter: `python -m sglang.launch_server --is-embedding`.

The division of labour is the mirror image of the vLLM path. There, the engine
holds the model's `chat_template.jinja` and assembles the prompt from a content
list we hand it; the whole self-check exists to prove the engine still assembles
the right one. Here the engine applies no template at all: `/classify` takes a
finished prompt string in `text` and the two images in `image_data`, and renders
nothing. `PromptParts.raw` is that string.

So the failure this adapter can have is a different one, and it moves to our
side of the wire: nothing downstream can mangle the prompt, but this file could
build the wrong one. `build_prompt()` is fingerprinted at import
(`PROMPT_TEMPLATE_MD5`), and `selfcheck.py` compares what `describe_scoring_request`
would send against it before the service takes traffic -- see the `client` branch
there.

The other way to get this wrong is the engine, not the prompt: without the model
class from PR #45829, SGLang loads the generative class and `/classify` answers
with a 2048-dim hidden state instead of two logits. That is caught by shape, on
a real forward pass, at startup.
"""
from __future__ import annotations

from typing import Any

import httpx

from ..prompt import PromptParts
from .base import BackendError

__all__ = ["SGLangBackend"]


class SGLangBackend:
    """Talks to one `sglang.launch_server` process over HTTP."""

    #: Who assembles the prompt. `selfcheck.py` branches on this: an engine that
    #: templates for us has to be interrogated, one that does not has to be
    #: checked on our own side instead. Neither check substitutes for the other.
    prompt_source = "client"

    #: `/classify` returns the value head's two raw logits; `scorer.py` applies
    #: the softmax. Spelled out rather than left to the default, so the two
    #: families stay visible side by side in `sdk/backends/`.
    output_kind = "logits"

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
        """The model path SGLang was started with.

        `/get_model_info` rather than `/v1/models`: SGLang serves one model per
        process and reports it by path, which is what identifies the checkpoint.
        """
        if self._model:
            return self._model
        try:
            resp = await self._client.get(f"{self.base_url}/get_model_info", timeout=5.0)
        except httpx.HTTPError:
            return None
        if resp.status_code != 200:
            return None
        path = resp.json().get("model_path")
        if path:
            self._model = str(path)
        return self._model

    # ── request shape ────────────────────────────────────────────────────────

    def _classify_body(
        self, parts: PromptParts, original_data_url: str, render_data_url: str
    ) -> dict[str, Any]:
        """The exact body `forward` posts. Separate so the self-check can read it.

        Image order is load-bearing and silent when wrong: the prompt says the
        first image is the original and the second is the render, and the
        placeholders in `raw` are positional. Swapping them asks the model a
        different question and still returns a number in range.
        """
        return {
            "text": parts.raw,
            "image_data": [original_data_url, render_data_url],
        }

    def describe_scoring_request(self, parts: PromptParts) -> dict[str, Any]:
        """`_classify_body` with the image payloads elided, for the self-check."""
        return self._classify_body(parts, "<original>", "<render>")

    # ── the two calls ────────────────────────────────────────────────────────

    async def forward(
        self,
        parts: PromptParts,
        original_data_url: str,
        render_data_url: str,
    ) -> list[float]:
        body = self._classify_body(parts, original_data_url, render_data_url)
        try:
            async with self._gate:
                resp = await self._client.post(f"{self.base_url}/classify", json=body)
        except httpx.HTTPError as exc:
            raise BackendError(f"backend unreachable: {exc}") from exc
        if resp.status_code != 200:
            raise BackendError(f"backend HTTP {resp.status_code}: {resp.text[:300]}")

        try:
            logits = resp.json()["embedding"]
        except (KeyError, TypeError, ValueError) as exc:
            raise BackendError(f"unreadable response: {resp.text[:300]}") from exc
        if not isinstance(logits, list) or len(logits) != 2:
            got = len(logits) if isinstance(logits, list) else type(logits).__name__
            raise BackendError(
                f"expected 2 class logits, got {got}. A hidden state of a few "
                "thousand dimensions means the server loaded the generative class: "
                "start it with --json-model-override-args "
                '\'{"architectures": ["Qwen3_5VLForSequenceClassification"]}\'.'
            )
        return [float(logits[0]), float(logits[1])]

    async def tokenize(self, parts: PromptParts) -> list[int] | None:
        """Not applicable: this engine never assembles a prompt of its own.

        None is the honest answer rather than a gap. Asking SGLang to tokenize
        `raw` would only confirm that it can tokenize a string we handed it --
        it would prove nothing about the prompt, because the prompt did not come
        from the engine. The check that does carry weight for this backend runs
        against `describe_scoring_request` in `selfcheck.py`.
        """
        return None

    async def aclose(self) -> None:
        await self._client.aclose()
