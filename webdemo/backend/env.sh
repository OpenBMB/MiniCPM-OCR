#!/usr/bin/env bash
# Locations are derived from this file. Models, interpreters, and service
# addresses are supplied by the caller through the environment.

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$BACKEND_DIR/../.." && pwd)"
SDK_DIR="${OCR_SDK_DIR:-$REPO_DIR/sdk}"

export PYTHONNOUSERSITE="${PYTHONNOUSERSITE:-1}"
case ":${PYTHONPATH:-}:" in
  *":$SDK_DIR:"*) ;;
  *) export PYTHONPATH="$SDK_DIR${PYTHONPATH:+:$PYTHONPATH}" ;;
esac

export OCRWEB_DATA_DIR="${OCRWEB_DATA_DIR:-$BACKEND_DIR/data}"
# Unset uses a directory next to this backend. An empty value stays empty
# and means "do not look for remote workers".
if [[ -z "${OCR_UPRIGHT_REGISTRY+x}" ]]; then
  export OCR_UPRIGHT_REGISTRY="$OCRWEB_DATA_DIR/upright-workers"
fi
if [[ -z "${OCR_PAGE_REGISTRY+x}" ]]; then
  export OCR_PAGE_REGISTRY="$OCRWEB_DATA_DIR/page-workers"
fi

if [[ -z "${OCRWEB_PYTHON:-}" ]]; then
  OCRWEB_PYTHON="$(command -v python3 || command -v python || true)"
fi

ocr_require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Set $name before starting." >&2
    exit 1
  fi
}

unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY || true
