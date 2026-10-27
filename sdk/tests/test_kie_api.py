import base64
import io
import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "webdemo"))

import server  # noqa: E402

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402


def _png(width=12, height=8, color=(180, 20, 20)) -> str:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


@pytest.fixture
def client(monkeypatch):
    calls = {}

    class FakeOcr:
        def recognize(self, image, prompt, max_new_tokens=4096, slice_nums=None, **kwargs):
            calls["image_size"] = image.size
            calls["prompt"] = prompt
            calls["max_new_tokens"] = max_new_tokens
            calls["slice_nums"] = slice_nums
            return {"text": calls.get("reply", '```json\n{"店名": "KEDAI"}\n```')}

        def health(self):
            return {"reachable": True, "model_match": True, "served": [], "error": None}

    def refuse_layout(*_args, **_kwargs):
        raise AssertionError("关键信息抽取不应借用版面")

    with TestClient(server.app) as test_client:
        monkeypatch.setattr(server, "OCR_SVC", FakeOcr())
        monkeypatch.setattr(server.RUNNER, "acquire", refuse_layout)
        test_client.calls = calls  # type: ignore[attr-defined]
        yield test_client


def test_kie_builds_prompt_and_strips_fence(client):
    before = {path.name for path in server.JOBS_DIR.iterdir()} if server.JOBS_DIR.exists() else set()
    response = client.post(
        "/api/image-parse",
        json={"model": "minicpm-ocr-kie", "image": _png(), "fields": [" 店名 ", "金额"], "upright": True},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    prompt = 'Extract the "店名", "金额". Format the output as a JSON object with keys: "店名", "金额". If an item is not in the image, use "###".'
    assert client.calls["prompt"] == prompt
    assert client.calls["max_new_tokens"] == 1024
    assert client.calls["image_size"] == (12, 8)
    assert body["choices"][0]["message"]["content"] == '{"店名": "KEDAI"}'
    assert body["minicpm_ocr"]["mode"] == "kie"
    assert body["minicpm_ocr"]["prompt"] == prompt
    assert body["minicpm_ocr"]["fields"] == ["店名", "金额"]
    assert body["minicpm_ocr"]["blocks"][0]["content"] == '{"店名": "KEDAI"}'
    assert body["minicpm_ocr"]["blocks"][0]["status"] == "ok"
    assert "rotation" not in body["minicpm_ocr"]
    assert "map_ocr_source" not in body
    after = {path.name for path in server.JOBS_DIR.iterdir()} if server.JOBS_DIR.exists() else set()
    assert after == before


def test_kie_rejects_bad_fields(client):
    image = _png()
    missing = client.post("/api/image-parse", json={"model": "minicpm-ocr-kie", "image": image})
    assert missing.status_code == 400
    blank = client.post("/api/image-parse", json={"model": "minicpm-ocr-kie", "image": image, "fields": ["  "]})
    assert blank.status_code == 400
    quoted = client.post("/api/image-parse", json={"model": "minicpm-ocr-kie", "image": image, "fields": ['店"名']})
    assert quoted.status_code == 400
    duplicate = client.post("/api/image-parse", json={"model": "minicpm-ocr-kie", "image": image, "fields": ["金额", "金额"]})
    assert duplicate.status_code == 400
    too_many = client.post(
        "/api/image-parse",
        json={"model": "minicpm-ocr-kie", "image": image, "fields": [f"f{i}" for i in range(21)]},
    )
    assert too_many.status_code == 400
    assert client.calls == {}


def test_kie_reports_recognition_failure(client, monkeypatch):
    def explode(*_args, **_kwargs):
        raise RuntimeError("vllm down")

    monkeypatch.setattr(server.OCR_SVC, "recognize", explode)
    failed = client.post("/api/image-parse", json={"model": "minicpm-ocr-kie", "image": _png(), "fields": ["金额"]})
    assert failed.status_code == 500
    assert "识别失败" in failed.json()["error"]


def test_capabilities_advertise_kie_without_changing_modes(client):
    body = client.get("/api/image-parse/capabilities").json()
    assert body["kie"] is True
    assert body["seal"] is True
    assert "kie" not in body["modes"]
