"""Backend selection.

Which engine runs the forward pass is a deployment choice, not a code change, so
it is read from a file: `sdk/backends/<engine>.yaml`. The shipped one is
`vllm.yaml`; SGLang and llama.cpp get their own once the upstream work they
depend on lands.
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

#: Engines that are implemented *and* have been run against the model. The two
#: absent ones are listed here rather than silently missing, because "not
#: supported yet" and "you spelled it wrong" are different problems for whoever
#: is reading the error.
KNOWN_ENGINES = {"vllm"}
PLANNED_ENGINES = {
    "sglang": "the classify path needs an upstream PR that is not merged yet",
    "llamacpp": "the classify path needs an upstream PR that is not merged yet",
}


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    """Read a backend config. `JEV_BACKEND_CONFIG` overrides the default path."""
    import yaml

    chosen = Path(path or os.environ.get("JEV_BACKEND_CONFIG") or DEFAULT_CONFIG)
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
        if engine in PLANNED_ENGINES:
            raise NotImplementedError(
                f"backend '{engine}' is not implemented yet: {PLANNED_ENGINES[engine]}.\n"
                f"The adapter interface it will implement is in "
                f"{Path(__file__).parent / 'base.py'}."
            )
        raise ValueError(
            f"{config.get('_source')}: unknown engine {engine!r}. "
            f"Known: {', '.join(sorted(KNOWN_ENGINES))}."
        )

    base_url = config.get("base_url")
    if not base_url:
        raise ValueError(f"{config.get('_source')}: 'base_url' is required")

    from .vllm_backend import VLLMBackend

    return VLLMBackend(
        str(base_url),
        model=config.get("model") or None,
        timeout=float(config.get("timeout_sec", 120.0)),
        max_in_flight=int(config.get("max_in_flight", 32)),
    )
