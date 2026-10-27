from copy import deepcopy
import json
from pathlib import Path
import sys

from PIL import Image
import pytest
import yaml

from minicpmvocr import cli
from minicpmvocr.layouts.base import BaseLayoutDetector
from minicpmvocr.layouts import download
from minicpmvocr.pipeline import overlapped, staged


SERVER_URL = "http://localhost:19991"
MODEL_NAME = "test-ocr"


def _set_argv(monkeypatch, arguments):
    monkeypatch.setattr(sys, "argv", [*arguments, "--server-url", SERVER_URL, "--model", MODEL_NAME])


class FakeDetector(BaseLayoutDetector):
    name = "fake"

    def _start(self):
        pass

    def detect(self, images):
        return [[{
            "index": 0, "label": "text", "class_id": 0, "score": 1.0,
            "bbox": [0, 0, image.width, image.height], "polygon": [],
        }] for image in images]


class FakeEngine:
    name = "fake"

    def start(self):
        pass

    def stop(self):
        pass

    def recognize(self, image, prompt, max_new_tokens, slice_nums=None):
        return {"text": "Recognized page.", "output_token_count": 2}


@pytest.fixture
def quickstart(tmp_path, monkeypatch):
    for name in ("OCR_LAYOUT_MODEL_DIR", "OCR_ASSETS_DIR", "OCR_LAYOUT_DEVICE", "VLLM_URL", "OCR_SERVED_NAME", "OCR_INPUT_DIR", "OCR_RUN_ROOT"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(tmp_path)
    def reject_network(*args, **kwargs):
        raise AssertionError("Unexpected network request in CLI test")
    monkeypatch.setattr(download.requests, "get", reject_network)
    Image.new("RGB", (40, 30), "white").save("input.png")
    model = tmp_path / "models/PP-DocLayoutV3_infer"
    model.mkdir(parents=True)
    (model / "inference.pdiparams").write_bytes(b"test-weights")
    (model / "inference.json").write_text("{}")
    (model / "inference.yml").write_text("Global:\n  model_name: PP-DocLayoutV3\n")
    seen = {"configs": [], "layouts": []}

    def build_detector(config):
        seen["layouts"].append(deepcopy(config))
        return FakeDetector(config)

    def build_engine(config):
        seen["configs"].append(deepcopy(config))
        return FakeEngine()

    for module in (staged, overlapped):
        monkeypatch.setattr(module, "create_layout_detector", build_detector)
        monkeypatch.setattr(module, "create_backend", build_engine)
    return tmp_path, model, seen


@pytest.mark.parametrize("device", ["cpu", "cuda:0"])
def test_short_cpu_and_gpu_commands_write_markdown(quickstart, monkeypatch, capsys, device):
    root, model, seen = quickstart
    _set_argv(monkeypatch, ["minicpmvocr", "parse", "input.png", "-o", "result.md", "--device", device])
    assert cli.main() == 0
    assert (root / "result.md").read_text() == "Recognized page."
    cfg = seen["configs"][0]
    assert cfg["layout"]["device"] == device
    assert cfg["layout"]["model_dir"] == str(model)
    assert cfg["engine"]["max_model_len"] == 40960
    assert cfg["engine"]["model_name"] == MODEL_NAME
    assert cfg["engine"]["server_urls"] == [SERVER_URL]
    assert cfg["pipeline"]["max_workers"] == 32
    assert cfg["pipeline"]["merge_cross_page_tables"] is False
    summary = json.loads(capsys.readouterr().out)
    assert summary["pages"] == 1
    assert summary["layout_summary"]["overlapped"] is True


def test_pdf_quickstart_renders_and_exports_all_pages(quickstart, monkeypatch, capsys):
    fitz = pytest.importorskip("fitz")
    root, _, _ = quickstart
    with fitz.open() as doc:
        for _ in range(2):
            doc.new_page(width=72, height=72)
        doc.save(root / "input.pdf")
    _set_argv(monkeypatch, ["minicpmvocr", "parse", "input.pdf", "-o", "result.md", "--device", "cpu"])
    assert cli.main() == 0
    assert (root / "result.md").read_text() == "Recognized page.\n\n<!-- page-break -->\n\nRecognized page."
    assert json.loads(capsys.readouterr().out)["pages"] == 2


def test_no_output_option_writes_only_markdown_to_stdout(quickstart, monkeypatch, capsys):
    _set_argv(monkeypatch, ["minicpmvocr", "parse", "input.png", "--device", "cpu"])
    assert cli.main() == 0
    assert capsys.readouterr().out == "Recognized page.\n"


def test_legacy_flags_and_explicit_config_preserve_values(quickstart, monkeypatch, capsys):
    root, model, seen = quickstart
    config = yaml.safe_load((Path(cli.__file__).parent / "configs/minicpmvocr.yaml").read_text())
    config["layout"].update(model_dir=str(model), device="cpu")
    config["engine"]["max_model_len"] = 12288
    config["pipeline"].update(max_workers=2, overlap_layout=False)
    (root / "custom.yaml").write_text(yaml.safe_dump(config))
    _set_argv(monkeypatch, [
        "minicpmvocr", "parse", "--config", "custom.yaml", "--input", "input.png", "--output", "result.md",
    ])
    assert cli.main() == 0
    assert (root / "result.md").read_text() == "Recognized page."
    cfg = seen["configs"][0]
    assert cfg["engine"]["max_model_len"] == 12288
    assert cfg["pipeline"]["max_workers"] == 2
    assert cfg["pipeline"]["overlap_layout"] is False
    assert "overlapped" not in json.loads(capsys.readouterr().out)["layout_summary"]


def test_explicit_overlap_option_selects_the_overlapped_runner(quickstart, monkeypatch, capsys):
    _, model, _ = quickstart
    _set_argv(monkeypatch, [
        "minicpmvocr", "parse", "--config", str(Path(cli.__file__).parent / "configs/minicpmvocr.yaml"),
        "--input", "input.png", "--output", "result.md", "--layout-model", str(model),
        "--device", "cpu", "--set", "pipeline.overlap_layout=true",
    ])
    assert cli.main() == 0
    assert json.loads(capsys.readouterr().out)["layout_summary"]["overlapped"] is True


def test_options_and_environment_override_quickstart_defaults(quickstart, monkeypatch, capsys):
    root, model, seen = quickstart
    custom_model = root / "custom model"
    model.rename(custom_model)
    monkeypatch.setenv("OCR_LAYOUT_MODEL_DIR", str(custom_model))
    monkeypatch.setenv("OCR_LAYOUT_DEVICE", "cpu")
    monkeypatch.setenv("VLLM_URL", "http://localhost:19001")
    monkeypatch.setenv("OCR_SERVED_NAME", "custom-ocr")
    _set_argv(monkeypatch, [
        "minicpmvocr", "parse", "input.png", "-o", "result.md", "--workers", "3",
        "--set", "pipeline.max_workers=2", "--set", "pipeline.overlap_layout=false",
    ])
    assert cli.main() == 0
    cfg = seen["configs"][0]
    assert cfg["layout"]["device"] == "cpu"
    assert cfg["layout"]["model_dir"] == str(custom_model)
    assert cfg["engine"]["server_url"] == ""
    assert cfg["engine"]["server_urls"] == [SERVER_URL]
    assert cfg["engine"]["model_name"] == MODEL_NAME
    assert cfg["pipeline"]["max_workers"] == 2
    assert cfg["pipeline"]["overlap_layout"] is False


def test_layout_model_option_is_relative_to_working_directory(quickstart, monkeypatch, capsys):
    root, model, seen = quickstart
    custom_model = root / "custom model"
    model.rename(custom_model)
    _set_argv(monkeypatch, [
        "minicpmvocr", "parse", "input.png", "-o", "result.md", "--layout-model", "custom model", "--device", "cpu",
    ])
    assert cli.main() == 0
    assert seen["configs"][0]["layout"]["model_dir"] == str(custom_model)


@pytest.mark.parametrize(("arguments", "message"), [
    (["parse"], "input PDF or image is required"),
    (["parse", "input.png", "--input", "input.png"], "Specify INPUT or --input"),
    (["parse", "."], "must be a PDF or image file"),
    (["parse", "input.png", "--workers", "0"], "must be greater than zero"),
])
def test_invalid_short_commands_report_cli_errors(quickstart, monkeypatch, capsys, arguments, message):
    _set_argv(monkeypatch, ["minicpmvocr", *arguments])
    with pytest.raises(SystemExit) as error:
        cli.main()
    assert error.value.code == 2
    stderr = capsys.readouterr().err
    assert message in stderr
    assert "Traceback" not in stderr


def test_missing_explicit_layout_model_explains_how_to_configure_it(quickstart, monkeypatch, capsys):
    _, model, _ = quickstart
    (model / "inference.pdiparams").unlink()
    _set_argv(monkeypatch, ["minicpmvocr", "parse", "input.png", "--device", "cpu", "--layout-model", str(model)])
    with pytest.raises(SystemExit) as error:
        cli.main()
    assert error.value.code == 2
    stderr = capsys.readouterr().err
    assert "--layout-model DIR" in stderr
    assert "OCR_LAYOUT_MODEL_DIR" in stderr
    assert "Traceback" not in stderr


def test_missing_default_model_is_installed_before_parsing(quickstart, monkeypatch, capsys):
    import hashlib
    import io
    import tarfile

    root, model, _ = quickstart
    files = {name: (model / name).read_bytes() for name in download.MODEL_FILES}
    for name in files:
        (model / name).unlink()
    payload = io.BytesIO()
    with tarfile.open(fileobj=payload, mode="w") as archive:
        for name, content in files.items():
            info = tarfile.TarInfo("PP-DocLayoutV3_infer/" + name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))
    body = payload.getvalue()
    monkeypatch.setattr(download, "LAYOUT_MODEL_SHA256", hashlib.sha256(body).hexdigest())

    class Response:
        headers = {"Content-Length": str(len(body))}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def raise_for_status(self):
            pass

        def iter_content(self, chunk_size):
            yield body

    monkeypatch.setattr(download.requests, "get", lambda *args, **kwargs: Response())
    _set_argv(monkeypatch, ["minicpmvocr", "parse", "input.png", "-o", "result.md", "--device", "cpu"])
    assert cli.main() == 0
    assert download.layout_model_ready(model)
    assert (root / "result.md").read_text() == "Recognized page."
    assert json.loads(capsys.readouterr().out)["pages"] == 1


