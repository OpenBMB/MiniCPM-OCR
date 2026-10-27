from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, List, Optional


class DialectError(RuntimeError):
    pass


@dataclass(frozen=True)
class CropRequest:
    'The single internal request shape, independent of any backend.'

    image_b64: str
    prompt: str
    max_tokens: int
    slice_nums: Optional[int] = None


    n: int = 1
    decode_overrides: Optional[Dict] = None


@dataclass(frozen=True)
class Dialect:
    name: str
    default_port: int
    chat_path: str
    health_path: str
    build_payload: Callable[[CropRequest, Dict, Dict, Dict], Dict]
    parse_response: Callable[[Dict], Dict]

    check_health: Callable[[Dict, object], Optional[str]] = lambda cfg, body: None
    context_overflow_codes: tuple = (400,)
    context_overflow_markers: tuple = ("maximum context length",)


def _data_uri(image_b64: str) -> str:
    return "data:image/png;base64,%s" % image_b64


def _openai_messages(req: CropRequest) -> List[Dict]:
    return [
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": _data_uri(req.image_b64)}},
                {"type": "text", "text": req.prompt},
            ],
        }
    ]


def _extra_body(engine_cfg: Dict) -> Dict:
    extra = engine_cfg.get("extra_body") or {}
    return dict(extra) if isinstance(extra, dict) else {}


def _normalized(text: str, finish_reason, completion_tokens: int, extra_metrics: Dict, data: Dict,
                texts: Optional[List[str]] = None) -> Dict:
    return {
        "text": text or "",


        "texts": texts if texts is not None else [text or ""],
        "finish_reason": finish_reason,
        "output_token_count": int(completion_tokens),
        "request_metrics": extra_metrics,
        "encoder_metrics": {},
        "raw_response": data,
    }


def parse_openai_response(data: Dict) -> Dict:
    if "error" in data and data["error"]:
        raise DialectError(str(data["error"]))
    choices = data.get("choices")
    if not choices:
        raise DialectError("invalid OpenAI response shape: no choices; body=%s" % str(data)[:300])
    try:
        texts = [(c.get("message") or {}).get("content") or "" for c in choices]
        choice = choices[0]
    except (AttributeError, TypeError) as e:
        raise DialectError("invalid OpenAI response shape: %s; body=%s" % (e, str(data)[:300])) from e
    usage = data.get("usage") or {}
    return _normalized(
        text=(choice.get("message") or {}).get("content"),
        finish_reason=choice.get("finish_reason"),
        completion_tokens=usage.get("completion_tokens", 0),
        extra_metrics={
            "prompt_tokens": int(usage.get("prompt_tokens", 0)),
            "completion_tokens": int(usage.get("completion_tokens", 0)),
            "total_tokens": int(usage.get("total_tokens", 0)),
        },
        data=data,
        texts=texts,
    )


def check_models_endpoint(engine_cfg: Dict, body) -> Optional[str]:
    ids = [item.get("id") for item in (body or {}).get("data", []) if item.get("id")]
    return None if ids else "model list is empty"


def build_openai_payload(req: CropRequest, engine_cfg: Dict, mm_cfg: Dict, decode_cfg: Dict) -> Dict:
    payload = {
        "model": engine_cfg.get("model_name", ""),
        "messages": _openai_messages(req),
        "max_tokens": int(req.max_tokens),
        "stream": False,
        "temperature": decode_cfg.get("temperature", 0.01),
        "top_p": decode_cfg.get("top_p", 0.001),
    }
    payload.update(_extra_body(engine_cfg))
    return payload


def build_vllm_payload(req: CropRequest, engine_cfg: Dict, mm_cfg: Dict, decode_cfg: Dict) -> Dict:
    slice_nums = req.slice_nums if req.slice_nums is not None else mm_cfg["max_slice_nums"]

    decode = dict(decode_cfg)
    if req.decode_overrides:
        decode.update(req.decode_overrides)
    payload = {
        "model": engine_cfg.get("model_name", ""),
        "messages": _openai_messages(req),
        "max_tokens": int(req.max_tokens),
        "mm_processor_kwargs": {
            "downsample_mode": mm_cfg["downsample_mode"],
            "max_slice_nums": int(slice_nums),
        },
        "chat_template_kwargs": {"enable_thinking": False},
        "temperature": decode["temperature"],
        "top_p": decode["top_p"],
        "top_k": decode["top_k"],
        "repetition_penalty": decode["repetition_penalty"],
        "no_repeat_ngram_size": decode["no_repeat_ngram_size"],
    }


    if req.decode_overrides:
        for key, value in req.decode_overrides.items():
            if key not in payload and key not in ("max_tokens_map",):
                payload[key] = value


    if req.n > 1:
        payload["n"] = int(req.n)
    payload.update(_extra_body(engine_cfg))
    return payload


