#!/usr/bin/env bash
#
# Install what the renderer needs and report anything it cannot install for you.
#
# The renderer turns candidate OCR text into an image. The model was trained on
# images produced by one specific combination of browser, KaTeX and fonts, so this
# script pins the browser and KaTeX, and then reports on the fonts, which are the
# one part it cannot install for you: fonts come from your operating system. The
# The Docker image pins those; this script tells you whether they are pinned.
#
# Run from anywhere:  bash renderer/setup_renderer.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

say()  { printf '\n==> %s\n' "$*"; }
warn() { printf '\n!!  %s\n' "$*" >&2; }

problems=0

# ---------------------------------------------------------------------------
say "Python packages"
# ---------------------------------------------------------------------------
if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
    warn "Python 3.10 or newer is required (found $(python3 -V 2>&1))."
    problems=$((problems + 1))
fi

# Debian 12, Ubuntu 23.04 and newer mark the system Python "externally managed"
# (PEP 668), so installing into it fails outright. Say so before the pip error,
# because the pip error suggests --break-system-packages, and overwriting the
# system Pillow is a worse outcome than the one it is working around.
if python3 -c 'import sys; raise SystemExit(0 if sys.prefix == sys.base_prefix else 1)' \
   && python3 -c 'import os,sysconfig; raise SystemExit(0 if os.path.exists(os.path.join(sysconfig.get_path("stdlib"), "EXTERNALLY-MANAGED")) else 1)'; then
    warn "This Python is externally managed (PEP 668) and you are not in a
    virtualenv, so pip cannot install into it. Make one first:
      python3 -m venv .venv-render && . .venv-render/bin/activate
      bash renderer/setup_renderer.sh
    Do not reach for --break-system-packages: this script pins Pillow to the
    version the renderer was calibrated on, and forcing that pin onto the system
    Python changes it for everything else on the machine."
    exit 1
fi

python3 -m pip install -r "$ROOT/requirements.txt"

# ---------------------------------------------------------------------------
say "Chromium (via Playwright)"
# ---------------------------------------------------------------------------
# Playwright 1.62.0 ships a specific Chromium build. Pinning the Playwright version
# is how the browser version gets pinned -- there is no separate browser pin.
# --with-deps installs the shared libraries Chromium needs; it needs sudo on Linux
# and is a no-op on macOS. If it fails, plain `playwright install chromium` still
# downloads the browser and the error below tells you which libraries are missing.
#
# Playwright fetches the browser from its own CDN, which PIP_INDEX_URL does not
# cover: a mirror set for pip does nothing here. If that CDN is slow from where you
# are, this single 180 MB file is the longest step in the whole install, so say so
# before starting it rather than after.
if [ -z "${PLAYWRIGHT_DOWNLOAD_HOST:-}" ]; then
    printf 'downloading from the default CDN (cdn.playwright.dev).\n'
    printf 'If that is slow where you are, cancel and set PLAYWRIGHT_DOWNLOAD_HOST\n'
    printf 'to a mirror -- it is the same artefact, and can be 100x faster.\n'
else
    printf 'download host: %s\n' "$PLAYWRIGHT_DOWNLOAD_HOST"
fi
if ! python3 -m playwright install --with-deps chromium; then
    warn "playwright install --with-deps failed; retrying without system deps."
    python3 -m playwright install chromium
    warn "Chromium is installed but its system libraries may be incomplete. If
    rendering produces blank images, install the libraries Playwright listed above."
    problems=$((problems + 1))
fi

# ---------------------------------------------------------------------------
say "Node.js (for the KaTeX precheck)"
# ---------------------------------------------------------------------------
# The precheck stage screens candidates whose LaTeX KaTeX cannot parse. It is the
# only part of the pipeline that needs Node. You can skip it (--no-precheck), but
# then unparsable candidates get scored instead of rejected.
if command -v node >/dev/null 2>&1; then
    printf 'found node %s\n' "$(node --version)"
    if ! node --check "$HERE/precheck/screen_v225_node.js"; then
        warn "The precheck script failed to parse under this Node. It has been tested
    on Node 12 and Node 22; try one of those."
        problems=$((problems + 1))
    fi
