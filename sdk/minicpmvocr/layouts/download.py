from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile
import tempfile

import requests
import yaml

from ..constants import CONFIG_FILENAME, MODEL_NAME, PARAMS_FILENAME


LAYOUT_MODEL_URL = (
    "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/"
    "paddle3.0.0/PP-DocLayoutV3_infer.tar"
)
LAYOUT_MODEL_SHA256 = "98b9bac88c80f6bc0fda7e0bfc2cae180020371c0b2edbb1eb498a70ace751b1"
MODEL_FILES = (PARAMS_FILENAME, "inference.json", CONFIG_FILENAME)
_INSTALL_MARKER = ".minicpmvocr-installing"


def layout_model_ready(directory: Path) -> bool:
    return not (directory / _INSTALL_MARKER).exists() and all(
        (directory / name).is_file() and (directory / name).stat().st_size > 0
        for name in MODEL_FILES
    )


@contextmanager
def _model_lock(path: Path):
    with path.open("a+b") as handle:
        if os.name == "nt":
            import msvcrt

            if handle.tell() == 0:
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _download_archive(archive: Path) -> str:
    checksum = hashlib.sha256()
    downloaded = 0
    try:
        with requests.get(LAYOUT_MODEL_URL, stream=True, timeout=(10, 120)) as response:
            response.raise_for_status()
            with archive.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        handle.write(chunk)
                        checksum.update(chunk)
                        downloaded += len(chunk)
            expected_size = response.headers.get("Content-Length")
            if expected_size is not None and downloaded != int(expected_size):
                raise OSError("Incomplete PP-DocLayoutV3 download; run the command again to retry")
    except requests.RequestException as exc:
        raise OSError(f"Cannot download PP-DocLayoutV3 from {LAYOUT_MODEL_URL}: {exc}") from exc
    digest = checksum.hexdigest()
    if LAYOUT_MODEL_SHA256 and digest != LAYOUT_MODEL_SHA256:
        raise OSError("PP-DocLayoutV3 archive checksum mismatch; existing model files were preserved")
    return digest


def _unpack_model(archive: Path, destination: Path) -> None:
    found = set()
    try:
        with tarfile.open(archive) as source:
            for member in source:
                path = PurePosixPath(member.name)
                if path.is_absolute() or ".." in path.parts or "\\" in member.name:
                    raise OSError("Unsafe path in PP-DocLayoutV3 model archive")
                if not member.isfile() and not member.isdir():
                    raise OSError("Unsupported entry in PP-DocLayoutV3 model archive")
                parts = path.parts
                if len(parts) == 2 and parts[0] == "PP-DocLayoutV3_infer":
                    name = parts[1]
                elif len(parts) == 1:
                    name = parts[0]
                else:
                    continue
                if name not in MODEL_FILES or member.isdir():
                    continue
                if name in found or member.size <= 0:
                    raise OSError(f"Invalid model file in PP-DocLayoutV3 archive: {name}")
                found.add(name)
                with source.extractfile(member) as incoming, (destination / name).open("wb") as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
    except tarfile.TarError as exc:
        raise OSError("Invalid PP-DocLayoutV3 model archive") from exc
    if found != set(MODEL_FILES):
        raise OSError("PP-DocLayoutV3 archive is missing required inference files")
    try:
        config = yaml.safe_load((destination / CONFIG_FILENAME).read_text(encoding="utf-8")) or {}
        if (config.get("Global") or {}).get("model_name") != MODEL_NAME:
            raise OSError("Downloaded layout model is not PP-DocLayoutV3")
        with (destination / "inference.json").open(encoding="utf-8") as handle:
            json.load(handle)
    except (yaml.YAMLError, ValueError, AttributeError) as exc:
        raise OSError("Invalid PP-DocLayoutV3 inference configuration") from exc


def ensure_layout_model(directory: Path) -> Path:
    """Reuse or install the official PP-DocLayoutV3 Paddle inference model."""
    directory = directory.expanduser().resolve()
    if directory.exists() and not directory.is_dir():
        raise NotADirectoryError(f"Layout model path is not a directory: {directory}")
    if layout_model_ready(directory):
        return directory
    directory.parent.mkdir(parents=True, exist_ok=True)
    with _model_lock(directory.parent / f".{directory.name}.lock"):
        if layout_model_ready(directory):
            return directory
        print(f"Downloading PP-DocLayoutV3 layout model to {directory} ...", file=sys.stderr, flush=True)
        with tempfile.TemporaryDirectory(prefix=f".{directory.name}-", dir=directory.parent) as work:
            work = Path(work)
            archive = work / "model.tar"
            digest = _download_archive(archive)
            staged = work / "model"
            staged.mkdir()
            _unpack_model(archive, staged)
            directory.mkdir(exist_ok=True)
            marker = directory / _INSTALL_MARKER
            marker.touch()
            for name in MODEL_FILES:
                os.replace(staged / name, directory / name)
            metadata = {
                "model": MODEL_NAME,
                "source": LAYOUT_MODEL_URL,
                "archive_sha256": digest,
            }
            metadata_path = work / "model-source.json"
            metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
            os.replace(metadata_path, directory / ".minicpmvocr-model.json")
            marker.unlink()
    return directory
