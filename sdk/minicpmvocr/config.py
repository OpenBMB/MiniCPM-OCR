from __future__ import annotations

import logging
import os
import re
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

import yaml

from .backends import normalize_backend_name, validate_engine_config
from .layouts import normalize_layout_provider, resolve_layout_provider_class


LOGGER = logging.getLogger(__name__)

DEFAULT_CONFIG: Dict[str, Any] = {
    "run": {
        "run_tag": "",
        "run_root": "./runs",
        "mode": "smoke_1page",
        "seed": 42,
    },
    "input": {
        "manifest": "",
        "file_path": "",
        "image_dir": "",
        "files_dir": "",
        "limit": 0,
    },


    "engine": {

        "type": "vllm",
        "model_name": "",


        "server_url": "",
        "server_urls": [],
        "port": 0,

        "api_key": "",
        "api_style": "",
        "chat_path": "",
        "health_path": "",
        "extra_headers": {},
        "extra_body": {},
        "startup_timeout_sec": 1800,
        "request_timeout_sec": 300,
        "request_ready_timeout_sec": 600,
        "request_retry_interval_sec": 2,

        "max_model_len": 0,
        "prompt_reserve_tokens": 512,

        "num_ctx": 8192,
        "keep_alive": "",
        "extra_options": {},
    },
    "upright": {

        "enabled": False,

        "doc_gate": True,

        "gate_min_side": 500,
        "gate_min_lines": 6,

        "min_apply_deg": 0.3,

        "cls_long_side": 1600,

        "orientation_confirm": True,

        "vote_lines": 12,
        "vote_min_lines": 5,
        "vote_axis_margin": 1.5,
        "vote_flip_majority": 0.75,

        "model_dir": "",
        "det_model_dir": "",
        "textline_model_dir": "",
    },
    "layout": {
        "enabled": True,


        "provider": "ppdoclayout3_paddlex",

        "model_dir": "",
        "device": "cuda",


        "threshold": 0.3,
        "nms": True,


        "use_chart_recognition": True,
        "use_seal_recognition": True,
        "use_ocr_for_image_block": False,


        "skip_vlm_labels": None,
    },
    "pipeline": {


        "max_workers": 32,
        "queue_mode": "concurrent",

        "page_workers": 1,
        "page_maxsize": 0,
        "region_maxsize": 0,


        "layout_workers": 1,


        "overlap_layout": False,


        "save_crops": False,


        "save_pages": False,


        "render_workers": 0,


        "merge_cross_page_tables": False,
    },
    "mm": {


        "downsample_mode": "4x",


        "max_slice_nums": 9,
        "image_limit": 36,
    },
    "prompt": {
        "override_mode": "legacy",
        "prompt_map": "",
    },
    "decode": {
        "temperature": 0.01,
        "top_p": 0.001,
        "top_k": 1,
        "repetition_penalty": 1.0,
        "no_repeat_ngram_size": 100,
        "max_tokens_map": {},
    },


    "tts": {
        "enabled": False,
        "n": 4,


        "sampling": {
            "temperature": 0.7,
            "top_p": 0.8,
            "top_k": 20,
        },
        "rm_url": "http://127.0.0.1:8000",


        "rm_input_form": "",
        "timeout_sec": 120,


        "dump_candidates": False,


        "fallback_to_greedy": True,


        "rm_batch": {
            "max_items": 4,
            "max_wait_ms": 50,
        },


        "force_score": False,


        "rm_anchor_min_side": None,


        "adaptive": {
            "enabled": False,


            "tau": 0.98,

            "n_max": None,


            "rounds": [],


            "seed_base": 20260918,
        },
    },
    "logging": {
        "level": "INFO",
        "progress_log_every": 20,
    },
}


ALLOWED_FILE_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff"}


REQUIRED_TTS_SAMPLING_KEYS = ("temperature", "top_k", "top_p")


REQUIRED_ROUND_KEYS = ("temperature", "top_k", "top_p", "min_p")


