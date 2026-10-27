#!/usr/bin/env python3
"""OCR label / text rendering utilities.

This module turns OCR output (Markdown, HTML or LaTeX) into PIL images so the
result can be compared visually against the source page image. The caller
supplies a Playwright browser context; all rasterisation happens in headless
Chromium.

Pipeline (see RENDER_PIPELINE_VERSION below)
--------------------------------------------
* One route for all three candidate classes. Plain text, tables and formulas
  are all rendered in the browser with KaTeX; there is no separate LaTeX /
  pdflatex route.
* KaTeX is pinned to KATEX_PINNED_VERSION (0.16.47): that is the version the
  annotation standard was produced with, and since a candidate is judged by
  whether KaTeX accepts it, the renderer has to use the same version as the
  labels. Asset lookup lives in _find_katex_assets / _KATEX_ASSET_DIR_CANDIDATES
  (the KATEX_ASSET_DIR environment variable overrides the bundled assets).
* Delimiter handling is a single left-to-right pass (_protect_math ->
  _split_math_spans). Converting in two passes is wrong: if a caller
  pre-converts `$...$` to `\\(...\\)` and this module then re-scans the text, a
  remaining currency `$` can pull an already-converted `\\(` into a new math
  span and manufacture a ParseError that the reference renderer never sees.
  Callers must therefore pass the raw text and let this module do the scanning.
* Math spans are rendered one by one with a direct katex.render call
  (_render_math_in_page) instead of KaTeX's auto-render. auto-render balances
  braces while pairing delimiters (and gives up on a span with unbalanced
  braces, printing it literally), which does not match the reference markdown
  renderer: that one pairs without counting braces and lets KaTeX raise a
  ParseError. Rendering span by span also avoids a second round of delimiter
  pairing between the restored wrapper and any `$` inside the span.
* throwOnError is true and the raised message is displayed: in the reference
  renderer both undefined commands and structural errors surface as an error
  message, there is no "render the rest and show the bad fragment in red".
* Error handling splits in two. If the page ends up with a `.katex-error`
  (a ParseError) and collect_errors=True, the rendered image becomes a picture
  of the error text itself. Without a ParseError the real markdown rendering is
  always emitted - literal commands and stray delimiters are shown as-is - and
  correctness is decided by comparing the rendered image with the source image.
* formula mode does not apply the HTML-boundary exemption used for the other
  classes: inside a formula candidate `<` and `>` are math symbols, not tags.
  A formula candidate with no delimiter at all is wrapped in `$$ ... $$` and
  rendered as a single display block.
* formula candidates are captured at a higher device_scale_factor than text and
  tables (see DEVICE_SCALE_FACTOR_BY_CLASS for the arithmetic): KaTeX applies
  `.katex {font-size: 1.21em}`, so at DPR 2 formula ink is noticeably smaller
  per em than the LaTeX-based rendering this pipeline replaced, and the formula
  factor compensates so formula images stay equally legible.
* Markdown quirks that are deliberately handled here: `N.` at the start of a
  line is escaped so OCR'd text is not renumbered as an ordered list, and runs
  of three or more underscores (fill-in-the-blank rules) are escaped character
  by character so Python-Markdown's legacy emphasis does not eat them.
"""

from __future__ import annotations

import base64
import html as html_lib
import io
import os
import re
from pathlib import Path
from typing import Any, Callable

import markdown as md_lib
from PIL import Image, ImageChops


