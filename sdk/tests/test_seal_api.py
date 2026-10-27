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
from minicpmvocr.prompts import DEFAULT_PROMPT_MAP, get_element_cfg  # noqa: E402

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
            calls["kwargs"] = kwargs
            return {"text": calls.get("reply", "  合同专用章 \n")}

        def health(self):
            return {"reachable": True, "model_match": True, "served": [], "error": None}

    def refuse_layout(*_args, **_kwargs):
        raise AssertionError("印章识别不应借用版面")

    with TestClient(server.app) as test_client:
        monkeypatch.setattr(server, "OCR_SVC", FakeOcr())
        monkeypatch.setattr(server.RUNNER, "acquire", refuse_layout)
        test_client.calls = calls  # type: ignore[attr-defined]
        yield test_client


def test_seal_sends_trained_prompt_and_skips_layout(client):
    elem = get_element_cfg(DEFAULT_PROMPT_MAP, "seal")
    before = {path.name for path in server.JOBS_DIR.iterdir()} if server.JOBS_DIR.exists() else set()
    response = client.post("/api/image-parse", json={"model": "minicpm-ocr-seal", "image": _png(), "upright": True, "page_index": 3})
    assert response.status_code == 200, response.text
    body = response.json()
    assert client.calls["prompt"] == elem["prompt"] == "Seal Recognition:"
    assert client.calls["max_new_tokens"] == elem["max_new_tokens"] == 256
    assert client.calls["slice_nums"] == elem["slice_nums"]
    assert client.calls["image_size"] == (12, 8)
    assert body["choices"][0]["message"]["content"] == "合同专用章"
    block = body["minicpm_ocr"]["blocks"][0]
    assert body["minicpm_ocr"]["mode"] == "seal"
    assert body["minicpm_ocr"]["image_width"] == 12
    assert body["minicpm_ocr"]["image_height"] == 8
    assert block == {
        "order": 0,
        "label": "seal",
        "bbox": [0, 0, 12, 8],
        "regions": [[0, 0, 12, 8]],
        "content": "合同专用章",
        "status": "ok",
    }
    assert "rotation" not in body["minicpm_ocr"]
    assert "score" not in block
    assert "map_ocr_source" not in body
    after = {path.name for path in server.JOBS_DIR.iterdir()} if server.JOBS_DIR.exists() else set()
    assert after == before


def test_empty_seal_text_stays_empty(client):
    client.calls["reply"] = "   \n"
    response = client.post("/api/image-parse", json={"model": "minicpm-ocr-seal", "image": _png()})
    assert response.status_code == 200
    body = response.json()
    assert body["choices"][0]["message"]["content"] == ""
    assert body["minicpm_ocr"]["blocks"][0]["content"] == ""
    assert body["minicpm_ocr"]["blocks"][0]["status"] == "ok"


def test_seal_requires_image_and_reports_recognition_failure(client, monkeypatch):
    missing = client.post("/api/image-parse", json={"model": "minicpm-ocr-seal"})
    assert missing.status_code == 400

    def explode(*_args, **_kwargs):
        raise RuntimeError("vllm down")

    monkeypatch.setattr(server.OCR_SVC, "recognize", explode)
    failed = client.post("/api/image-parse", json={"model": "minicpm-ocr-seal", "image": _png()})
    assert failed.status_code == 500
    assert "识别失败" in failed.json()["error"]


def test_existing_models_keep_their_handlers(client, monkeypatch):
    seen = {}

    def full(body, model):
        seen["full"] = model
        from fastapi.responses import JSONResponse
        return JSONResponse({"model": model, "route": "full"})

    def block(body):
        seen["block"] = True
        from fastapi.responses import JSONResponse
        return JSONResponse({"route": "block"})

    monkeypatch.setattr(server, "_handle_full_page", full)
    monkeypatch.setattr(server, "_handle_rerun_block", block)
    for model in ("minicpm-ocr", "minicpm-ocr-stp", "minicpm-ocr-tts"):
        response = client.post("/api/image-parse", json={"model": model, "image": _png()})
        assert response.status_code == 200
        assert response.json()["route"] == "full"
        assert seen["full"] == model
    block_response = client.post("/api/image-parse", json={"model": "minicpm-ocr-tts-block"})
    assert block_response.status_code == 200
    assert block_response.json()["route"] == "block"
    unknown = client.post("/api/image-parse", json={"model": "minicpm-ocr-unknown"})
    assert unknown.status_code == 400


def test_capabilities_advertise_seal_without_changing_modes(client):
    body = client.get("/api/image-parse/capabilities").json()
    assert body["seal"] is True
    assert body["modes"][0] == "standard"
    assert "seal" not in body["modes"]