LEGACY_LAUNCH_KEYS = (
    "model_path",
    "vllm_python",
    "cuda_home",
    "gpu_id",
    "max_num_batched_tokens",
    "gpu_memory_utilization",
    "llama_server_bin",
    "gguf_model_path",
    "mmproj_path",
    "downsample_mode",
    "n_gpu_layers",
    "ctx_size",
    "host",
    "parallel",
    "ollama_bin",
    "ollama_models_dir",
    "modelfile",
    "extra_args",
    "extra_env",
    "wait_ready",
    "startup_sleep_sec",
    "auto_restart_on_engine_dead",
    "max_restart_attempts_per_request",
)


_ENV_REF = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")


_BUILTIN_REF = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")

SDK_DIR = Path(__file__).resolve().parent.parent


def builtin_vars(config_path: Path) -> Dict[str, str]:
    'Resolve SDK, configuration, working, and asset directory variables.'
    return {
        "SDK_DIR": str(SDK_DIR),
        "CONFIG_DIR": str(config_path.parent),
        "CWD": str(Path.cwd()),
        "ASSETS_DIR": os.environ.get("OCR_ASSETS_DIR", "").strip() or str(SDK_DIR.parent),
    }


def _expand_builtins(node: Any, builtins: Dict[str, str]) -> Any:
    if isinstance(node, str):
        return _BUILTIN_REF.sub(lambda m: builtins.get(m.group(1), m.group(0)), node)
    if isinstance(node, dict):
        return {k: _expand_builtins(v, builtins) for k, v in node.items()}
    if isinstance(node, list):
        return [_expand_builtins(v, builtins) for v in node]
    return node


def _expand_env_str(value: str, key_path: str) -> str:
    def _replace(match: re.Match) -> str:
        name, fallback = match.group(1), match.group(2)
        if name in os.environ:
            return os.environ[name]
        if fallback is not None:
            return fallback
        raise ValueError(
            "config '{}' references undefined environment variable ${{{}}}; "
            "export it or give a fallback as ${{{}:-default}}".format(key_path, name, name)
        )

    return _ENV_REF.sub(_replace, value)


def _expand_env(node: Any, key_path: str = "") -> Any:
    if isinstance(node, str):
        return _expand_env_str(node, key_path or "<root>")
    if isinstance(node, dict):
        return {k: _expand_env(v, "{}.{}".format(key_path, k) if key_path else str(k)) for k, v in node.items()}
    if isinstance(node, list):
        return [_expand_env(v, "{}[{}]".format(key_path, i)) for i, v in enumerate(node)]
    return node


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    out = deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def _resolve_path(base_dir: Path, value: str) -> str:
    if not value:
        return ""
    p = Path(value)
    if p.is_absolute():
        return str(p)
    return str((base_dir / p).resolve())


def _validate_tts_sampling(cfg: Dict[str, Any], raw: Dict[str, Any]) -> None:

    if not (cfg.get("tts") or {}).get("enabled"):
        return

    written = (raw.get("tts") or {}).get("sampling")
    written = written if isinstance(written, dict) else {}
    missing = [key for key in REQUIRED_TTS_SAMPLING_KEYS if key not in written]
    if missing:
        effective = dict(cfg["decode"])
        effective.update(cfg["tts"].get("sampling") or {})
        inherited = ", ".join(f"{key}={effective[key]!r}" for key in missing)
        raise ValueError(
            "tts.enabled is true but tts.sampling does not set: {}. "
            "tts.sampling overrides the decode section per key, so an unset key "
            "silently inherits one nobody picked for this run (here: {}) -- "
            "with top_k=1 / top_p=0.001 the sampled candidates come back "
            "identical to the greedy one whatever the temperature. "
            "Set them explicitly (vLLM disables the cutoffs at top_k: 0 / "
            "top_p: 1.0, not -1).".format(", ".join(missing), inherited)
        )

    if "seed" not in written:
        LOGGER.warning(
            "tts.sampling has no seed: vLLM then shares one unseeded param set "
            "across the candidates, so this run cannot be replayed or "
            "cross-checked candidate by candidate."
        )

    _validate_adaptive(cfg)