_MATH_PLACEHOLDER = "\x00MATH_%d\x00"
# Delimiters are scanned left to right in a single pass, in KaTeX auto-render's
# order ($$ MUST come before $, otherwise a display span is split into two
# empty inline ones).
# Tuple layout: (left, right, is_display, allow_newline)
_MATH_DELIMS: tuple[tuple[str, str, bool, bool], ...] = (
    ("$$", "$$", True, True),
    ("\\[", "\\]", True, True),
    ("\\(", "\\)", False, True),
    ("$", "$", False, False),
)
_FORMULA_PLAYWRIGHT_ONLY_RE = re.compile(
    r"[\u2460-\u24ff\u2776-\u2793\u3251-\u32bf\U0001f100-\U0001f2ff]"
)
_KATEX_WOFF2_URL_RE = re.compile(
    r"url\((?P<quote>['\"]?)(?P<path>fonts/[^)'\"]+\.woff2)(?P=quote)\)"
)
_HTML_BOUNDARY_IN_MATH_RE = re.compile(
    r"(?:<\s*/?\s*[A-Za-z][A-Za-z0-9:-]*(?:\s+[^<>]*)?\s*/?\s*>|"
    r"&lt;\s*/?\s*[A-Za-z][A-Za-z0-9:-]*(?:\s+[^&<>]*)?\s*/?\s*&gt;)",
    re.I,
)
# Heuristics that exclude currency amounts from single-$ math spans. The driver
# script (render_triple_rm_labels.py) keeps an identical copy of these rules, so
# both sides agree on what counts as math.
_STRONG_MATH_RE = re.compile(
    r"(\\|[_^{}=<>+*/]|[A-Za-z]\s*'+\s*(?:\(|[A-Za-z0-9])|"
    r"\b(?:alpha|beta|gamma|theta|lambda|mu|pi|sigma|omega|sqrt|frac|sum|int|"
    r"lfloor|rfloor|mathrm|mathbb|operatorname|begin|end|times|cdot|leq|geq|pmod)\b)"
)
_SIMPLE_MATH_IDENT_RE = re.compile(r"[A-Za-z][A-Za-z0-9]*(?:\s*[,;]\s*[A-Za-z][A-Za-z0-9]*)*")
_PROSE_WORD_RE = re.compile(r"\b(?:or|and|in|by|with|for|to|from|of|the|a|an)\b", re.I)
_KATEX_ASSET_DIR_CANDIDATES = (
    # KaTeX assets bundled with this package, pinned to KATEX_PINNED_VERSION.
    # Resolved relative to this file so a source checkout and an installed copy
    # behave the same. KATEX_ASSET_DIR (handled in _find_katex_assets) takes
    # precedence over this list.
    Path(__file__).resolve().parent.parent / "assets" / "katex-0.16.47",
)
RENDER_PIPELINE_VERSION = "v8.5"
KATEX_PINNED_VERSION = "0.16.47"
# device_scale_factor is chosen per candidate class rather than once for a shared
# browser context; the policy lives here and the driver only reads a value for
# the context it builds. Measured rationale:
#   * formula: at DPR 2 the formula ink height was only 0.658 of the LaTeX
#     rendering this pipeline replaced (xelatex 12pt at 400 DPI), because KaTeX
#     ships `.katex {font-size: 1.21em}`: 18 * 1.21 * 2 = 43.6 px/em against
#     66.7 px/em. 2 / 0.658 ~= 3.0 restores the old legibility.
#   * text/table: DPR 2 here was a side effect of sharing one context, not a
#     decision - it blew the image area up by 3.5-4x and the judging prompt's
#     token count by 58-67%. DPR 1 reproduces the earlier layout exactly (the
#     main CSS, the width-search constants and target_width are all unchanged,
#     so the only residual difference is glyph rasterisation).
DEVICE_SCALE_FACTOR_BY_CLASS = {"formula": 3.0, "default": 1.0}


def device_scale_factor_for(formula_mode: bool) -> float:
    """Return the device_scale_factor for a candidate class.

    The driver calls this when creating the browser context.
    """
    return DEVICE_SCALE_FACTOR_BY_CLASS["formula" if formula_mode else "default"]


_KATEX_CSS_CACHE: dict[Path, str] = {}

# document.fonts.ready only waits for fonts already queued, and KaTeX loads its
# glyphs lazily. Under load, composite glyphs such as \notin were laid out using
# the fallback font's metrics, which put the overstruck slash in the wrong place.
# Loading every family explicitly removes the race.
_KATEX_FONT_PRELOAD_SCRIPT = """async () => {
    if (typeof katex === 'undefined') return;
    const fams = ['KaTeX_Main','KaTeX_Math','KaTeX_AMS','KaTeX_Size1','KaTeX_Size2',
                  'KaTeX_Size3','KaTeX_Size4','KaTeX_Caligraphic','KaTeX_Fraktur',
                  'KaTeX_Script','KaTeX_SansSerif','KaTeX_Typewriter'];
    const jobs = [];
    for (const f of fams) for (const s of ['normal','italic']) for (const w of ['normal','bold'])
        jobs.push(document.fonts.load(s + ' ' + w + ' 16px "' + f + '"').catch(() => {}));
    await Promise.all(jobs);
}"""

# An over-wide display formula used to be cut off at the right edge of the
# capture area - content silently lost, no error. Shrinking font-size by the
# overflow ratio pulls it back inside the page width; KaTeX sizes everything in
# em, so the whole formula reflows proportionally.
_DISPLAY_MATH_FIT_SCRIPT = """() => {
    const area = document.getElementById('capture-area');
    if (!area) return;
    for (const d of area.querySelectorAll('.katex-display')) {
        const avail = d.clientWidth || area.clientWidth;
        const need = d.scrollWidth;
        if (need > avail + 1) {
            const scale = Math.max(0.3, avail / need);
            d.style.fontSize = (scale * 100).toFixed(1) + '%';
        }
    }
}"""


def _is_escaped(text: str, pos: int) -> bool:
    """Return True if the character at `pos` is backslash-escaped.

    Escaped means an odd number of consecutive backslashes precede it.
    """
    n = 0
    i = pos - 1
    while i >= 0 and text[i] == "\\":
        n += 1
        i -= 1
    return n % 2 == 1


