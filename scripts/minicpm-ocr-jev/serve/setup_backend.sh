#!/usr/bin/env bash
#
# Install the forward-pass backend: vLLM, in its own virtual environment.
#
# The backend is kept in a separate environment from the renderer on purpose. The
# renderer pins Pillow to the exact version the model was trained with, because
# that version decides what the rendered image looks like; vLLM only requires
# "pillow>=12.3.0", so a later `pip install -U vllm` in a shared environment would
# happily move Pillow forward and change every score without any error. Two
# environments make that impossible rather than merely discouraged.
#
#   usage: bash serve/setup_backend.sh <venv dir>
#
#   PIP_INDEX_URL=<mirror>  bash serve/setup_backend.sh /opt/venv-vllm
#
# On a slow link to pypi.org this install is the longest step by far -- it pulls
# vLLM, torch and a dozen CUDA wheels, several gigabytes in total. If you have a
# nearby mirror, set PIP_INDEX_URL; it is routinely the difference between minutes
# and hours.
#
set -euo pipefail

VENV="${1:?target virtualenv directory required, e.g. /opt/venv-vllm}"

say()  { printf '\n==> %s\n' "$*"; }
warn() { printf '\n!!  %s\n' "$*" >&2; }

# ---------------------------------------------------------------------------
say "System packages"
# ---------------------------------------------------------------------------
# These cannot be installed from pip, and two of them are needed at *run* time,
# not just at install time: Triton compiles a small CPython extension on the
# first forward pass of every fresh container, so a missing compiler or missing
# Python headers surface minutes into startup -- after the weights have loaded --
# as a bare CalledProcessError. Checking here turns that into one apt line.
missing=()
command -v gcc >/dev/null 2>&1 || missing+=(gcc)
command -v g++ >/dev/null 2>&1 || missing+=(g++)
python3 -c 'import os,sysconfig; raise SystemExit(0 if os.path.exists(sysconfig.get_paths()["include"] + "/Python.h") else 1)' \
    || missing+=(python3-dev)
python3 -c 'import ensurepip' >/dev/null 2>&1 || missing+=(python3-venv)

if [ "${#missing[@]}" -gt 0 ]; then
    warn "missing system packages: ${missing[*]}
    Debian/Ubuntu:  sudo apt-get install -y ${missing[*]}
    Fedora/RHEL:    sudo dnf install -y gcc gcc-c++ python3-devel
    gcc and the Python headers are needed every time the backend starts, not only
    to install it: Triton builds a CPython extension on the first forward pass."
    exit 1
fi
printf 'gcc %s, Python headers present\n' "$(gcc -dumpversion)"

# ---------------------------------------------------------------------------
say "Virtual environment: $VENV"
# ---------------------------------------------------------------------------
if [ ! -x "$VENV/bin/python" ]; then
    python3 -m venv "$VENV"
fi
"$VENV/bin/pip" install -q -U pip setuptools wheel
printf '%s\n' "$("$VENV/bin/python" -V)"

# ---------------------------------------------------------------------------
say "vLLM"
# ---------------------------------------------------------------------------
# Not pinned. The model is an ordinary 2-class sequence classifier on a Qwen3.5-VL
# backbone, so any vLLM that registers Qwen3_5ForConditionalGeneration and supports
# runner="pooling" + convert="classify" serves it. The check below is the real
# requirement; the version number is not.
"$VENV/bin/pip" install vllm

# ---------------------------------------------------------------------------
say "Checking this vLLM can serve the model"
# ---------------------------------------------------------------------------
"$VENV/bin/python" - <<'PY'
import sys
import torch, transformers, vllm
from vllm.model_executor.models.registry import ModelRegistry

print(f"vllm         {vllm.__version__}")
print(f"torch        {torch.__version__} (CUDA {torch.version.cuda})")
print(f"transformers {transformers.__version__}")

arch = "Qwen3_5ForConditionalGeneration"
archs = ModelRegistry.get_supported_archs()
if arch not in archs:
    print(f"\n!!  {arch} is not registered in this vLLM build.", file=sys.stderr)
    print("    This release cannot serve the model. Install a newer vLLM, or build",
          file=sys.stderr)
    print("    from upstream.", file=sys.stderr)
    raise SystemExit(1)
print(f"{arch}  registered")
PY

say "Backend ready. Start it with:"
printf '    PATH=%s/bin:$PATH bash serve/start_vllm.sh <GPU> <port> <model path>\n\n' "$VENV"