def _validate_adaptive(cfg: Dict[str, Any]) -> None:

    ad = (cfg.get("tts") or {}).get("adaptive") or {}
    if not ad.get("enabled"):
        return

    rounds = ad.get("rounds")
    if not isinstance(rounds, list) or not rounds:
        raise ValueError(
            "tts.adaptive.enabled 为真但 tts.adaptive.rounds 是空的。"
            "轮次表是自适应重采的全部内容（第 k 轮用什么参数按序号查表），"
            "空表等于没有重采。")

    for idx, spec in enumerate(rounds, start=1):
        if not isinstance(spec, dict):
            raise ValueError("tts.adaptive.rounds[%d] 不是字典：%r" % (idx, spec))
        if idx == 1:


            if spec.get("greedy") is not True:
                raise ValueError(
                    "tts.adaptive.rounds[1] 必须是 {greedy: true}（贪心单候选）。"
                    "第 1 轮若也采样,场景②@n=1 就不再等于场景①,"
                    "那条逐位机检随之失效,离线复算也失去公共前缀。")
            continue
        if spec.get("prefilled"):
            raise ValueError(
                "tts.adaptive.rounds[%d] 标了 prefilled——先验候选只能顶替第 1 轮。"
                "第 2 轮之后的轮次是采样轮,拿先验文本顶替等于白跑一轮:"
                "该文本第 1 轮已入池,跨轮去重后净增 0 个候选。" % idx)
        if spec.get("greedy"):
            raise ValueError(
                "tts.adaptive.rounds[%d] 标了 greedy——贪心只能是第 1 轮。"
                "第 2 轮之后再来一次贪心会采出与第 1 轮逐字相同的文本,"
                "跨轮去重后该轮净增 0 个候选,白花一次 OCR 调用。" % idx)
        missing = [k for k in REQUIRED_ROUND_KEYS if k not in spec]
        if missing:
            raise ValueError(
                "tts.adaptive.rounds[%d] 没写全 %s。tts.sampling 是覆盖式的,"
                "漏写的键会继承 decode 段的贪心值（top_k=1 / top_p=0.001）,"
                "于是这一轮无论 temperature 设多少都采回与贪心相同的文本——"
                "而且不报错。" % (idx, ", ".join(missing)))
        if "n" not in spec:
            raise ValueError(
                "tts.adaptive.rounds[%d] 没写 n（本轮采几个候选）。" % idx)

    n_max = ad.get("n_max")
    if n_max is not None:
        if not isinstance(n_max, int) or n_max < 1:
            raise ValueError("tts.adaptive.n_max 须为 >=1 的整数或 null，实得 %r" % (n_max,))
        if n_max > len(rounds):
            raise ValueError(
                "tts.adaptive.n_max=%d 超过轮次表长度 %d：第 %d 轮没有参数可查。"
                % (n_max, len(rounds), len(rounds) + 1))

    tau = ad.get("tau")
    if not isinstance(tau, (int, float)) or not 0.0 <= float(tau) <= 1.0:
        raise ValueError("tts.adaptive.tau 须为 [0,1] 内的数，实得 %r" % (tau,))


