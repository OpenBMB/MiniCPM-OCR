from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict

import pytest
import yaml

SDK_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SDK_DIR))

from minicpmvocr.backends.dialects import CropRequest, build_vllm_payload  # noqa: E402
from minicpmvocr.config import DEFAULT_CONFIG, _deep_merge, load_config  # noqa: E402


BASE_CONFIG: Dict[str, Any] = {
    "run": {"run_tag": "tts_contract", "run_root": "./runs"},
    "engine": {
        "type": "vllm",
        "model_name": "minicpm-v5",
        "server_urls": ["http://127.0.0.1:18509"],
    },
    "layout": {"model_dir": "", "device": "cuda:0"},
    "pipeline": {"max_workers": 4},
}

FULL_SAMPLING = {"temperature": 1.0, "top_k": 0, "top_p": 1.0, "min_p": 0, "seed": 20260911}


def write_config(tmp_path: Path, tts: Dict[str, Any] | None) -> Path:
    cfg = {**BASE_CONFIG, "input": {"image_dir": str(tmp_path)}}
    if tts is not None:
        cfg["tts"] = tts
    path = tmp_path / "config.yaml"
    path.write_text(yaml.safe_dump(cfg), encoding="utf-8")
    return path


@pytest.fixture(autouse=True)
def stub_layout(monkeypatch):

    import minicpmvocr.config as config_module

    class _AnyLayout:
        @staticmethod
        def validate_config(_cfg):
            return None

    monkeypatch.setattr(config_module, "resolve_layout_provider_class", lambda _cfg: _AnyLayout)


@pytest.mark.parametrize(
    "sampling",
    [
        pytest.param({"temperature": 1.0}, id="temperature_only"),
        pytest.param({"temperature": 1.0, "top_p": 1.0}, id="no_top_k"),
        pytest.param({}, id="empty"),
        pytest.param(None, id="null"),
    ],
)
def test_incomplete_sampling_is_refused(tmp_path, sampling):
    path = write_config(tmp_path, {"enabled": True, "n": 8, "sampling": sampling})
    with pytest.raises(ValueError, match="tts.sampling"):
        load_config(str(path))


def test_missing_sampling_section_is_refused(tmp_path):
    path = write_config(tmp_path, {"enabled": True, "n": 8})
    with pytest.raises(ValueError, match="tts.sampling"):
        load_config(str(path))


def test_explicit_sampling_loads(tmp_path):
    path = write_config(tmp_path, {"enabled": True, "n": 8, "sampling": dict(FULL_SAMPLING)})
    cfg = load_config(str(path))
    assert cfg["tts"]["sampling"] == FULL_SAMPLING


def test_sampling_is_not_required_when_tts_is_off(tmp_path):
    path = write_config(tmp_path, {"enabled": False, "n": 8})
    assert load_config(str(path))["tts"]["enabled"] is False


def test_cli_override_counts_as_explicit(tmp_path):

    path = write_config(tmp_path, {"enabled": True, "n": 8})
    cfg = load_config(str(path), overrides={"tts": {"sampling": dict(FULL_SAMPLING)}})
    assert cfg["tts"]["sampling"]["top_k"] == 0


def test_seed_omission_warns_but_loads(tmp_path, caplog):
    sampling = {k: v for k, v in FULL_SAMPLING.items() if k != "seed"}
    path = write_config(tmp_path, {"enabled": True, "n": 8, "sampling": sampling})
    with caplog.at_level("WARNING"):
        load_config(str(path))
    assert "seed" in caplog.text


def _payload_sampling(sampling: Dict[str, Any] | None) -> Dict[str, Any]:
    cfg = _deep_merge(DEFAULT_CONFIG, {"tts": {"enabled": True, "sampling": sampling}})
    req = CropRequest(image_b64="Zm9v", prompt="p", max_tokens=16,
                      decode_overrides=dict(cfg["tts"]["sampling"] or {}), n=7)
    payload = build_vllm_payload(req, cfg["engine"], cfg["mm"], cfg["decode"])
    return {key: payload[key] for key in ("temperature", "top_k", "top_p")}


def test_unset_keys_reach_the_engine_as_something_nobody_chose():


    assert _payload_sampling(None) == {"temperature": 0.01, "top_k": 1, "top_p": 0.001}


    assert _payload_sampling({"temperature": 1.0}) == {"temperature": 1.0, "top_k": 20, "top_p": 0.8}
