import importlib
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

SDK = Path(__file__).resolve().parents[1]
PROJECT = SDK.parent


@pytest.fixture
def deployment_env(tmp_path):
    prefixes = ("OCR_", "OCRWEB_", "VLLM_", "OBS_", "RM_", "SDK_")
    env = {key: value for key, value in os.environ.items() if not key.startswith(prefixes)}
    for key in ("BASE_IMAGE", "SERVER_IMAGE", "CLIENT_IMAGE", "SCORE_IMAGE", "IMAGES", "EVAL_REPO"):
        env.pop(key, None)
    env["OCRWEB_DATA_DIR"] = str(tmp_path / "data")
    return env


def test_demo_defaults_follow_checkout(deployment_env, tmp_path):
    result = subprocess.run(
        ["bash", "-c", 'source "$1" webdemo; printf "%s\\n" "$OCRWEB_PYTHON" "$OCR_MODEL_PATH" "$OCR_PAGE_REGISTRY"',
         "test", str(SDK / "scripts/demo_env.sh")],
        cwd=tmp_path, env=deployment_env, capture_output=True, text=True, check=True,
    )
    assert result.stdout.splitlines() == [
        str(PROJECT / ".venv-sdk-gpu/bin/python"),
        str(PROJECT / "models/MiniCPM-OCR"),
        str(tmp_path / "data/page-workers"),
    ]


def test_gateway_preserves_configured_paths_and_port(deployment_env, tmp_path):
    python = tmp_path / "python stub"
    python.write_text('#!/bin/sh\nprintf "%s\\n" "$PWD" "$OCR_LAYOUT_MODEL_DIR" "$OCR_PAGE_REGISTRY" "$@"\n')
    python.chmod(0o755)
    deployment_env.update({
        "OCRWEB_PYTHON": str(python),
        "OCR_ASSETS_DIR": str(tmp_path / "model assets"),
        "OCR_PAGE_REGISTRY": str(tmp_path / "shared registry"),
        "PORT": "19001",
    })
    result = subprocess.run(
        ["bash", str(SDK / "webdemo/start_gateway.sh")], cwd=tmp_path,
        env=deployment_env, capture_output=True, text=True, check=True,
    )
    lines = result.stdout.splitlines()
    assert lines[:3] == [str(SDK / "webdemo"), str(tmp_path / "model assets/PP-DocLayoutV3_infer"), str(tmp_path / "shared registry")]
    assert lines[3:] == ["-s", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "19001", "--workers", "1"]


@pytest.mark.parametrize(("script", "required"), [
    ("webdemo/docker/build.sh", "BASE_IMAGE"),
    ("webdemo/scripts/start_single_gpu.sh", "OCR_IMAGE"),
    ("scripts/eval_omnidocbench_v16_docker.sh", "MODEL_DIR"),
    ("webdemo/start_replica.sh", "OCR_REPLICA_GPUS"),
])
def test_missing_deployment_configuration_fails_before_launch(script, required, deployment_env, tmp_path):
    deployment_env["OCRWEB_PYTHON"] = sys.executable
    result = subprocess.run(
        ["bash", str(SDK / script)], cwd=tmp_path,
        env=deployment_env, capture_output=True, text=True, timeout=5,
    )
    assert result.returncode != 0
    assert required in result.stderr


def test_setup_installs_selected_profile_without_copying_an_environment(deployment_env, tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    uv = bin_dir / "uv"
    uv.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
    uv.chmod(0o755)
    env_dir = tmp_path / "custom env"
    (env_dir / "bin").mkdir(parents=True)
    (env_dir / "bin/python").symlink_to(sys.executable)
    deployment_env.update({
        "PATH": str(bin_dir) + os.pathsep + deployment_env["PATH"],
        "SDK_PROFILE": "sdk-cpu", "OCRWEB_ENV": str(env_dir),
    })
    result = subprocess.run(
        ["bash", str(SDK / "webui/scripts/setup_env.sh")], cwd=tmp_path,
        env=deployment_env, capture_output=True, text=True, check=True,
    )
    assert result.stdout.splitlines()[:11] == [
        "pip", "install", "--python", str(env_dir / "bin/python"),
        "-r", str(PROJECT / "pyproject.toml"), "--extra", "sdk-cpu", "fastapi", "uvicorn", "python-multipart",
    ]


def test_obs_credentials_require_explicit_environment(monkeypatch):
    monkeypatch.syspath_prepend(str(SDK / "webdemo"))
    module = importlib.import_module("obs_jobs")
    monkeypatch.delenv("OBS_AK", raising=False)
    monkeypatch.delenv("OBS_SK", raising=False)
    with pytest.raises(RuntimeError, match="OBS_AK and OBS_SK"):
        module._credentials()


def test_advertise_host_override(monkeypatch):
    monkeypatch.syspath_prepend(str(SDK / "webdemo"))
    monkeypatch.setenv("OCR_ADVERTISE_HOST", "worker.example.com")
    for name in ("page_fleet", "upright_server"):
        assert importlib.import_module(name)._own_ip() == "worker.example.com"


def test_rm_bridge_accepts_environment_configuration(deployment_env, tmp_path):
    deployment_env.update({
        "RM_SCORE_URL": "https://rm.example.com/score",
        "RM_SCORE_USER": "test-user", "RM_SCORE_PASSWORD": "test-password",
        "RM_SCORE_TIMEOUT": "12", "RM_BRIDGE_ENV": str(tmp_path / "absent.env"),
    })
    code = 'import json,runpy,sys; cfg=runpy.run_path(sys.argv[1]); print(json.dumps([cfg["REMOTE"],cfg["TIMEOUT"]]))'
    result = subprocess.run(
        [sys.executable, "-c", code, str(SDK / "webdemo/rm_bridge.py")],
        env=deployment_env, capture_output=True, text=True, check=True,
    )
    assert json.loads(result.stdout) == ["https://rm.example.com/score", 12]


def test_reference_config_uses_configured_service(monkeypatch, tmp_path):
    from minicpmvocr import create_backend, load_config

    monkeypatch.setenv("VLLM_URL", "http://localhost:19009")
    monkeypatch.setenv("OCR_SERVED_NAME", "custom-ocr")
    cfg = load_config(str(SDK / "minicpmvocr/configs/minicpmvocr.yaml"), {
        "input": {"files_dir": str(tmp_path)},
        "layout": {"provider": "ppdoclayout3_server", "server_url": "http://localhost:8110"},
    })
    assert create_backend(cfg).server_urls == ["http://localhost:19009"]
    assert cfg["engine"]["model_name"] == "custom-ocr"


@pytest.mark.parametrize("relative", ["webdemo/model_manager.py", "webui/runner.py"])
def test_demo_request_uses_all_configured_replicas(relative, monkeypatch, tmp_path):
    from minicpmvocr import create_backend, load_config

    monkeypatch.syspath_prepend(str(SDK / "webdemo"))
    monkeypatch.setenv("VLLM_URL", "http://localhost:19009")
    monkeypatch.setenv("VLLM_URLS", "http://localhost:19010, http://localhost:19011")
    monkeypatch.setenv("OCR_SERVED_NAME", "replica-ocr")
    spec = importlib.util.spec_from_file_location("deployment_runner", SDK / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    cfg = load_config(str(SDK / "minicpmvocr/configs/minicpmvocr.yaml"), module._webui_overrides(
        input={"files_dir": str(tmp_path)},
        layout={"provider": "ppdoclayout3_server", "server_url": "http://localhost:8110"},
    ))
    assert create_backend(cfg).server_urls == ["http://localhost:19010", "http://localhost:19011"]