def _split_math_spans(
    text: str,
    accept: "Callable[[str, bool, str], bool] | None" = None,
) -> list[tuple[bool, bool, str, str]]:
    """Split math spans in one left-to-right pass, like KaTeX's splitAtDelimiters.

    Why one pass: the earlier implementation ran four independent regexes
    ($$ / \\[ \\] / \\( \\) / $) that could not see each other. For adjacent
    inline formulas such as `$ A $ B $ C $`, where one `$` both closes and opens
    a span, the single-$ regex matched nothing at all (it demanded that neither
    neighbour of the closing `$` be a `$`, and excluded `$` from the body), so
    the whole run was printed literally. Worse, a placeholder emitted by the
    earlier `$$` substitution could be swallowed into another formula by the
    later single-$ rule, and _restore_math's single ordered pass cannot unwind a
    nested placeholder - the literal text MATH_0 ended up in the image. With one
    pass each delimiter is paired exactly once: no misses, no nesting.

    When accept(inner, is_display, left) returns False the span is treated as
    literal text **and the scan advances by only the length of the left
    delimiter** - it must not jump past the rejected right delimiter. KaTeX pairs
    delimiters inside a DOM text node, so a `$` cannot cross an element boundary
    like `</td><td>`; skipping to after the right delimiter would shift every
    later pairing by one and degrade a whole table's formulas to literal text
    (measured: 20 formulas collapsing into 1).

    Returns [(is_math, is_display, payload, raw), ...]. For a math span `payload`
    is the formula body and `raw` is the original text including its delimiters,
    so declining to protect a span can write it back byte for byte with its
    delimiter form intact.
    """
    spans: list[tuple[bool, bool, str, str]] = []
    buf: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        matched = False
        for left, right, is_display, allow_newline in _MATH_DELIMS:
            if not text.startswith(left, i) or _is_escaped(text, i):
                continue
            j = i + len(left)
            end = -1
            while j < n:
                k = text.find(right, j)
                if k < 0:
                    break
                if _is_escaped(text, k):
                    j = k + 1
                    continue
                end = k
                break
            if end < 0:
                continue
            inner = text[i + len(left):end]
            if not inner.strip():
                continue
            if not allow_newline and "\n" in inner:
                continue
            if accept is not None and not accept(inner, is_display, left):
                buf.append(text[i:i + len(left)])
                i += len(left)
                matched = True
                break
            if buf:
                spans.append((False, False, "".join(buf), "".join(buf)))
                buf = []
            spans.append((True, is_display, inner, text[i:end + len(right)]))
            i = end + len(right)
            matched = True
            break
        if not matched:
            buf.append(text[i])
            i += 1
    if buf:
        spans.append((False, False, "".join(buf), "".join(buf)))
    return spans


def _accept_single_dollar_math(inner: str) -> bool:
    """Currency exclusion for single-$ spans: reject only obvious money, else math.

    The rule follows the "markdown reference" principle: stock KaTeX auto-render
    with single-$ enabled treats every `$X$` as math, so the only exception kept
    here is currency. The test has to stay narrow - an earlier version reused the
    driver's prose word list and misread ordinary variables as prose, printing
    `$a$` (the article "a") and `$A(0,0)$` (matching \\bA\\b) literally.
    """
    body = inner.strip()
    if not body:
        return False
    if _STRONG_MATH_RE.search(body):
        return True
    if body[0].isdigit() and _PROSE_WORD_RE.search(body):
        # `It costs $5 or $10`: starts with a digit and contains a prose
        # connective, so it is currency rather than math.
        return False
    return True


def _protect_math(text: str, formula_mode: bool = False) -> tuple[str, list[tuple[str, bool]]]:
    """Replace math spans with placeholders so the Markdown parser cannot mangle them.

    With formula_mode=True the HTML-boundary exemption is switched off: that
    guard exists for HTML that has to survive the markdown pass, whereas inside a
    formula candidate `<` and `>` are math symbols. The single-$ currency
    exclusion applies in both modes.
    """
    store: list[tuple[str, bool]] = []

    def _normalize_math_source(latex: str) -> str:
        # Deliberately no repair of the source here (an earlier version inserted
        # `{}` after `\\` when followed by `[`). Neither the reference markdown
        # renderer nor the static checker repairs anything, and repairing in the
        # pipeline would "rescue" candidates that the reference renderer rejects,
        # which is exactly what the comparison is supposed to detect.
        return html_lib.unescape(latex.strip()).replace("\xa0", " ")

    def _accept(inner: str, is_display: bool, left: str) -> bool:
        if not formula_mode and _HTML_BOUNDARY_IN_MATH_RE.search(inner):
            return False
        if left == "$" and not _accept_single_dollar_math(inner):
            return False
        return True

    out: list[str] = []
    for is_math, is_display, payload, raw in _split_math_spans(text, _accept):
        if not is_math:
            out.append(payload)
            continue
        idx = len(store)
        store.append((_normalize_math_source(payload), is_display))
        out.append(_MATH_PLACEHOLDER % idx)
    return "".join(out), store


