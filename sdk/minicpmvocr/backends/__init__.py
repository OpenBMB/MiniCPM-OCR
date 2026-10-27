from __future__ import annotations

from pathlib import Path
from typing import Dict, List

from .client import PNG_COMPRESS_LEVEL, EngineError, VLMClient, encode_image_b64
from .dialects import DIALECTS, CropRequest, Dialect, DialectError


BACKEND_TYPES = ("vllm", "llamacpp", "ollama", "openai")

BACKEND_ALIASES: Dict[str, str] = {

    "minicpm_vllm_openai_api": "vllm",
    "minicpm_vllm": "vllm",
    "vllm_openai_api": "vllm",
    "llama_cpp": "llamacpp",
    "llama-cpp": "llamacpp",
    "llama.cpp": "llamacpp",
    "llama_server": "llamacpp",
    "llama-server": "llamacpp",
    "gguf": "llamacpp",
    "openai_compatible": "openai",
    "openai_api": "openai",
    "sglang": "openai",
    "lmdeploy": "openai",
}

OPENAI_API_STYLES = ("openai", "openai_compat", "openai_compatible", "v1")


def list_backends() -> List[str]:
    return sorted(BACKEND_TYPES)


def normalize_backend_name(engine_type: str) -> str:
    key = str(engine_type or "").strip().lower()
    key = BACKEND_ALIASES.get(key, key)
    if key not in BACKEND_TYPES:
        raise ValueError(
            "Unsupported engine.type: {!r}. Available backends: {} (aliases: {})".format(
                engine_type, ", ".join(list_backends()), ", ".join(sorted(BACKEND_ALIASES))
            )
        )
    return key


def resolve_dialect(engine_cfg: Dict) -> Dialect:
    name = normalize_backend_name(engine_cfg.get("type", ""))
    api_style = str(engine_cfg.get("api_style", "") or "").strip().lower()
    if name == "ollama" and api_style in OPENAI_API_STYLES:
        return DIALECTS["ollama_openai"]
    return DIALECTS[name]


def validate_engine_config(engine_cfg: Dict, require_connection: bool = False) -> None:
    'Config-time checks that do not need a live server.'
    backend = normalize_backend_name(engine_cfg.get("type", ""))

    if engine_cfg.get("auto_start"):
        raise ValueError(
            "engine.auto_start is no longer supported: the SDK connects to an already running "
            "server. Start it with scripts/start_%s.sh (or your own launcher) and point "
            "engine.server_url / engine.server_urls at it." % backend
        )

    if (require_connection or backend == "ollama") and not str(engine_cfg.get("model_name", "") or "").strip():
        raise ValueError("engine.model_name is required; specify --model NAME or configure the served model name")

    server_urls = engine_cfg.get("server_urls") or []
    if not isinstance(server_urls, list):
        raise ValueError("engine.server_urls must be a list of URLs")
    for url in server_urls:
        if not isinstance(url, str) or not url.strip():
            raise ValueError("engine.server_urls contains invalid URL value")
    if require_connection and not str(engine_cfg.get("server_url", "") or "").strip() and not server_urls and not engine_cfg.get("port"):
        raise ValueError("engine.server_url or engine.server_urls is required; specify --server-url URL")


def create_backend(cfg: Dict, run_dir: Path | None = None) -> VLMClient:
    '`run_dir` is accepted and ignored; the client no longer writes engine logs.'
    validate_engine_config(cfg["engine"], require_connection=True)
    return VLMClient(cfg, resolve_dialect(cfg["engine"]))


create_client = create_backend


__all__ = [
    "BACKEND_ALIASES",
    "BACKEND_TYPES",
    "CropRequest",
    "DIALECTS",
    "Dialect",
    "DialectError",
    "EngineError",
    "PNG_COMPRESS_LEVEL",
    "VLMClient",
    "create_backend",
    "create_client",
    "encode_image_b64",
    "list_backends",
    "normalize_backend_name",
    "resolve_dialect",
    "validate_engine_config",
]