def test_remote_layout_provider_does_not_download_paddle_weights(quickstart, monkeypatch, capsys):
    _, model, _ = quickstart
    for name in download.MODEL_FILES:
        (model / name).unlink()
    _set_argv(monkeypatch, [
        "minicpmvocr", "parse", "input.png", "-o", "result.md", "--layout", "server",
        "--set", "layout.server_url=http://localhost:8110",
    ])
    assert cli.main() == 0
    assert not download.layout_model_ready(model)
    assert json.loads(capsys.readouterr().out)["pages"] == 1


@pytest.mark.parametrize("filename", ["missing.pdf", "unsupported.docx"])
def test_invalid_input_does_not_trigger_model_download(quickstart, monkeypatch, capsys, filename):
    root, model, _ = quickstart
    for name in download.MODEL_FILES:
        (model / name).unlink()
    if filename.endswith(".docx"):
        (root / filename).touch()
    _set_argv(monkeypatch, ["minicpmvocr", "parse", filename])
    with pytest.raises(SystemExit) as error:
        cli.main()
    assert error.value.code == 2
    assert "Unexpected network request" not in capsys.readouterr().err


@pytest.mark.parametrize(("connection_args", "missing"), [
    ([], ["--server-url", "--model"]),
    (["--server-url", SERVER_URL], ["--model"]),
    (["--model", MODEL_NAME], ["--server-url"]),
])
def test_service_arguments_are_required_even_when_environment_is_set(
    quickstart, monkeypatch, capsys, connection_args, missing,
):
    monkeypatch.setenv("VLLM_URL", "http://localhost:19001")
    monkeypatch.setenv("OCR_SERVED_NAME", "env-ocr")
    monkeypatch.setattr(sys, "argv", ["minicpmvocr", "parse", "input.png", *connection_args])
    with pytest.raises(SystemExit) as error:
        cli.main()
    assert error.value.code == 2
    stderr = capsys.readouterr().err
    assert "required" in stderr
    for flag in missing:
        assert flag in stderr