def _restore_math(html: str, store: list[tuple[str, bool]]) -> str:
    """Turn math placeholders back into HTML markers that KaTeX can pick up."""
    for i, (latex, is_display) in enumerate(store):
        placeholder = _MATH_PLACEHOLDER % i
        safe_latex = (
            latex.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
        if is_display:
            tag = f'<span class="math-display">$${safe_latex}$$</span>'
        else:
            tag = f'<span class="math-inline">\\({safe_latex}\\)</span>'
        html = html.replace(placeholder, tag)
    return html


def _markdown_to_html(text: str, formula_mode: bool = False) -> str:
    """Convert Markdown text to HTML while keeping LaTeX formulas intact."""
    if not text:
        return ""

    # Order matters: protect the math spans BEFORE escaping line-leading ordered
    # list markers. The other way round, a formula body whose first line starts
    # with a number - `\[ 1. 8x2 \]` - gets rewritten to `1\.` and then fails in
    # KaTeX (this produced 9 bogus error images in a full-set reconciliation).
    text, math_store = _protect_math(text, formula_mode=formula_mode)
    # "3. xxx" in OCR'd plain text is source content; Markdown must not treat it
    # as an ordered list and renumber it to "1. xxx".
    text = re.sub(r"(?m)^(\s*\d+)\.\s", r"\1\\. ", text)
    # Runs of three or more underscores are fill-in-the-blank rules. CommonMark
    # (the reference behaviour) leaves them literal because of its flanking
    # rules, but Python-Markdown's legacy emphasis pairs the underscores up into
    # bold/italic, eating the rule and inventing styling. Escape each underscore
    # individually to match the reference.
    text = re.sub(r"_{3,}", lambda m: "\\_" * len(m.group()), text)
    html = md_lib.markdown(
        text,
        extensions=["tables", "fenced_code", "nl2br"],
    )
    if math_store:
        html = _restore_math(html, math_store)
    return html


def _is_html_content(text: str) -> bool:
    """Rough check for whether the text is already HTML."""
    return bool(re.search(r"<(?:table|div|p|h[1-6]|ul|ol|tr|td|th)\b", text, re.I))


def clean_html_style(html: str) -> str:
    """Strip styles that cause huge whitespace or frozen layouts when rendered."""
    if not isinstance(html, str):
        return ""

    html = re.sub(r"margin:\s*auto;?", "", html, flags=re.I)
    html = re.sub(r"width:\s*max-content;?", "", html, flags=re.I)
    html = re.sub(r"text-align:\s*center;?", "", html, flags=re.I)
    html = re.sub(r"(?:min-)?height:\s*\d+[^;\"']*;?", "", html, flags=re.I)
    html = re.sub(
        r"(?:padding|margin)(?:-(?:top|bottom|left|right))?:\s*"
        r"(?:[5-9]\d{1,}|[1-9]\d{2,})px[^;\"']*;?",
        "",
        html,
        flags=re.I,
    )
    return html


_MARKDOWN_SYNTAX_RE = re.compile("(?m)^#{1,6}[ \\t]|^[ \\t]*[-*+][ \\t]+\\S|\\*\\*[^*\\n]+\\*\\*|^[ \\t]*[0-9]+\\.[ \\t]+\\S")


def has_any_math_delim(text: str) -> bool:
    """Does the candidate contain any unescaped math delimiter?

    Mirrors the hasAnyDelim check in the static screening script, so both agree
    on what counts as "already delimited".

    Two-character tokens are escape-checked as well, matching the splitter: a
    `\\(` formed by an array row break `\\\\` immediately followed by `(` is
    literal content, not a delimiter. Without the check such candidates look
    delimited and lose the bare-formula treatment (wrapping in `$$`).
    """
    i = 0
    n = len(text)
    while i < n:
        if text[i] == "$" and not _is_escaped(text, i):
            return True
        if text[i:i + 2] in (r"\[", r"\]", r"\(", r"\)") and not _is_escaped(text, i):
            return True
        i += 1
    return False


def prepare_formula_candidate(text: str) -> str:
    """Normalise a formula candidate before browser/KaTeX rendering.

    - A bare formula body (no delimiter at all) is wrapped in `$$..$$` and
      rendered as one display block, matching the static checker's
      tryParse(t, display=True).
    - A candidate that already carries delimiters is returned unchanged and gets
      split by real markdown semantics (with the HTML-boundary exemption off, as
      formula_mode requires).
    """
    t = (text or "").strip()
    if not t:
        return t
    if not has_any_math_delim(t):
        return "$$\n" + t + "\n$$"
    return t


def prepare_render_content(ocr_text: str, formula_mode: bool = False) -> str:
    """Turn OCR text into an HTML fragment that can be dropped into the page."""
    if not ocr_text:
        return ""

    if formula_mode:
        # Formula candidates always go through the markdown conversion; there is
        # no HTML passthrough test for them.
        return _markdown_to_html(ocr_text, formula_mode=True)

    if not _is_html_content(ocr_text):
        return _markdown_to_html(ocr_text)

    # whole-page fix: mixed markdown + embedded HTML (tables) must go through
    # the markdown converter (raw HTML blocks pass through untouched); the
    # plain HTML passthrough below would print ## / ** literally.
    if _MARKDOWN_SYNTAX_RE.search(ocr_text):
        return _markdown_to_html(ocr_text)

    html = clean_html_style(ocr_text)
    html = html.replace("\n", "<br>")
    html = re.sub(
        r"(</?(?:table|thead|tbody|tfoot|tr|th|td)[^>]*>)\s*(?:<br>)+\s*",
        r"\1",
        html,
        flags=re.I,
    )
    html = re.sub(
        r"(?:<br>)+\s*(</?(?:table|thead|tbody|tfoot|tr|th|td)[^>]*>)",
        r"\1",
        html,
        flags=re.I,
    )
    html, math_store = _protect_math(html)
    if math_store:
        html = _restore_math(html, math_store)
    return html


def should_force_target_width(ocr_text: str) -> bool:
    """Only tables / block HTML should be stretched to the ground-truth width.

    Ordinary short text looks better sized to its own content.
    """
    if not isinstance(ocr_text, str):
        return False
    return bool(re.search(r"<(?:table|tr|td|th)\b", ocr_text, re.I))


TABLE_LAYOUT_SCRIPT = r"""(targetWidth) => {
    const area = document.getElementById('capture-area');
    if (!area) return;
    const tables = Array.from(area.querySelectorAll('table'));

    const visualLength = (text) => {
        let score = 0;
        for (const ch of Array.from(text || '')) {
            score += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
        }
        return score;
    };

    if (!tables.length) {
        const MIN_TEXT_WIDTH = 480;
        const MAX_TEXT_WIDTH = 1200;
        const MAX_ASPECT_RATIO = 8;
        const MIN_MEANINGFUL_WIDTH = 1;

        const clearTextWidth = () => {
            area.classList.remove('long-text-wrap');
            area.style.width = '';
            area.style.maxWidth = '';
            area.style.whiteSpace = '';
            area.style.wordBreak = '';
            area.style.overflowWrap = '';
            area.style.boxSizing = '';
            for (const el of area.querySelectorAll('*')) {
                el.style.maxWidth = '';
                el.style.wordBreak = '';
                el.style.overflowWrap = '';
            }
        };

        const applyTextWidth = (width) => {
            const px = `${Math.round(width)}px`;
            area.classList.add('long-text-wrap');
            area.style.width = px;
            area.style.maxWidth = px;
            area.style.whiteSpace = 'normal';
            area.style.wordBreak = 'break-word';
            area.style.overflowWrap = 'anywhere';
            area.style.boxSizing = 'border-box';
            for (const el of area.querySelectorAll('*')) {
                const katexRoot = el.closest('.katex');
                if (katexRoot) {
                    // Do not touch KaTeX's internal layout. Its zero-width
                    // positioning boxes (.llap/.rlap/.clap > .inner, whose width
                    // comes from the containing .llap having width:0) get clamped
                    // to zero width by max-width:100%, which drops the overstruck
                    // slash back into normal flow - \notin then renders as an
                    // element-of sign followed by a loose slash. Keep max-width
                    // on the .katex root only, to stop it overflowing.
                    if (el === katexRoot) { el.style.maxWidth = '100%'; }
                    continue;
                }
                el.style.maxWidth = '100%';
                if (!['PRE', 'CODE'].includes(el.tagName)) {
                    el.style.wordBreak = 'break-word';
                    el.style.overflowWrap = 'anywhere';
                }
            }
        };

        const taggedDisplays = Array.from(area.querySelectorAll('.katex-display')).filter(
            (display) => display.querySelector('.katex-html > .tag')
        );
        if (taggedDisplays.length) {
            clearTextWidth();
            let requiredWidth = 0;
            for (const display of taggedDisplays) {
                const katexHtml = display.querySelector('.katex-html');
                const tag = katexHtml?.querySelector(':scope > .tag');
                if (!katexHtml || !tag) continue;
                const bodyWidth = Array.from(katexHtml.children)
                    .filter((child) => child !== tag)
                    .reduce((sum, child) => sum + child.getBoundingClientRect().width, 0);
                const tagWidth = tag.getBoundingClientRect().width;
                requiredWidth = Math.max(requiredWidth, bodyWidth + 2 * tagWidth + 32);
            }

            const requestedWidth = Number(targetWidth);
            const boundedTarget = Number.isFinite(requestedWidth) && requestedWidth > 0
                ? Math.min(requestedWidth, MAX_TEXT_WIDTH)
                : 0;
            const width = Math.max(requiredWidth, boundedTarget);
            if (width > 0) {
                const px = `${Math.ceil(width)}px`;
                area.style.width = px;
                area.style.maxWidth = px;
                area.style.boxSizing = 'border-box';
            }
            return;
        }

        const measure = () => {
            const rect = area.getBoundingClientRect();
            const width = Math.max(MIN_MEANINGFUL_WIDTH, rect.width || area.scrollWidth || 0);
            const height = Math.max(MIN_MEANINGFUL_WIDTH, rect.height || area.scrollHeight || 0);
            return {width, height, ratio: width / height};
        };

        clearTextWidth();
        const natural = measure();
        if (natural.ratio <= MAX_ASPECT_RATIO || natural.width <= MIN_TEXT_WIDTH) return;

        let high = Math.min(MAX_TEXT_WIDTH, natural.width);
        applyTextWidth(high);
        const highMeasure = measure();
        if (highMeasure.ratio <= MAX_ASPECT_RATIO) return;

        let low = MIN_TEXT_WIDTH;
        applyTextWidth(low);
        const lowMeasure = measure();
        if (lowMeasure.ratio > MAX_ASPECT_RATIO) return;

        let best = low;
        for (let i = 0; i < 12; i += 1) {
            const mid = (low + high) / 2;
            applyTextWidth(mid);
            const current = measure();
            if (current.ratio <= MAX_ASPECT_RATIO) {
                best = mid;
                low = mid;
            } else {
                high = mid;
            }
        }
        applyTextWidth(best);
        return;
    }

    const maxWidth = Math.max(900, Math.min(Number(targetWidth) || 1200, 1200));
    area.style.width = `${maxWidth}px`;
    area.style.maxWidth = `${maxWidth}px`;

    const cellScore = (cell) => {
        const text = (cell.innerText || '').replace(/\s+/g, ' ').trim();
        if (!text) return 1;
        const tokens = text.split(/\s+/).filter(Boolean);
        const longestToken = tokens.reduce((m, token) => Math.max(m, visualLength(token)), 0);
        const total = visualLength(text);
        return Math.max(4, Math.min(80, Math.max(longestToken, Math.sqrt(total) * 6)));
    };

    for (const table of tables) {
        table.querySelectorAll('colgroup').forEach((el) => el.remove());
        table.removeAttribute('width');
        table.style.width = '100%';
        table.style.maxWidth = '100%';
        table.style.minWidth = '0';
        table.style.tableLayout = 'fixed';
        for (const cell of table.querySelectorAll('th, td')) {
            cell.removeAttribute('width');
            cell.style.width = '';
            cell.style.minWidth = '0';
            cell.style.maxWidth = '';
            cell.style.whiteSpace = 'normal';
            cell.style.wordBreak = 'break-word';
            cell.style.overflowWrap = 'anywhere';
        }

        const rows = Array.from(table.rows);
        const colCount = rows.reduce((maxCols, row) => {
            const cols = Array.from(row.cells).reduce((sum, cell) => sum + Math.max(1, cell.colSpan || 1), 0);
            return Math.max(maxCols, cols);
        }, 0);
        if (!colCount) continue;

        const weights = Array(colCount).fill(1);
        const pending = Array(colCount).fill(0);  // rows still covered by a rowspan above
        for (const row of rows) {
            let col = 0;
            for (const cell of row.cells) {
                while (col < colCount && pending[col] > 0) col += 1;  // skip columns held by a rowspan
                const span = Math.max(1, cell.colSpan || 1);
                const rspan = Math.max(1, cell.rowSpan || 1);
                const score = cellScore(cell) / span;
                for (let i = 0; i < span && col + i < colCount; i += 1) {
                    weights[col + i] = Math.max(weights[col + i], score);
                    if (rspan > 1) pending[col + i] = Math.max(pending[col + i], rspan);
                }
                col += span;
            }
            for (let i = 0; i < colCount; i += 1) if (pending[i] > 0) pending[i] -= 1;
        }

        const totalWeight = weights.reduce((sum, value) => sum + value, 0) || colCount;
        const colgroup = document.createElement('colgroup');
        colgroup.dataset.autoLayout = 'true';
        for (const weight of weights) {
            const col = document.createElement('col');
            col.style.width = `${(weight / totalWeight) * 100}%`;
            colgroup.appendChild(col);
        }
        table.prepend(colgroup);
    }
}"""


def strip_formula_delimiters(latex: str) -> str:
    """Strip the usual formula wrappers from training text, keeping the body."""
    s = (latex or "").strip()
    wrappers = (
        (r"\[", r"\]"),
        (r"\(", r"\)"),
        ("$$", "$$"),
        ("$", "$"),
    )
    changed = True
    while changed:
        changed = False
        for left, right in wrappers:
            if s.startswith(left) and s.endswith(right) and len(s) >= len(left) + len(right):
                s = s[len(left): len(s) - len(right)].strip()
                changed = True
    return s


def formula_requires_playwright(latex: str) -> bool:
    """Detect Unicode enclosed characters that a LaTeX toolchain drops silently."""
    return bool(_FORMULA_PLAYWRIGHT_ONLY_RE.search(strip_formula_delimiters(latex)))


def _trim_white_border(img: Image.Image, padding: int = 8) -> Image.Image:
    """Crop the wide white border off a rendered page image."""
    bg = Image.new(img.mode, img.size, "white")
    diff = ImageChops.difference(img, bg)
    bbox = diff.getbbox()
    if not bbox:
        return img
    left = max(bbox[0] - padding, 0)
    top = max(bbox[1] - padding, 0)
    right = min(bbox[2] + padding, img.width)
    bottom = min(bbox[3] + padding, img.height)
    return img.crop((left, top, right, bottom))


def _find_katex_asset_dir() -> Path | None:
    assets = _find_katex_assets()
    if assets:
        return assets[0].parent
    return None


def _find_katex_assets() -> tuple[Path, Path, Path] | None:
    env_dir = os.environ.get("KATEX_ASSET_DIR")
    candidates = [Path(env_dir)] if env_dir else []
    candidates.extend(_KATEX_ASSET_DIR_CANDIDATES)
    for path in candidates:
        css = path / "katex.min.css"
        katex_js = path / "katex.min.js"
        auto_render_candidates = (
            path / "auto-render.min.js",
            path / "contrib" / "auto-render.min.js",
        )
        auto_render_js = next((p for p in auto_render_candidates if p.is_file()), None)
        if path.is_dir() and css.is_file() and katex_js.is_file() and auto_render_js:
            return css, katex_js, auto_render_js
    return None


def _katex_css_with_inlined_fonts(css_path: Path) -> str:
    resolved_css = css_path.resolve()
    cached = _KATEX_CSS_CACHE.get(resolved_css)
    if cached is not None:
        return cached

    css = resolved_css.read_text(encoding="utf-8")

    def inline_font(match: re.Match[str]) -> str:
        font_path = resolved_css.parent / match.group("path")
        if not font_path.is_file():
            raise FileNotFoundError(f"KaTeX font not found: {font_path}")
        encoded = base64.b64encode(font_path.read_bytes()).decode("ascii")
        return f'url("data:font/woff2;base64,{encoded}")'

    inlined_css, count = _KATEX_WOFF2_URL_RE.subn(inline_font, css)
    if count == 0:
        raise ValueError(f"No KaTeX WOFF2 font URLs found in {resolved_css}")
    _KATEX_CSS_CACHE[resolved_css] = inlined_css
    return inlined_css


def _cdn_katex_assets_html() -> str:
    """Return optional CDN KaTeX tags.

    Rendering jobs run in offline compute environments, so external resources are
    disabled by default. Set KATEX_ENABLE_CDN=1 for ad-hoc online debugging.
    """
    if _find_katex_assets():
        return ""
    if os.environ.get("KATEX_ENABLE_CDN", "").lower() not in {"1", "true", "yes"}:
        return ""
    return "\n".join(
        [
            '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.css">',
            '<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.js"></script>',
            '<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/contrib/auto-render.min.js"></script>',
        ]
    )


def wrap_html(content: str) -> str:
    """Wrap a fragment in a full HTML page for Playwright to screenshot."""
    return f"""<!DOCTYPE html><html><head><meta charset="UTF-8">
{_cdn_katex_assets_html()}
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
    "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei",
    "Microsoft YaHei", SimSun, sans-serif; padding: 0; margin: 0; background: #fff;
    font-size: 18px; line-height: 2.0; }}
h1 {{ font-size: 1.8em; margin: 0.8em 0 0.4em; }}
h2 {{ font-size: 1.5em; margin: 0.7em 0 0.4em; }}
h3 {{ font-size: 1.3em; margin: 0.5em 0 0.3em; }}
h4, h5, h6 {{ font-size: 1.1em; margin: 0.4em 0 0.3em; }}
p {{ margin: 0.2em 0; }}
table {{ border-collapse: collapse; margin: 0; width: 100%; max-width: 100%; table-layout: fixed; }}
th, td {{ border: 1px solid #999; box-sizing: border-box; padding: 12px; word-break: break-word; overflow-wrap: anywhere; text-align: left; }}
td, th {{ vertical-align: middle; }}
table td, table th {{ white-space: normal; }}
th {{ background-color: #f2f2f2; }}
pre {{ background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; }}
code {{ background: #f0f0f0; padding: 2px 4px; border-radius: 3px; font-size: 0.9em; }}
pre code {{ background: none; padding: 0; }}
blockquote {{ border-left: 4px solid #ddd; margin: 0.6em 0; padding: 0.4em 1em; color: #555; }}
ul, ol {{ margin: 0.5em 0; padding-left: 1.5em; }}
li {{ margin: 0.3em 0; }}
.math-display {{ display: block; text-align: center; margin: 0.8em 0; }}
#capture-area {{ display: inline-block; }}
</style></head><body><div id="capture-area">{content}</div>
<script>
document.addEventListener("DOMContentLoaded", function() {{
    if (typeof renderMathInElement !== 'undefined') {{
        renderMathInElement(document.getElementById("capture-area"), {{
            delimiters: [
                {{left: "$$", right: "$$", display: true}},
                {{left: "$", right: "$", display: false}},
                {{left: "\\\\(", right: "\\\\)", display: false}},
                {{left: "\\\\[", right: "\\\\]", display: true}}
            ],
            throwOnError: false
        }});
    }}
}});
</script></body></html>"""


async def _load_local_katex_assets(page: Any) -> bool:
    """Inject the local KaTeX assets the way Omni/olmOCR does.

    The assets are added as inline style/script tags because the browser blocks
    file:// resources loaded from a set_content page.
    """
    assets = _find_katex_assets()
    if not assets:
        return False
    css, katex_js, auto_render_js = assets
    await page.add_style_tag(content=_katex_css_with_inlined_fonts(css))
    await page.add_script_tag(path=str(katex_js))
    await page.add_script_tag(path=str(auto_render_js))
    return True


async def _render_math_in_page(page: Any) -> None:
    """Render each span protected by _protect_math with a direct katex.render call.

    KaTeX's auto-render is deliberately bypassed. Its findEndOfMath balances
    braces while pairing delimiters - with a net unclosed `{` it refuses to pair
    and prints the whole span literally - which disagrees with the reference
    renderer (the markdown-it math plugin): that one pairs without counting
    braces and hands the body straight to KaTeX, producing a ParseError. Going
    span by span makes the static checker, this pipeline and the reference
    renderer agree on where a span starts and ends, and removes a second round
    of delimiter pairing between the restored wrapper and any `$` inside it.
    """
    await page.evaluate(
        """() => {
            if (typeof katex === 'undefined') return false;
            const els = document.querySelectorAll(
                '#capture-area .math-display, #capture-area .math-inline');
            for (const el of els) {
                if (el.dataset.mathDone) continue;
                el.dataset.mathDone = '1';
                let body = el.textContent;
                const disp = el.classList.contains('math-display');
                if (disp && body.startsWith('$$') && body.endsWith('$$')) {
                    body = body.slice(2, -2);
                } else if (!disp && body.startsWith('\\\\(') && body.endsWith('\\\\)')) {
                    body = body.slice(2, -2);
                }
                // Same semantics as the reference renderer: KaTeX's default
                // throwOnError:true plus a catch that displays the message.
                // Both undefined commands and structural errors raise there;
                // there is no "keep rendering and show the bad fragment in red".
                try {
                    katex.render(body, el, {throwOnError: true, displayMode: disp});
                } catch (e) {
                    const span = document.createElement('span');
                    span.className = 'katex-error';
                    span.style.color = '#cc0000';
                    span.title = String(e);
                    span.textContent = String(e);
                    el.replaceChildren(span);
                }
            }
            return true;
        }"""
    )


def _katex_error_page_html(errors: list[str]) -> str:
    """Build the error image used for ParseError candidates.

    For a ParseError the rendered image is a picture of the error text itself.
    No heading line: only the error messages are shown.
    """
    items = "".join(
        '<li><pre class="err-msg">' + html_lib.escape(e) + "</pre></li>" for e in errors
    )
    return f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body {{ margin: 0; padding: 0; background: #fff; font-family: -apple-system, "Segoe UI",
    "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; }}
#capture-area {{ display: inline-block; max-width: 1100px; padding: 14px 18px;
    box-sizing: border-box; }}
ol {{ margin: 0; padding-left: 1.4em; }}
li {{ margin: 6px 0; }}
.err-msg {{ color: #cc0000; font-family: Menlo, Consolas, monospace; font-size: 15px;
    white-space: pre-wrap; word-break: break-word; margin: 0; }}
</style></head><body><div id="capture-area">
<ol>{items}</ol>
</div></body></html>"""


async def _collect_katex_errors(page: Any) -> list[str]:
    try:
        errors = await page.evaluate(
            """() => Array.from(document.querySelectorAll('.katex-error')).map((el) => {
                const title = (el.getAttribute('title') || '').trim();
                if (title) return title;
                return 'KaTeX error: ' + (el.textContent || '').slice(0, 300);
            })"""
        )
        return [str(e) for e in (errors or [])]
    except Exception:
        return ["KaTeX error: <failed to collect error detail>"]


async def _render_katex_error_image(page: Any, errors: list[str]) -> Image.Image | None:
    await page.set_content(
        _katex_error_page_html(errors), wait_until="domcontentloaded", timeout=15000
    )
    el = await page.query_selector("#capture-area")
    if not el:
        return None
    buf = await el.screenshot(type="png")
    return Image.open(io.BytesIO(buf)).convert("RGB")


async def render_to_pil(
    context: Any,
    html: str,
    target_width: int | None = None,
    target_height: int | None = None,
    formula_mode: bool = False,
    collect_errors: bool = False,
) -> "Image.Image | None | tuple[Image.Image | None, list[str]]":
    """Render OCR output into a PIL Image.

    The width can be aligned with the source image; the height always follows
    the content.

    When the page ends up containing a `.katex-error` (i.e. a ParseError):
    - collect_errors=True: the returned image is the error-text image, as
      (image, error_list). Without an error it returns (normal image, []).
      Commands or stray delimiters that merely show up literally in the real
      rendering are not ParseErrors, so those still produce the normal image and
      are judged by comparing the rendered image with the source image.
    - collect_errors=False: returns None, which is the older behaviour kept for
      backwards compatibility with existing callers.
    """
    page = await context.new_page()
    try:
        rendered_content = prepare_render_content(html, formula_mode=formula_mode)
        await page.set_content(wrap_html(rendered_content), wait_until="domcontentloaded", timeout=15000)
        if await _load_local_katex_assets(page):
            await _render_math_in_page(page)
            await page.evaluate(_KATEX_FONT_PRELOAD_SCRIPT)

        await page.evaluate("() => document.fonts.ready")
        await page.evaluate(TABLE_LAYOUT_SCRIPT, target_width)

        try:
            await _render_math_in_page(page)
            await page.wait_for_function(
                """() => {
                    if (typeof katex === 'undefined') return true;
                    const mathText = document.getElementById('capture-area').innerText;
                    return !mathText.includes('$$') && !mathText.includes('\\\\[') && !mathText.includes('\\\\(');
                }""",
                timeout=5000,
            )
        except Exception:
            pass

        await page.evaluate("() => document.fonts.ready")
        await page.evaluate(_DISPLAY_MATH_FIT_SCRIPT)
        await page.wait_for_timeout(300)
        if await page.query_selector(".katex-error"):
            if collect_errors:
                errors = await _collect_katex_errors(page)
                err_img = await _render_katex_error_image(page, errors)
                return err_img, errors
            print("[WARN] KaTeX failed to parse the formula")
            return None
        el = await page.query_selector("#capture-area")
        if not el:
            return (None, []) if collect_errors else None
        buf = await el.screenshot(type="png")
        img = _trim_white_border(Image.open(io.BytesIO(buf)).convert("RGB"), padding=16)
        return (img, []) if collect_errors else img
    except Exception as exc:
        print(f"[WARN] render failed: {exc}")
        return (None, []) if collect_errors else None
    finally:
        await page.close()


def pil_to_b64(img: Image.Image) -> str:
    """Encode a PIL image as a base64 PNG, keeping its original size."""
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def bytes_to_pil(raw: bytes) -> Image.Image | None:
    """Decode image bytes into an RGB PIL Image."""
    try:
        return Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        return None
