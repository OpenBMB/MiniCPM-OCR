"""vLLM adapter: `vllm serve --runner pooling --convert classify`.

Three things about the request body are load-bearing, and all three fail
silently when they are wrong -- the server answers 200 with a number that is not
the score this checkpoint produces:

  1. The content list interleaves image, text, image, text. The model's own
     `chat_template.jinja` renders exactly the training prompt from that shape.
     Putting both images first and the whole prompt in one text part is what the
     reference service does *with a pass-through template*; with the default
     template it is a different prompt.

  2. `add_generation_prompt` must be True. vLLM's /classify path defaults it to
     False, which cuts off the empty assistant turn. The classify path pools the
     LAST token, so this moves the pooled position from token 271 to 198 -- the
     value head then reads a hidden state it never read during training.

  3. `enable_thinking: False` must sit inside `chat_template_kwargs`. At the top
     level of the body it is accepted and ignored, which is the same failure as
     (2) and looks identical from the outside.

The server-side counterpart is just as narrow: start it *without*
`--chat-template`, so the model's own template is the one that runs.
"""
from __future__ import annotations

from typing import Any

import httpx

from ..prompt import PromptParts
from .base import BackendError

__all__ = ["VLLMBackend"]


class VLLMBackend:
    """Talks to one `vllm serve` process over HTTP."""

    #: What the three request keys above are worth, in one place, so that the
    #: forward and tokenize paths cannot drift apart. `selfcheck` only proves the
    #: prompt is right if it asks the same question the scorer will ask.
    #:
    #: These are sent explicitly on every request, never left to a default, and
    #: that is not belt-and-braces. Measured on vLLM 0.32.0, the two endpoints
    #: disagree about `add_generation_prompt`:
    #:
    #:     /tokenize   default True
    #:     /classify   default False
    #:
    #: So the endpoint that scores is the one that defaults to the wrong value,
    #: and the endpoint the self-check interrogates is the one that defaults to
    #: the right one. Relying on either default would make the check agree with
    #: itself while the scores came out of a different prompt.
    TEMPLATE_KEYS: dict[str, Any] = {
        "add_generation_prompt": True,
        "chat_template_kwargs": {"enable_thinking": False},
    }

    def __init__(
        self,
        base_url: str,
        *,
        model: str | None = None,
        timeout: float = 120.0,
        max_in_flight: int = 32,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        #: Set only to pin the name; otherwise discovered from /v1/models.
        self._model_override = model
        self._model: str | None = model
        self._client = httpx.AsyncClient(timeout=timeout)
        import asyncio

        # vLLM queues past its own capacity, so this bounds our sockets and
        # memory rather than the engine's throughput.
        self._gate = asyncio.Semaphore(max_in_flight)

    # ── identity ─────────────────────────────────────────────────────────────

    async def served_name(self) -> str | None:
        if self._model:
            return self._model
        try:
            resp = await self._client.get(f"{self.base_url}/v1/models", timeout=5.0)
        except httpx.HTTPError:
            return None
        if resp.status_code != 200:
            return None
        served = [m["id"] for m in resp.json().get("data", [])]
        if served:
            self._model = served[0]
        return self._model

    async def _require_model(self) -> str:
        model = await self.served_name()
        if model is None:
            raise BackendError(
                f"backend not ready: {self.base_url}/v1/models did not name a model"
            )
        return model

    # ── request shape ────────────────────────────────────────────────────────

    def _messages(
        self, parts: PromptParts, original_data_url: str, render_data_url: str
    ) -> list[dict[str, Any]]:
        return [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": original_data_url}},
                {"type": "text", "text": parts.text_after_original},
                {"type": "image_url", "image_url": {"url": render_data_url}},
                {"type": "text", "text": parts.text_after_render},
            ],
        }]

    # ── the two calls ────────────────────────────────────────────────────────

    def _classify_body(
        self,
        model: str,
        parts: PromptParts,
        original_data_url: str,
        render_data_url: str,
    ) -> dict[str, Any]:
        """The exact body `forward` posts. Separate so the self-check can read it.

        The self-check cannot recover a prompt from /classify -- it answers with
        two numbers and nothing else -- so the only way to know the scoring call
        carries the template keys is to look at the call itself.
        """
        return {
            "model": model,
            "messages": self._messages(parts, original_data_url, render_data_url),
            # Raw logits. Letting the server apply its own activation would change
            # the numbers without changing the ranking, which is the kind of
            # difference that survives every smoke test and invalidates every
            # comparison against a published score.
            "use_activation": False,
            **self.TEMPLATE_KEYS,
        }

    def describe_scoring_request(self, parts: PromptParts) -> dict[str, Any]:
        """`_classify_body` with the image payloads elided, for the self-check."""
        body = self._classify_body(self._model or "<unresolved>", parts, "<original>", "<render>")
        return body

    async def forward(
        self,
        parts: PromptParts,
        original_data_url: str,
        render_data_url: str,
    ) -> list[float]:
        model = await self._require_model()
        body = self._classify_body(model, parts, original_data_url, render_data_url)
        try:
            async with self._gate:
                resp = await self._client.post(f"{self.base_url}/classify", json=body)
        except httpx.HTTPError as exc:
            raise BackendError(f"backend unreachable: {exc}") from exc
        if resp.status_code != 200:
            raise BackendError(f"backend HTTP {resp.status_code}: {resp.text[:300]}")

        try:
            logits = resp.json()["data"][0]["probs"]
        except (KeyError, IndexError, ValueError) as exc:
            raise BackendError(f"unreadable response: {resp.text[:300]}") from exc
        if len(logits) != 2:
            raise BackendError(
                f"expected 2 class logits from the value head, got {len(logits)}. "
                "This checkpoint may not be a 2-class sequence-classification model."
            )
        return [float(logits[0]), float(logits[1])]

    async def tokenize(self, parts: PromptParts) -> list[int] | None:
        """Ask the engine to render and tokenize the prompt, without running it.

        One-pixel placeholder images: /tokenize has to be given the same *shape*
        of request as /classify, because the number of tokens an image expands to
        depends on its size -- but the gate below only reads the tail of the
        sequence, where the assistant turn is, so the pixels themselves are
        irrelevant. A 1x1 PNG keeps the check fast and independent of any sample.
        """
        model = await self._require_model()
        body: dict[str, Any] = {
            "model": model,
            "messages": self._messages(parts, _PIXEL_PNG, _PIXEL_PNG),
            **self.TEMPLATE_KEYS,
        }
        try:
            resp = await self._client.post(f"{self.base_url}/tokenize", json=body)
        except httpx.HTTPError as exc:
            raise BackendError(f"backend unreachable: {exc}") from exc
        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            raise BackendError(f"/tokenize HTTP {resp.status_code}: {resp.text[:300]}")
        return list(resp.json()["tokens"])

    async def aclose(self) -> None:
        await self._client.aclose()


#: 1x1 white PNG.
_PIXEL_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
