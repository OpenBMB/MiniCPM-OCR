#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
profile="${1:-sdk-cpu}"
case "$profile" in
    sdk-cpu|sdk-gpu|transformers|vllm|sglang) env_name="$profile" ;;
    *) echo "Usage: bash scripts/install.sh {sdk-cpu|sdk-gpu|transformers|vllm|sglang}" >&2; exit 2 ;;
esac

command -v uv >/dev/null || { echo "Install uv first: python3 -m pip install uv" >&2; exit 1; }
if [[ "$profile" == vllm || "$profile" == sglang ]]; then
    [[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || {
        echo "The $profile build requires Linux x86_64." >&2; exit 1
    }
    export CC="${CC:-gcc-13}" CXX="${CXX:-g++-13}"
    export CUDAHOSTCXX="${CUDAHOSTCXX:-$CXX}" MAX_JOBS="${MAX_JOBS:-8}"
    command -v "$CC" >/dev/null
    command -v "$CXX" >/dev/null
fi

env_dir="$PWD/.venv-$env_name"
if [[ ! -x "$env_dir/bin/python" ]]; then
    uv venv --python "${OCR_PYTHON:-3.12}" "$env_dir"
fi
install=(uv pip install --python "$env_dir/bin/python" -r pyproject.toml)

prepare_vllm_sources() {
    "$env_dir/bin/python" - <<'PY'
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import tomllib

if not shutil.which("git"):
    raise SystemExit("Install Git first: apt-get install -y git")
with open("pyproject.toml", "rb") as f:
    pins = tomllib.load(f)["tool"]["minicpm-ocr"]["sources"]

pending = []
for name in ("vllm", "transformers"):
    pin = pins[name]
    path = Path("sources") / name
    commit = pin["commit"]
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise SystemExit(f"Expected a full commit SHA for {name} in pyproject.toml")
    if not path.exists() and not path.is_symlink():
        pending.append((path, pin))
        continue
    if path.is_symlink() or not path.is_dir():
        raise SystemExit(f"{path} already exists and is not a source checkout directory; move it aside first.")
    top = subprocess.run(
        ["git", "-C", str(path), "rev-parse", "--show-toplevel"],
        capture_output=True, text=True,
    )
    if top.returncode or Path(top.stdout.strip()).resolve() != path.resolve():
        raise SystemExit(f"{path} already exists but is not its own Git checkout; move it aside first.")
    head = subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()
    if head != commit:
        raise SystemExit(
            f"{path} is at {head}, but this installation requires {commit}. "
            "Save any local work, then check out the required commit or move the directory aside. "
            "No checkout or reset was performed."
        )
    print(f"Reusing {path} at {commit}; local files are retained.", flush=True)

# Validate existing directories before downloading; publish only complete checkouts.
for path, pin in pending:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{path.name}-", dir=path.parent) as temporary:
        checkout = Path(temporary) / "checkout"
        try:
            subprocess.run(["git", "clone", "--no-checkout", pin["repository"], str(checkout)], check=True)
            available = subprocess.run(
                ["git", "-C", str(checkout), "cat-file", "-e", pin["commit"] + "^{commit}"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            if available.returncode:
                subprocess.run(["git", "-C", str(checkout), "fetch", "origin", pin["commit"]], check=True)
            subprocess.run(["git", "-C", str(checkout), "checkout", "--detach", pin["commit"]], check=True)
        except subprocess.CalledProcessError as exc:
            raise SystemExit(f"Could not prepare {path}. Check Git/network access and rerun the installer.") from exc
        if path.exists() or path.is_symlink():
            raise SystemExit(f"{path} appeared during download; keeping it unchanged. Rerun the installer.")
        checkout.rename(path)
    print(f"Prepared {path} at {pin['commit']}.", flush=True)
PY
}

prepare_vllm_transformers() {
    "$env_dir/bin/python" - <<'PY'
import ast
from pathlib import Path
import re

source = Path("sources/transformers/src/transformers/__init__.py")
version = next((
    ast.literal_eval(node.value)
    for node in ast.parse(source.read_text()).body
    if isinstance(node, ast.Assign)
    and any(isinstance(target, ast.Name) and target.id == "__version__" for target in node.targets)
), None)
if not isinstance(version, str) or not version:
    raise SystemExit(f"Cannot read the Transformers version from {source}")

path = Path("sources/vllm/requirements/common.txt")
text = path.read_text()
matches = list(re.finditer(r"(?m)^[ \t]*transformers(?:[ \t]|[<>=!~\[])[^\r\n]*", text))
if len(matches) != 1:
    raise SystemExit(f"Expected one Transformers requirement in {path}; inspect the source version.")
match = matches[0]
requirement, separator, comment = match.group().partition("#")
current = "".join(requirement.split())
if current != "transformers>=5.16.1,<5.21.0" and not re.fullmatch(r"transformers==[^<>=!,;\s]+", current):
    raise SystemExit(f"Unexpected Transformers requirement in {path}: {requirement.strip()}")
replacement = f"transformers == {version}" + (f"  #{comment}" if separator else "")
updated = text[:match.start()] + replacement + text[match.end():]
if updated != text:
    path.write_text(updated)
print(f"vLLM Transformers requirement: == {version}")
PY
}

prepare_cuda() {
    # Adapt the pip CUDA layout for source builds and runtime JIT compilation.
    cuda_dir="$("$env_dir/bin/python" -c 'import sysconfig; print(sysconfig.get_path("purelib") + "/nvidia/cu13")')"
    test -x "$cuda_dir/bin/nvcc" || { echo "Missing nvcc in $cuda_dir/bin" >&2; exit 1; }
    "$env_dir/bin/python" scripts/prepare_cuda_nvcc.py "$cuda_dir"
    mkdir -p "$cuda_dir/nvvm/bin" "$cuda_dir/lib/stubs"
    ln -sfn lib "$cuda_dir/lib64"
    ln -sf "$cuda_dir/bin/cicc" "$cuda_dir/nvvm/bin/cicc"
    ln -sf "$cuda_dir/lib/libcudart.so.13" "$cuda_dir/lib/libcudart.so"
    ln -sf "$cuda_dir/lib/libnvrtc.so.13" "$cuda_dir/lib/libnvrtc.so"
    driver_lib="${OCR_LIBCUDA:-/usr/lib/x86_64-linux-gnu/libcuda.so.1}"
    test -f "$driver_lib" || { echo "Set OCR_LIBCUDA to your libcuda.so.1 path." >&2; exit 1; }
    ln -sf "$driver_lib" "$cuda_dir/lib/stubs/libcuda.so"
    export CUDA_HOME="$cuda_dir" PATH="$env_dir/bin:$cuda_dir/bin:$PATH"
    export FLASHINFER_NVCC="$cuda_dir/bin/nvcc"
}

prepare_sglang_rust() {
    export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
    if ! command -v rustup >/dev/null; then
        echo "Installing rustup for the SGLang Rust toolchain ($RUSTUP_TOOLCHAIN)."
        curl --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 -fsSL https://sh.rustup.rs |
            sh -s -- -y --no-modify-path --profile minimal --default-toolchain none
    fi
    if ! rustup run "$RUSTUP_TOOLCHAIN" rustc --version >/dev/null 2>&1; then
        rustup toolchain install "$RUSTUP_TOOLCHAIN" --profile minimal
    fi
    rustc --version
    cargo --version
}

if [[ "$profile" == vllm ]]; then
    prepare_vllm_sources
    prepare_vllm_transformers
    "${install[@]}" --extra vllm-build
    prepare_cuda
    "${install[@]}" --extra vllm-build --extra vllm --no-build-isolation-package vllm
elif [[ "$profile" == sglang ]]; then
    toolchain_file=sources/sglang/rust/rust-toolchain.toml
    test -f "$toolchain_file" || {
        echo "Clone the SGLang source into sources/sglang first." >&2; exit 1
    }
    if ! command -v protoc >/dev/null || ! protoc --version; then
        echo "Install protoc first: apt-get install -y protobuf-compiler" >&2
        exit 1
    fi
    RUSTUP_TOOLCHAIN="$("$env_dir/bin/python" -c 'import sys, tomllib; print(tomllib.load(open(sys.argv[1], "rb"))["toolchain"]["channel"])' "$toolchain_file")"
    export RUSTUP_TOOLCHAIN
    prepare_sglang_rust
    "${install[@]}" --extra sglang
    prepare_cuda
elif [[ "$profile" == transformers ]]; then
    "${install[@]}" --extra transformers --extra transformers-server
else
    "${install[@]}" --extra "$profile"
fi

uv pip check --python "$env_dir/bin/python"
echo "Installed. Activate with: source $env_dir/bin/activate"
