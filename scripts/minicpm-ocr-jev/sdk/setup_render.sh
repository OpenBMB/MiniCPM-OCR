#!/usr/bin/env bash
#
# Install the renderer for the SDK path: Chromium, Node, KaTeX and the font
# environment, in their own virtual environment.
#
#   usage: bash sdk/setup_render.sh [venv dir]        (default /opt/venv-render)
#
#   PIP_INDEX_URL=https://mirrors.ustc.edu.cn/pypi/simple \
#   PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright \
#       bash sdk/setup_render.sh
#
# Only the render+score service needs this. The score service works on images
# that are already rendered, so a host that runs scoring alone installs none of
# it -- no browser, no Node, no fonts.
#
# What this script is, and is not:
#
#   renderer/setup_renderer.sh already installs the pinned packages and Chromium
#   and reports on the fonts. It is called below rather than reimplemented. What
#   it deliberately does not do is *change* your font environment, because fonts
#   belong to the operating system and it is not that script's place to purge
#   packages. The image route does change them, in serve/Dockerfile. This script
#   is the bare-metal equivalent of that Dockerfile, so it does too -- and that
#   is the whole difference between the two files.
#
# ⚠ Expect a different score here than from the published image. Even
# with the font environment pinned, a self-installed Chromium on a different
# kernel and GPU draws subtly different pixels, and rendered text is model input.
# Rankings hold; the digits after the second decimal place are not promised.
set -euo pipefail

VENV="${1:-/opt/venv-render}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

say()  { printf '\n==> %s\n' "$*"; }
warn() { printf '\n!!  %s\n' "$*" >&2; }

# ---------------------------------------------------------------------------
say "System packages"
# ---------------------------------------------------------------------------
# fonts-noto-cjk is load-bearing, not cosmetic: without a CJK font the browser
# draws replacement boxes, the render is meaningless, and the model scores it as
# a mismatch with nothing to indicate that fonts were the cause.
#
# nodejs is only for the KaTeX precheck. Dropping it costs you the precheck
# stage, not the renderer.
if command -v apt-get >/dev/null 2>&1; then
    if [ "$(id -u)" -ne 0 ] && ! command -v sudo >/dev/null 2>&1; then
        warn "not root and no sudo; skipping apt. Install by hand:
      python3 python3-venv python3-pip nodejs fonts-noto-cjk fontconfig ca-certificates curl"
    else
        SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"
        $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq
        $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
            python3 python3-venv python3-pip \
            nodejs fonts-noto-cjk fontconfig ca-certificates curl
    fi
else
    warn "no apt-get; install python3/venv, nodejs, a CJK font and fontconfig yourself."
fi

# ---------------------------------------------------------------------------
say "Virtual environment: $VENV"
# ---------------------------------------------------------------------------
# Separate from the backend's environment, and this is a hard requirement rather
# than tidiness. The renderer pins Pillow to the exact version the model was
# calibrated on because that version decides what the rendered image looks like;
# vLLM asks only for "pillow>=12.3.0", so one shared environment lets a later
# `pip install -U vllm` move Pillow forward and change every score, silently.
if [ ! -x "$VENV/bin/python" ]; then
    python3 -m venv "$VENV"
fi
"$VENV/bin/pip" install -q -U pip setuptools wheel
export PATH="$VENV/bin:$PATH"
printf '%s\n' "$("$VENV/bin/python" -V)"

# ---------------------------------------------------------------------------
say "Renderer (the material's own installer)"
# ---------------------------------------------------------------------------
# Installs the pinned playwright/Pillow/Markdown, downloads the matching
# Chromium, checks Node and the bundled KaTeX. It reports on fonts; the next
# step is what pins them.
bash "$ROOT/renderer/setup_renderer.sh"

# ---------------------------------------------------------------------------
say "Service dependencies"
# ---------------------------------------------------------------------------
"$VENV/bin/pip" install -q -r "$ROOT/serve/requirements-serve.txt"
"$VENV/bin/pip" install -q -r "$HERE/requirements-score.txt"

# ---------------------------------------------------------------------------
say "Pinning the font environment"
# ---------------------------------------------------------------------------
# This has to come after the Chromium install above, not before: Playwright's
# --with-deps pulls in its own set of fonts and would put the purged packages
# straight back.
#
# Rendered text is model input, so a different face is a different score. The CSS
# stack names three faces -- Noto Sans CJK Regular and Bold, and
# DroidSansFallbackFull -- and fontconfig fills everything else by substitution,
# where the three purged packages outrank the named ones for characters Noto does
# not cover. 10-sub-pixel-rgb.conf tints glyph edges per channel: same shapes,
# different pixels. In the reference deployment, skipping this step left 16.5% of
# blocks ranking a different candidate first, against a 1% floor from simply
# re-running one container.
if command -v apt-get >/dev/null 2>&1 && { [ "$(id -u)" -eq 0 ] || command -v sudo >/dev/null 2>&1; }; then
    SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fonts-droid-fallback
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq \
        fonts-wqy-zenhei fonts-unifont fonts-ipafont-gothic || true
    $SUDO rm -f /etc/fonts/conf.d/10-sub-pixel-rgb.conf
    $SUDO fc-cache -f
    printf 'font environment pinned\n'
else
    warn "cannot change fonts here. Four commands, as root:
      apt-get install -y fonts-droid-fallback
      apt-get purge -y fonts-wqy-zenhei fonts-unifont fonts-ipafont-gothic
      rm -f /etc/fonts/conf.d/10-sub-pixel-rgb.conf
      fc-cache -f
    Without them the renderer still works and still measures the model well; it
    just resolves close blocks differently than the reference deployment."
fi

# ---------------------------------------------------------------------------
say "Checking the renderer"
# ---------------------------------------------------------------------------
"$VENV/bin/python" -c \
    "import sys; sys.path.insert(0, '$ROOT'); import rm_render; \
     rm_render.check_assets(require_node=True); print('renderer assets OK')"

say "Renderer ready. Measure how far this machine drifts from the references:"
printf '    %s/bin/python %s/renderer/check_renderer.py\n' "$VENV" "$ROOT"
printf '  That number is the thing to quote when your scores differ from the\n'
printf '  published ones -- it is the part of the difference that is yours.\n\n'
