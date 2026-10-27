"""Restore NVCC linking stubs omitted from NVIDIA's pip wheel."""

from __future__ import annotations

import hashlib
from importlib.metadata import version
import os
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
import tomllib
from urllib.parse import urlsplit
from urllib.request import urlopen


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    cuda_dir = Path(sys.argv[1])
    stub_dir = cuda_dir / "bin/crt"
    names = ("link.stub", "prelink.stub")
    if all((stub_dir / name).is_file() for name in names):
        return
    if stub_dir.is_symlink():
        raise RuntimeError(f"Incomplete NVCC stub directory is a symlink: {stub_dir}")

    root = Path(__file__).resolve().parent.parent
    with (root / "pyproject.toml").open("rb") as stream:
        source = tomllib.load(stream)["tool"]["minicpm-ocr"]["cuda-nvcc"]
    nvcc_version = version("nvidia-cuda-nvcc")
    filename = Path(urlsplit(source["url"]).path).name
    if filename != f"cuda_nvcc-linux-x86_64-{nvcc_version}-archive.tar.xz":
        raise RuntimeError("The NVCC redistribution in pyproject.toml must match nvidia-cuda-nvcc.")

    cache = Path(os.environ.get("UV_CACHE_DIR", Path.home() / ".cache/uv")) / "minicpm-ocr"
    cache.mkdir(parents=True, exist_ok=True)
    archive_path = cache / filename
    if not archive_path.is_file() or sha256(archive_path) != source["sha256"]:
        print(f"Downloading matching NVCC linking stubs from NVIDIA ({nvcc_version}).", flush=True)
        with tempfile.NamedTemporaryFile(dir=cache, delete=False) as output:
            temporary_path = Path(output.name)
            try:
                with urlopen(source["url"], timeout=30) as response:
                    shutil.copyfileobj(response, output)
                output.flush()
                if sha256(temporary_path) != source["sha256"]:
                    raise RuntimeError("NVIDIA NVCC archive SHA-256 verification failed.")
                temporary_path.replace(archive_path)
            finally:
                temporary_path.unlink(missing_ok=True)

    stub_dir.mkdir(parents=True, exist_ok=True)
    prefix = f"cuda_nvcc-linux-x86_64-{nvcc_version}-archive/bin/crt"
    with tarfile.open(archive_path, "r:xz") as archive:
        for name in names:
            target = stub_dir / name
            if target.is_file():
                continue
            member = archive.getmember(f"{prefix}/{name}")
            if not member.isfile():
                raise RuntimeError(f"Expected a regular file in NVCC archive: {member.name}")
            with archive.extractfile(member) as source_file, target.open("xb") as output:
                shutil.copyfileobj(source_file, output)
    print(f"NVCC linking stubs ready: {stub_dir}", flush=True)


if __name__ == "__main__":
    main()