def _validate_config(cfg: Dict[str, Any], raw: Dict[str, Any] | None = None) -> None:
    cfg["engine"]["backend"] = normalize_backend_name(cfg["engine"]["type"])
    validate_engine_config(cfg["engine"])

    input_cfg = cfg["input"]
    has_any_input = bool(input_cfg.get("image_dir") or input_cfg.get("files_dir") or input_cfg.get("file_path"))
    if not has_any_input:
        raise ValueError("At least one of input.image_dir / input.files_dir / input.file_path is required")

    if input_cfg.get("image_dir") and not Path(input_cfg["image_dir"]).exists():
        raise FileNotFoundError(f"input.image_dir not found: {input_cfg['image_dir']}")
    if input_cfg.get("files_dir") and not Path(input_cfg["files_dir"]).exists():
        raise FileNotFoundError(f"input.files_dir not found: {input_cfg['files_dir']}")
    if input_cfg.get("file_path"):
        file_path = Path(input_cfg["file_path"])
        if not file_path.exists():
            raise FileNotFoundError(f"input.file_path not found: {input_cfg['file_path']}")
        if file_path.suffix.lower() not in ALLOWED_FILE_SUFFIXES:
            raise ValueError(f"Unsupported input.file_path suffix: {file_path.suffix}")

    if not cfg["layout"].get("enabled", True):
        raise ValueError("layout.enabled must be true in SDK core pipeline")

    skip_labels = cfg["layout"].get("skip_vlm_labels")
    if skip_labels is not None:
        if isinstance(skip_labels, str) or not isinstance(skip_labels, (list, tuple, set)):
            raise ValueError(
                "layout.skip_vlm_labels must be a list of label names (or null to derive it "
                "from use_chart_recognition / use_seal_recognition / use_ocr_for_image_block), "
                "got %r" % (skip_labels,)
            )
        cleaned = [str(x).strip() for x in skip_labels if str(x).strip()]


        cfg["layout"]["skip_vlm_labels"] = sorted(set(cleaned))

    layout_cls = resolve_layout_provider_class(cfg["layout"])
    cfg["layout"]["provider"] = normalize_layout_provider(cfg["layout"]["provider"])
    layout_cls.validate_config(cfg["layout"])

    server_urls = cfg["engine"].get("server_urls") or []
    cfg["engine"]["server_urls"] = [u.strip() for u in server_urls if isinstance(u, str) and u.strip()]

    if int(cfg["pipeline"].get("max_workers", 1) or 1) <= 0:
        raise ValueError("pipeline.max_workers must be >= 1")
    if int(cfg["pipeline"].get("page_workers", 1) or 1) <= 0:
        raise ValueError("pipeline.page_workers must be >= 1")


    _validate_tts_sampling(cfg, cfg if raw is None else raw)


def load_config(config_path: str, overrides: Dict[str, Any] | None = None) -> Dict[str, Any]:
    path = Path(config_path).resolve()
    with path.open("r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    if overrides:
        raw = _deep_merge(raw, overrides)

    raw = _expand_env(_expand_builtins(raw, builtin_vars(path)))
    ignored_engine_keys = sorted(k for k in LEGACY_LAUNCH_KEYS if k in (raw.get("engine") or {}))
    cfg = _deep_merge(DEFAULT_CONFIG, raw)
    base_dir = path.parent

    if not cfg["run"].get("run_tag"):
        cfg["run"]["run_tag"] = f"minicpmvocr_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    cfg["run"]["run_root"] = _resolve_path(base_dir, cfg["run"]["run_root"])

    cfg["input"]["manifest"] = _resolve_path(base_dir, cfg["input"].get("manifest", ""))
    cfg["input"]["file_path"] = _resolve_path(base_dir, cfg["input"].get("file_path", ""))
    cfg["input"]["image_dir"] = _resolve_path(base_dir, cfg["input"].get("image_dir", ""))
    cfg["input"]["files_dir"] = _resolve_path(base_dir, cfg["input"].get("files_dir", ""))

    cfg["prompt"]["prompt_map"] = _resolve_path(base_dir, cfg["prompt"].get("prompt_map", ""))
    cfg["layout"]["model_dir"] = _resolve_path(base_dir, cfg["layout"].get("model_dir", ""))

    run_dir = Path(cfg["run"]["run_root"]) / cfg["run"]["run_tag"]
    runtime_intermediate_dir = run_dir / "runtime" / "intermediate"
    cfg["_meta"] = {
        "config_path": str(path),
        "run_dir": str(run_dir),
        "runtime_dir": str(run_dir / "runtime"),
        "runtime_intermediate_dir": str(runtime_intermediate_dir),
        "output_dir": str(run_dir / "output"),
        "result_json_dir": str(run_dir / "results_json"),
        "log_dir": str(run_dir / "logs"),
        "active_intermediate_dir": str(runtime_intermediate_dir),

        "ignored_engine_keys": ignored_engine_keys,
    }

    _validate_config(cfg, raw)
    return cfg