@pytest.mark.parametrize(("url", "model", "missing"), [
    ("", MODEL_NAME, "--server-url"),
    (SERVER_URL, " ", "--model"),
])
def test_empty_service_arguments_cannot_use_environment_fallback(
    quickstart, monkeypatch, capsys, url, model, missing,
):
    monkeypatch.setenv("VLLM_URL", SERVER_URL)
    monkeypatch.setenv("OCR_SERVED_NAME", MODEL_NAME)
    monkeypatch.setattr(sys, "argv", [
        "minicpmvocr", "parse", "input.png", "--server-url", url, "--model", model,
    ])
    with pytest.raises(SystemExit) as error:
        cli.main()
    assert error.value.code == 2
    assert missing in capsys.readouterr().err


@pytest.mark.parametrize(("engine", "missing"), [
    ({"type": "vllm", "model_name": MODEL_NAME}, "--server-url"),
    ({"type": "vllm", "server_url": SERVER_URL}, "--model"),
])
def test_backend_does_not_invent_service_connection(engine, missing):
    from minicpmvocr import create_backend

    with pytest.raises(ValueError, match=missing):
        create_backend({"engine": engine})


def test_layout_stage_can_run_without_an_inference_connection(quickstart):
    from minicpmvocr import create_backend, load_config

    root, model, seen = quickstart
    config = Path(cli.__file__).parent / "configs/minicpmvocr.yaml"
    cfg = load_config(str(config), {
        "input": {"file_path": str(root / "input.png")},
        "layout": {"model_dir": str(model)},
    })
    assert cfg["engine"]["model_name"] == ""
    assert cfg["engine"]["server_url"] == ""
    staged.parse_layout_run(cfg)
    assert seen["layouts"]
    assert seen["configs"] == []
    with pytest.raises(ValueError, match="--model"):
        create_backend(cfg)