else
    warn "node not found. Install Node.js to use the precheck stage (tested on 12, 18
    and 22; your distribution's default is almost certainly fine), or run inference
    with --no-precheck."
    problems=$((problems + 1))
fi

# ---------------------------------------------------------------------------
say "Fonts"
# ---------------------------------------------------------------------------
# KaTeX bundles its own math fonts, so formula glyphs are already reproducible.
# Body text is not: it uses whatever the operating system provides. Chinese and
# Japanese text is the case that actually breaks -- without a CJK font, the browser
# draws replacement boxes and the rendered image is meaningless.
if command -v fc-list >/dev/null 2>&1; then
    cjk_count="$(fc-list :lang=zh 2>/dev/null | wc -l | tr -d ' ')"
    printf 'fontconfig reports %s font(s) covering Chinese\n' "$cjk_count"
    if [ "$cjk_count" -eq 0 ]; then
        warn "No Chinese font found. Install one, for example:
      Debian/Ubuntu:  sudo apt-get install fonts-noto-cjk
      Fedora:         sudo dnf install google-noto-sans-cjk-fonts
    With none at all, Chinese blocks render as empty boxes and score meaninglessly.
    Which CJK font you install matters much less for pixels -- swapping font sets
    moved the bundled references by under half a percent -- but it does decide which
    candidate wins a close block."
        problems=$((problems + 1))
    fi

    # Is this the face set the reference deployment renders with? Reported, not
    # enforced: an unpinned environment scores just as well in aggregate (AUROC is
    # unchanged), it just resolves close blocks differently. Only the pinned one
    # reproduces the reference bytes.
    pin_notes=""
    fc-list 2>/dev/null | grep -qi 'DroidSansFallback' \
        || pin_notes="${pin_notes}      missing: DroidSansFallbackFull (fonts-droid-fallback)\n"
    extra="$(fc-list : family 2>/dev/null | grep -ciE 'WenQuanYi|Unifont|IPA.?Gothic' || true)"
    [ "${extra:-0}" -eq 0 ] \
        || pin_notes="${pin_notes}      present but should not be: WenQuanYi / Unifont / IPAGothic faces\n"
    [ ! -e /etc/fonts/conf.d/10-sub-pixel-rgb.conf ] \
        || pin_notes="${pin_notes}      present but should not be: /etc/fonts/conf.d/10-sub-pixel-rgb.conf\n"
    if [ -z "$pin_notes" ]; then
        printf 'Font environment matches the reference deployment.\n'
    else
        printf 'Font environment differs from the reference deployment:\n'
        printf "$pin_notes"
        printf '    Fine for measuring the model; pin it if you need the reference bytes\n'
        printf '    or the same best-of-N picks. Pin it with sdk/setup_render.sh or serve/Dockerfile.\n'
    fi
elif [ "$(uname -s)" = "Darwin" ]; then
    printf 'macOS: system CJK fonts are present by default (fc-list not installed).\n'
else
    warn "fontconfig (fc-list) not found, cannot check fonts. Make sure a CJK font
    such as Noto Sans CJK is installed."
    problems=$((problems + 1))
fi

# ---------------------------------------------------------------------------
say "Bundled assets"
# ---------------------------------------------------------------------------
katex_dir="$HERE/assets/katex-0.16.47"
for path in "$katex_dir/katex.min.js" "$katex_dir/katex.min.css" "$katex_dir/fonts" \
            "$HERE/render_triple_rm_labels.py" "$HERE/render_module/render_label.py" \
            "$HERE/precheck/screen_v225_node.js"; do
    if [ ! -e "$path" ]; then
        warn "missing: $path"
        problems=$((problems + 1))
    fi
done
printf 'KaTeX 0.16.47 and the render module are in place.\n'

# ---------------------------------------------------------------------------
if [ "$problems" -eq 0 ]; then
    say "Setup complete. Verify the renderer against the bundled references:"
    printf '    python3 renderer/check_renderer.py\n\n'
else
    warn "Setup finished with $problems problem(s) above. Fix them, then run:
    python3 renderer/check_renderer.py"
    exit 1
fi