def build_llamacpp_payload(req: CropRequest, engine_cfg: Dict, mm_cfg: Dict, decode_cfg: Dict) -> Dict:
    payload = {
        "model": engine_cfg.get("model_name", ""),
        "messages": _openai_messages(req),
        "max_tokens": int(req.max_tokens),
        "stream": False,
        "temperature": decode_cfg.get("temperature", 0.01),
        "top_p": decode_cfg.get("top_p", 0.001),
        "top_k": decode_cfg.get("top_k", 1),

        "repeat_penalty": decode_cfg.get("repetition_penalty", 1.0),
    }
    payload.update(_extra_body(engine_cfg))
    return payload


def check_llamacpp_health(engine_cfg: Dict, body) -> Optional[str]:
    status = (body or {}).get("status", "ok") if isinstance(body, dict) else "ok"
    return None if status in ("ok", "no slot available") else "status=%s" % status


def build_ollama_payload(req: CropRequest, engine_cfg: Dict, mm_cfg: Dict, decode_cfg: Dict) -> Dict:
    options = {
        "temperature": decode_cfg.get("temperature", 0.01),
        "top_p": decode_cfg.get("top_p", 0.001),
        "top_k": decode_cfg.get("top_k", 1),
        "repeat_penalty": decode_cfg.get("repetition_penalty", 1.0),
        "num_predict": int(req.max_tokens),
        "num_ctx": int(engine_cfg.get("num_ctx", 8192) or 8192),
    }
    extra_options = engine_cfg.get("extra_options") or {}
    if isinstance(extra_options, dict):
        options.update(extra_options)

    payload = {
        "model": engine_cfg.get("model_name", ""),
        "stream": False,
        "messages": [{"role": "user", "content": req.prompt, "images": [req.image_b64]}],
        "options": options,
    }
    keep_alive = engine_cfg.get("keep_alive", "")
    if keep_alive:
        payload["keep_alive"] = keep_alive
    payload.update(_extra_body(engine_cfg))
    return payload


def parse_ollama_response(data: Dict) -> Dict:
    if data.get("error"):
        raise DialectError(str(data["error"]))
    eval_count = int(data.get("eval_count", 0) or 0)
    prompt_eval = int(data.get("prompt_eval_count", 0) or 0)
    eval_duration_ns = float(data.get("eval_duration", 0) or 0)
    metrics = {
        "prompt_tokens": prompt_eval,
        "completion_tokens": eval_count,
        "total_tokens": prompt_eval + eval_count,
    }
    if eval_duration_ns > 0:
        metrics["tokens_per_sec"] = eval_count / (eval_duration_ns / 1e9)
    return _normalized(
        text=(data.get("message") or {}).get("content"),
        finish_reason=data.get("done_reason"),
        completion_tokens=eval_count,
        extra_metrics=metrics,
        data=data,
    )


def check_ollama_health(engine_cfg: Dict, body) -> Optional[str]:
    wanted = _normalize_ollama_tag(engine_cfg.get("model_name", ""))
    if not wanted:
        return None
    available = [_normalize_ollama_tag(m.get("name", "")) for m in (body or {}).get("models", [])]
    if wanted in available:
        return None
    return (
        "model '{}' not found; available: {}. Create it with "
        "`ollama create {} -f <Modelfile>` (see scripts/start_ollama.sh)".format(
            engine_cfg.get("model_name", ""), ", ".join(available) or "<none>", engine_cfg.get("model_name", "")
        )
    )


def _normalize_ollama_tag(name: str) -> str:
    name = str(name or "").strip()
    return name[: -len(":latest")] if name.endswith(":latest") else name


DIALECTS: Dict[str, Dialect] = {
    "openai": Dialect(
        name="openai",
        default_port=8000,
        chat_path="/v1/chat/completions",
        health_path="/v1/models",
        build_payload=build_openai_payload,
        parse_response=parse_openai_response,
        check_health=check_models_endpoint,
    ),
    "vllm": Dialect(
        name="vllm",
        default_port=18499,
        chat_path="/v1/chat/completions",
        health_path="/v1/models",
        build_payload=build_vllm_payload,
        parse_response=parse_openai_response,
        check_health=check_models_endpoint,
    ),
    "llamacpp": Dialect(
        name="llamacpp",
        default_port=18600,
        chat_path="/v1/chat/completions",
        health_path="/health",
        build_payload=build_llamacpp_payload,
        parse_response=parse_openai_response,
        check_health=check_llamacpp_health,
        context_overflow_codes=(400, 413, 500),
        context_overflow_markers=(
            "maximum context length",
            "exceed the available context size",
            "exceeds the available context size",
            "context size",
        ),
    ),
    "ollama": Dialect(
        name="ollama",
        default_port=11434,
        chat_path="/api/chat",
        health_path="/api/tags",
        build_payload=build_ollama_payload,
        parse_response=parse_ollama_response,
        check_health=check_ollama_health,
    ),

    "ollama_openai": Dialect(
        name="ollama_openai",
        default_port=11434,
        chat_path="/v1/chat/completions",
        health_path="/api/tags",
        build_payload=build_llamacpp_payload,
        parse_response=parse_openai_response,
        check_health=check_ollama_health,
    ),
}
