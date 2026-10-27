from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import tarfile
import time

import pytest
import requests

from minicpmvocr.layouts import download


FILES = {
    "inference.pdiparams": b"test-model-weights",
    "inference.json": b'{"model": "test"}',
    "inference.yml": b"Global:\n  model_name: PP-DocLayoutV3\n",
}


def model_archive(files=None, extra=None):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as archive:
        for name, content in (FILES if files is None else files).items():
            info = tarfile.TarInfo("PP-DocLayoutV3_infer/" + name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))
        if extra is not None:
            info, content = extra
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content) if info.isfile() else None)
    return output.getvalue()


@pytest.fixture
def remote(monkeypatch):
    state = {"body": model_archive(), "calls": [], "failure": None, "size": None, "delay": 0}

    class Response:
        @property
        def headers(self):
            size = len(state["body"]) if state["size"] is None else state["size"]
            return {"Content-Length": str(size)}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def raise_for_status(self):
            pass

        def iter_content(self, chunk_size):
            time.sleep(state["delay"])
            yield state["body"][:100]
            if state["failure"]:
                raise state["failure"]
            yield state["body"][100:]

    def get(url, **kwargs):
        state["calls"].append(url)
        assert kwargs["stream"] is True
        return Response()

    monkeypatch.setattr(download.requests, "get", get)
    monkeypatch.setattr(download, "LAYOUT_MODEL_SHA256", hashlib.sha256(state["body"]).hexdigest())
    return state


def write_local(directory, files=None):
    directory.mkdir(parents=True, exist_ok=True)
    for name, content in (FILES if files is None else files).items():
        (directory / name).write_bytes(content)


def test_complete_local_model_is_reused_without_network(tmp_path, remote):
    model = tmp_path / "models/PP-DocLayoutV3_infer"
    write_local(model)
    assert download.ensure_layout_model(model) == model
    assert remote["calls"] == []


def test_download_installs_all_files_and_records_source(tmp_path, remote):
    model = tmp_path / "models/PP-DocLayoutV3_infer"
    assert download.ensure_layout_model(model) == model
    assert {name: (model / name).read_bytes() for name in FILES} == FILES
    metadata = json.loads((model / ".minicpmvocr-model.json").read_text())
    assert metadata["source"] == download.LAYOUT_MODEL_URL
    assert metadata["archive_sha256"] == hashlib.sha256(remote["body"]).hexdigest()
    assert remote["calls"] == [download.LAYOUT_MODEL_URL]
    assert download.layout_model_ready(model)
    assert download.ensure_layout_model(model) == model
    assert len(remote["calls"]) == 1


def test_partial_model_is_repaired_and_other_files_are_preserved(tmp_path, remote):
    model = tmp_path / "models/PP-DocLayoutV3_infer"
    write_local(model, {"inference.pdiparams": b"partial"})
    (model / "notes.txt").write_text("keep this file")
    download.ensure_layout_model(model)
    assert download.layout_model_ready(model)
    assert (model / "inference.pdiparams").read_bytes() == FILES["inference.pdiparams"]
    assert (model / "notes.txt").read_text() == "keep this file"


def test_interrupted_download_keeps_existing_files_and_cleans_staging(tmp_path, remote):
    model = tmp_path / "PP-DocLayoutV3_infer"
    write_local(model, {"inference.pdiparams": b"partial"})
    remote["failure"] = requests.ConnectionError("interrupted")
    with pytest.raises(OSError, match="Cannot download"):
        download.ensure_layout_model(model)
    assert (model / "inference.pdiparams").read_bytes() == b"partial"
    assert not (model / "inference.json").exists()
    assert not list(tmp_path.glob(".PP-DocLayoutV3_infer-*"))


@pytest.mark.parametrize("failure", ["size", "checksum"])
def test_invalid_download_is_not_installed(tmp_path, remote, monkeypatch, failure):
    model = tmp_path / "PP-DocLayoutV3_infer"
    if failure == "size":
        remote["size"] = len(remote["body"]) + 100
    else:
        monkeypatch.setattr(download, "LAYOUT_MODEL_SHA256", "0" * 64)
    with pytest.raises(OSError):
        download.ensure_layout_model(model)
    assert not model.exists()
    assert not list(tmp_path.glob(".PP-DocLayoutV3_infer-*"))


@pytest.mark.parametrize("problem", ["missing", "wrong-model", "invalid-json", "traversal", "symlink"])
def test_invalid_archive_is_rejected_before_installation(tmp_path, remote, monkeypatch, problem):
    files = dict(FILES)
    extra = None
    if problem == "missing":
        files.pop("inference.json")
    elif problem == "wrong-model":
        files["inference.yml"] = b"Global:\n  model_name: another-model\n"
    elif problem == "invalid-json":
        files["inference.json"] = b"not json"
    elif problem == "traversal":
        extra = (tarfile.TarInfo("../../escape.txt"), b"escape")
    else:
        info = tarfile.TarInfo("PP-DocLayoutV3_infer/link")
        info.type = tarfile.SYMTYPE
        info.linkname = "../../escape.txt"
        extra = (info, b"")
    remote["body"] = model_archive(files, extra)
    monkeypatch.setattr(download, "LAYOUT_MODEL_SHA256", hashlib.sha256(remote["body"]).hexdigest())
    model = tmp_path / "PP-DocLayoutV3_infer"
    with pytest.raises(OSError):
        download.ensure_layout_model(model)
    assert not model.exists()
    assert not (tmp_path.parent / "escape.txt").exists()


def test_interrupted_installation_is_retried(tmp_path, remote, monkeypatch):
    model = tmp_path / "PP-DocLayoutV3_infer"
    replace = download.os.replace

    def interrupted(source, destination):
        if Path(destination).name == "inference.json":
            raise OSError("interrupted installation")
        replace(source, destination)

    monkeypatch.setattr(download.os, "replace", interrupted)
    with pytest.raises(OSError, match="interrupted installation"):
        download.ensure_layout_model(model)
    assert not download.layout_model_ready(model)
    monkeypatch.setattr(download.os, "replace", replace)
    download.ensure_layout_model(model)
    assert download.layout_model_ready(model)
    assert len(remote["calls"]) == 2


def test_concurrent_callers_download_once(tmp_path, remote):
    model = tmp_path / "models/PP-DocLayoutV3_infer"
    remote["delay"] = 0.05
    with ThreadPoolExecutor(max_workers=4) as workers:
        results = list(workers.map(download.ensure_layout_model, [model] * 4))
    assert results == [model] * 4
    assert len(remote["calls"]) == 1
    assert download.layout_model_ready(model)
