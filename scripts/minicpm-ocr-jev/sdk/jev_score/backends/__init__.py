"""Backend selection.

Which engine runs the forward pass is a deployment choice, not a code change, so
it is read from a file: `sdk/backends/<engine>.yaml`. One ships per engine;
`vllm.yaml` is the default, and `JEV_BACKEND_CONFIG` picks another.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .base import Backend, BackendError

__all__ = ["Backend", "BackendError", "load_backend", "load_config", "DEFAULT_CONFIG"]

#: Shipped configs live in sdk/backends/, next to the sdk/ entry points -- one
#: directory up from this package.
CONFIG_DIR = Path(__file__).resolve().parents[2] / "backends"
DEFAULT_CONFIG = CONFIG_DIR / "vllm.yaml"

#: Engines this SDK has an adapter for. Each has a shipped config of the same
#: name in `sdk/backends/`, and the error for anything else names them all,
#: because "not supported" and "you spelled it wrong" are different problems for
#: whoever is reading it.
#:
#: What they do *not* all share is how the scores come back. vLLM and SGLang hand
#: over the two raw logits; llama.cpp and Ollama answer with the probabilities
#: already activated. Each adapter declares which via `output_kind`, and
#: `scorer.py` branches on that -- see `base.py` for why that distinction is
#: worth a field rather than a convention.
KNOWN_ENGINES = {"vllm", "sglang", "llamacpp", "ollama"}


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    """Read a backend config. `JEV_BACKEND_CONFIG` overrides the default path."""
    import yaml

    chosen = Path(path or os.environ.get("JEV_BACKEND_CONFIG") or DEFAULT_CONFIG)
    if not chosen.is_file() and not chosen.is_absolute():
        # A relative path is resolved against the cwd of *this process*, which is
        # not where the operator typed the command: start_score.sh and
        # start_render_score.sh both `cd` into sdk/ before exec'ing uvicorn. So
        # `JEV_BACKEND_CONFIG=sdk/backends/sglang.yaml` -- the spelling the deploy
        # docs use, correct relative to the directory they tell you to stand in --
        # would otherwise never resolve. Try it against the SDK root, then against
        # the shipped config directory, so `sglang.yaml` works too.
        for base in (CONFIG_DIR.parent.parent, CONFIG_DIR):
            candidate = base / chosen
            if candidate.is_file():
                chosen = candidate
                break
    if not chosen.is_file():
        raise FileNotFoundError(
            f"backend config not found: {chosen}\n"
            f"Shipped configs: {', '.join(sorted(p.name for p in CONFIG_DIR.glob('*.yaml')))}"
        )
    config = yaml.safe_load(chosen.read_text(encoding="utf-8")) or {}
    if not isinstance(config, dict):
        raise ValueError(f"{chosen}: expected a mapping at the top level")
    config.setdefault("_source", str(chosen))
    return config


def load_backend(path: str | Path | None = None, **overrides: Any) -> Backend:
    """Build the backend a config names.

    `overrides` win over the file, so a caller that already knows the base URL --
    a test, or `app.py` started with an explicit `--backend-url` -- does not have
    to write a config file to say so.
    """
    config = {**load_config(path), **{k: v for k, v in overrides.items() if v is not None}}
    engine = str(config.get("engine", "")).strip().lower()

    if engine not in KNOWN_ENGINES:
        raise ValueError(
            f"{config.get('_source')}: unknown engine {engine!r}. "
            f"Known: {', '.join(sorted(KNOWN_ENGINES))}."
        )

    base_url = config.get("base_url")
    if not base_url:
        raise ValueError(f"{config.get('_source')}: 'base_url' is required")

    # Same four arguments for every engine: the adapters differ in what they put
    # on the wire, not in how they are configured.
    kwargs: dict[str, Any] = {
        "model": config.get("model") or None,
        "timeout": float(config.get("timeout_sec", 120.0)),
        "max_in_flight": int(config.get("max_in_flight", 32)),
    }

    if engine == "sglang":
        from .sglang_backend import SGLangBackend

        return SGLangBackend(str(base_url), **kwargs)

    if engine == "llamacpp":
        from .llamacpp_backend import LlamaCppBackend

        return LlamaCppBackend(str(base_url), **kwargs)

    if engine == "ollama":
        from .ollama_backend import OllamaBackend

        return OllamaBackend(str(base_url), **kwargs)

    from .vllm_backend import VLLMBackend

    return VLLMBackend(str(base_url), **kwargs)
