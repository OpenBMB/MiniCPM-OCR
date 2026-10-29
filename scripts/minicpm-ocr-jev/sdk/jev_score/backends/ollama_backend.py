"""Ollama adapter: `ollama serve`, the same decision-model endpoint.

Ollama runs `llama-server` underneath, so everything that makes llama.cpp
different from the other two engines is true here as well: the `systemone`
template is baked into the GGUF and cannot be read back, and `/v1/systemone`
answers with class probabilities rather than raw logits. That is why this adapter
inherits rather than repeats -- the response shape, the two guards on it, and
both facts the rest of the SDK branches on live in one place.

What Ollama changes is the envelope, in two ways that are easy to get wrong
because each fails as an error rather than as a wrong number:

  the model is named      Ollama hosts many models and routes by name, so the
      name from `ollama create` has to travel in every request. llama.cpp serves
      the one GGUF it was started with and takes no name at all.

  images are bare base64  Ollama's field is `images` and wants the base64 on its
      own; llama.cpp's is `files` and wants a `data:` URL. The SDK produces data
      URLs, so this adapter strips the prefix on the way out.
"""
from __future__ import annotations

from typing import Any

from ..prompt import PromptParts
from .base import BackendError
from .llamacpp_backend import LlamaCppBackend

__all__ = ["OllamaBackend"]


def _bare_base64(data_url: str) -> str:
    """The payload of a `data:` URL, or the string unchanged if it is already bare.

    Tolerant on the way in and strict on the way out: callers inside this SDK
    always pass a data URL, but a caller that had the base64 to begin with should
    not have to wrap it just to have it unwrapped.
    """
    marker = ";base64,"
    at = data_url.find(marker)
    return data_url[at + len(marker):] if at != -1 else data_url


class OllamaBackend(LlamaCppBackend):
    """Talks to one `ollama serve` process over HTTP."""

    def __init__(
        self,
        base_url: str,
        *,
        model: str | None = None,
        timeout: float = 120.0,
        max_in_flight: int = 32,
    ) -> None:
        if not model:
            raise BackendError(
                "the Ollama backend needs the model name: set 'model' in "
                "sdk/backends/ollama.yaml to whatever `ollama create` registered "
                "(e.g. ocr-jev). Ollama routes by name, and it has no default."
            )
        super().__init__(
            base_url, model=model, timeout=timeout, max_in_flight=max_in_flight
        )

    # ── identity ─────────────────────────────────────────────────────────────

    async def served_name(self) -> str | None:
        """The configured name, which for this engine is the whole of its identity.

        Not asked over HTTP, unlike every other adapter here: Ollama would list
        every model it hosts, and which of them answers our requests is decided
        by the name we send, not by anything the server reports. The name is
        required in the constructor, so this cannot be None.
        """
        return self._model

    # ── request shape ────────────────────────────────────────────────────────

    def _systemone_body(
        self, parts: PromptParts, original_data_url: str, render_data_url: str
    ) -> dict[str, Any]:
        """llama.cpp's body with Ollama's envelope: named model, bare base64."""
        body = super()._systemone_body(parts, original_data_url, render_data_url)
        files = body.pop("files")
        return {
            "model": self._model,
            **body,
            "images": [_bare_base64(f) for f in files],
        }
