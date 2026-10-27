#!/usr/bin/env python3
"""Render OCR label text for triple-input OCR reward-model inference.

Rendering pipeline (v8 / v8.5 behaviour):
- Every category is rendered by headless Chromium + KaTeX (version pinned to
  0.16.47). The old pdflatex/LaTeX toolchain for the `formula` category was
  dropped in v8, together with its "LaTeX is missing a glyph -> fall back to
  KaTeX" recovery chain: KaTeX is now the reference renderer, so the fallback
  direction is reversed and no longer needed.
- `formula` rows are rendered in `formula_mode`: math-span splitting does not
  grant the HTML-boundary exemption, and a bare formula body is mechanically
  wrapped in `$$..$$` (see render_label.prepare_formula_candidate).
- On a KaTeX ParseError the rendered image becomes an image of the error text
  instead of the markdown render. The manifest then carries `katex_errors` and
  the `render_method` gets a `_katex_error_image` suffix, so downstream code can
  reject the sample. Without a ParseError the real markdown render is written.
- v8.5 sets the device pixel ratio per class instead of a single shared value:
  formula ~3.0 (to match the sharpness of the retired pdflatex output) and
  text/table 1.0 (which restores the pre-v8 page layout).

Input JSONL rows must follow this fixed schema:

{
  "case_id": "unique sample id",
  "image_path": "/path/to/original.png",
  "label_text": "OCR label text to judge",
  "category": "text|formula|table|...",
  "meta": {},
  "render_image_path": "/optional/existing/rendered_label.png"
}

`meta` and `render_image_path` are optional. If `render_image_path` is present,
the image is reused directly and this script does not render that sample again.
"""

from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import html as html_lib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
from typing import Any

from PIL import Image
from playwright.async_api import async_playwright


DEFAULT_RENDER_MODULE_DIR = Path(__file__).resolve().parent / "render_module"
# Honour PLAYWRIGHT_BROWSERS_PATH when it is set; otherwise leave it unset so
# Playwright falls back to its own standard browser cache location.
_PLAYWRIGHT_BROWSERS_PATH_ENV = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
DEFAULT_PLAYWRIGHT_BROWSERS_PATH = (
    Path(_PLAYWRIGHT_BROWSERS_PATH_ENV) if _PLAYWRIGHT_BROWSERS_PATH_ENV else None
)

REQUIRED_INPUT_FIELDS = {"case_id", "image_path", "label_text", "category"}
OPTIONAL_INPUT_FIELDS = {"meta", "render_image_path"}
ALLOWED_INPUT_FIELDS = REQUIRED_INPUT_FIELDS | OPTIONAL_INPUT_FIELDS
FORMULA_CATEGORY_TOKENS = (
    "formula",
    "equation",
    "math",
    "公式",
)
FORMULA_GROUPS = {
    "formula",
    "equation_isolated",
    "equation_semantic",
    "display_formula",
    "inline_formula",
}

_HTML_TAG_PATTERN = r"</?[A-Za-z][A-Za-z0-9:-]*(?:\s+[^<>]*)?>"
_SINGLE_DOLLAR_RE = re.compile(
    rf"(?<!\$)\$(?!\$)((?:(?!{_HTML_TAG_PATTERN})(?!\$).)+?)(?<!\$)\$(?!\$)",
    re.S,
)
_HTML_BOUNDARY_IN_MATH_RE = re.compile(
    r"(?:<\s*/?\s*[A-Za-z][A-Za-z0-9:-]*(?:\s+[^<>]*)?\s*/?\s*>|"
    r"&lt;\s*/?\s*[A-Za-z][A-Za-z0-9:-]*(?:\s+[^&<>]*)?\s*/?\s*&gt;)",
    re.I,
)
_STRONG_MATH_RE = re.compile(
    r"(\\|[_^{}=<>+*/]|[A-Za-z]\s*'+\s*(?:\(|[A-Za-z0-9])|"
    r"\b(?:alpha|beta|gamma|theta|lambda|mu|pi|sigma|omega|sqrt|frac|sum|int|"
    r"lfloor|rfloor|mathrm|mathbb|operatorname|begin|end|times|cdot|leq|geq|pmod)\b)"
)
_SIMPLE_MATH_IDENT_RE = re.compile(r"[A-Za-z][A-Za-z0-9]*(?:\s*[,;]\s*[A-Za-z][A-Za-z0-9]*)*")
_PROSE_WORD_RE = re.compile(r"\b(?:or|and|in|by|with|for|to|from|of|the|a|an)\b", re.I)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            row["_source_line_no"] = line_no
            rows.append(row)
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def safe_name(value: str, max_len: int = 120) -> str:
    value = re.sub(r"[^\w.-]+", "_", value, flags=re.UNICODE).strip("._")
    return (value[:max_len] or "unknown").strip("._") or "unknown"


def parse_path_remaps(values: list[str]) -> list[tuple[str, str]]:
    remaps: list[tuple[str, str]] = []
    for value in values:
        if "=" not in value:
            raise ValueError(f"Invalid --path-remap {value!r}; expected OLD=NEW")
        old, new = value.split("=", 1)
        if not old or not new:
            raise ValueError(f"Invalid --path-remap {value!r}; expected OLD=NEW")
        remaps.append((old.rstrip("/"), new.rstrip("/")))
    return remaps


def resolve_path(path_text: str, remaps: list[tuple[str, str]]) -> Path:
    path = Path(path_text)
    if path.exists():
        return path
    for old, new in remaps:
        if path_text == old or path_text.startswith(old + "/"):
            candidate = Path(new + path_text[len(old):])
            if candidate.exists():
                return candidate
    return path


def normalize_row(row: dict[str, Any], args: argparse.Namespace, remaps: list[tuple[str, str]]) -> dict[str, Any]:
    line_no = int(row.get("_source_line_no") or 0)
    public_keys = set(row) - {"_source_line_no"}
    missing = sorted(REQUIRED_INPUT_FIELDS - public_keys)
    extra = sorted(public_keys - ALLOWED_INPUT_FIELDS)
    if missing:
        raise ValueError(f"Line {line_no} missing required fields: {missing}")
    if extra:
        raise ValueError(
            f"Line {line_no} has unsupported top-level fields: {extra}. "
            "Put additional metadata under `meta`."
        )

    case_id = str(row["case_id"]).strip()
    if not case_id:
        raise ValueError(f"Line {line_no} has empty case_id")
    image_path = resolve_path(str(row["image_path"]), remaps)
    label_text = str(row["label_text"])
    category = str(row["category"]).strip()
    if not category:
        raise ValueError(f"Line {line_no} has empty category")
    meta = row.get("meta") or {}
    if not isinstance(meta, dict):
        raise ValueError(f"Line {line_no} field `meta` must be an object when present")

    provided_render_image_path = None
    if row.get("render_image_path"):
        render_path = resolve_path(str(row["render_image_path"]), remaps)
        if not render_path.is_file():
            raise FileNotFoundError(f"Line {line_no} render_image_path does not exist: {render_path}")
        provided_render_image_path = str(render_path)

    return {
        "case_id": case_id,
        "source_line_no": line_no,
        "source_index": line_no - 1,
        "image_path": str(image_path),
        "image_exists": image_path.is_file(),
        "candidate_label": label_text,
        "category": category,
        "meta": meta,
        "provided_render_image_path": provided_render_image_path,
        "_file_stem": f"{line_no:08d}_{safe_name(case_id)}",
    }


def is_formula_category(category: str) -> bool:
    category_l = str(category or "").lower()
    return category_l in FORMULA_GROUPS or any(token in category_l for token in FORMULA_CATEGORY_TOKENS)


def should_render_as_formula(row: dict[str, Any]) -> bool:
    """Decide whether a row goes through the browser's KaTeX `formula_mode`.

    Since v8 the routing looks at `category` only. Older versions additionally
    required a formula wrapper (delimiters) or a category keyword, because that
    decision also chose whether to hand the row to the LaTeX toolchain. With
    KaTeX as the single reference renderer, every formula row is rendered in
    `formula_mode` whether or not it carries delimiters; a bare formula body is
    wrapped in `$$..$$` by prepare_formula_candidate.
    """
    return is_formula_category(str(row.get("category") or ""))


def should_treat_single_dollar_as_math(content: str) -> bool:
    """Must stay in sync with render_label._accept_single_dollar_math.

    The old implementation was a pile of heuristics (isdigit / simple-identifier
    / prose-word / character-class allowlist). It both emitted `$333$` literally
    instead of as math and, because of the prose-word list, misjudged `$a$` and
    `$A(0,0)$` as prose. Following the "markdown is the reference" principle this
    converged to: treat a single-dollar span as math by default, and reject only
    the narrow currency case.
    """
    text = content.strip()
    if not text:
        return False
    if _HTML_BOUNDARY_IN_MATH_RE.search(text):
        return False
    if _STRONG_MATH_RE.search(text):
        return True
    if text[0].isdigit() and _PROSE_WORD_RE.search(text):
        # e.g. `It costs $5 or $10`: starts with a digit and contains a prose
        # connective word -> treat as currency, not math.
        return False
    return True


def _is_escaped(text: str, pos: int) -> bool:
    n = 0
    i = pos - 1
    while i >= 0 and text[i] == "\\":
        n += 1
        i -= 1
    return n % 2 == 1


def normalize_single_dollar_math(text: str) -> str:
    """Rewrite single-`$` inline math as `\\( \\)` using a single left-to-right
    scan, matching how KaTeX auto-render pairs delimiters.

    Bug fix: the old implementation used one regex substitution that required
    the closing `$` to have no `$` on either side and excluded `$` from the span
    content. That paired unreliably for adjacent inline spans such as
    `$ A $ B $ C $`, where the same `$` is both a closing and an opening
    delimiter. It also did not skip `$$` display math first, so a `$$` block
    could be cut in half by the single-`$` rule. A single scan matches `$$`
    before `$`, which makes the pairing unambiguous.
    """
    if "$" not in text:
        return text
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        if text.startswith("$$", i) and not _is_escaped(text, i):
            end = text.find("$$", i + 2)
            if end >= 0:
                out.append(text[i:end + 2])
                i = end + 2
                continue
        if text[i] == "$" and not _is_escaped(text, i):
            j = i + 1
            end = -1
            while j < n:
                ch = text[j]
                if ch == "\n":
                    break
                if ch == "$" and not _is_escaped(text, j):
                    end = j
                    break
                j += 1
            if end > i + 1:
                content = text[i + 1:end]
                if content.strip() and should_treat_single_dollar_as_math(content):
                    out.append(r"\(" + content.strip() + r"\)")
                    i = end + 1
                    continue
                # When the span is rejected, advance by a single `$`: KaTeX pairs
                # delimiters inside one text node, so a `$` cannot cross
                # `</td><td>`. Skipping past the rejected closing delimiter would
                # make one stray `$` in a table shift every later pairing by one.
                out.append("$")
                i += 1
                continue
        out.append(text[i])
        i += 1
    return "".join(out)


def load_render_module(module_dir: Path) -> Any:
    module_path = module_dir / "render_label.py"
    if not module_path.is_file():
        raise FileNotFoundError(f"Missing render_label.py under {module_dir}")
    spec = importlib.util.spec_from_file_location("render_label_for_rm_eval", module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot import render module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def ensure_dirs(output_dir: Path, clean: bool) -> None:
    if clean and output_dir.exists():
        shutil.rmtree(output_dir)
    for subdir in ("label_images", "label_text"):
        (output_dir / subdir).mkdir(parents=True, exist_ok=True)


def render_image_path(output_dir: Path, row: dict[str, Any]) -> Path:
    return output_dir / "label_images" / f"{row['_file_stem']}.png"


def label_text_path(output_dir: Path, row: dict[str, Any]) -> Path:
    return output_dir / "label_text" / f"{row['_file_stem']}.txt"


def existing_render_result(path: Path, *, unlink_bad: bool = True) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        with Image.open(path) as img:
            return {"render_ok": True, "render_width": img.width, "render_height": img.height}
    except Exception:
        if unlink_bad:
            path.unlink(missing_ok=True)
        return None


def previous_manifest(output_dir: Path) -> dict[str, dict[str, Any]]:
    """Load the previous manifest.jsonl indexed by case_id; empty if absent or unreadable.

    A resumed run needs this to recover the "image was produced, but KaTeX
    reported an error" verdict, which exists only in the manifest: the file on
    disk is an image of the error text and is indistinguishable from a normal
    render. Losing `katex_errors` would turn a block that should be rejected by
    the precheck into a scored one.
    """
    path = output_dir / "manifest.jsonl"
    if not path.exists():
        return {}
    try:
        return {str(row["case_id"]): row for row in read_jsonl(path) if row.get("case_id")}
    except (json.JSONDecodeError, KeyError, OSError) as exc:
        print(f"[WARN] previous manifest unreadable ({type(exc).__name__}: {exc}), re-rendering all", flush=True)
        return {}


def provided_render_results(rows: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    results: dict[int, dict[str, Any]] = {}
    for row in rows:
        render_path = Path(str(row.get("provided_render_image_path") or ""))
        cached = existing_render_result(render_path, unlink_bad=False)
        if cached:
            cached["render_method"] = "provided_cached"
            cached["render_image_path"] = str(render_path)
            results[int(row["source_line_no"])] = cached
        else:
            results[int(row["source_line_no"])] = {
                "render_ok": False,
                "render_method": "provided_cached",
                "render_error": "provided_render_image_invalid",
                "render_image_path": str(render_path),
            }
    return results


def target_width_for_row(row: dict[str, Any]) -> int | None:
    image_path = Path(str(row.get("image_path") or ""))
    if not image_path.exists():
        return None
    try:
        with Image.open(image_path) as img:
            return img.width
    except Exception:
        return None


def device_scale_factors(render_module: Any) -> dict[bool, float]:
    """Device pixel ratio per render class, keyed by `formula_mode`.

    v8.5 replaced the single shared value of 2 with a per-class setting:
    formula ~3.0 to match the sharpness of the retired pdflatex output, and
    text/table back to 1 to restore the pre-v8 page layout. The policy constant
    lives in the render module (DEVICE_SCALE_FACTOR_BY_CLASS); this function only
    reads it per formula_mode. Both contexts share one browser.
    """
    getter = getattr(render_module, "device_scale_factor_for", None)
    if getter is None:  # render modules at v8.4 and older: keep the flat value of 2
        return {False: 2.0, True: 2.0}
    return {mode: float(getter(mode)) for mode in (False, True)}


async def open_browser_contexts(browser: Any, render_module: Any) -> dict[bool, Any]:
    """Open one context per formula_mode on a shared browser, with DPR from the render module.

    This is a separate function so that the long-lived render pool and this
    script's own subprocess path construct contexts with the exact same code.
    The rendered bytes of the two paths must be byte-for-byte identical, and
    sharing the code is what guarantees it, instead of manually keeping two
    implementations aligned.
    """
    dsf = device_scale_factors(render_module)
    contexts: dict[bool, Any] = {}
    for _formula_mode in (False, True):
        contexts[_formula_mode] = await browser.new_context(
            viewport={"width": 1600, "height": 1200},
            device_scale_factor=dsf[_formula_mode],
        )
    print(f"[render] device_scale_factor text/table={dsf[False]} formula={dsf[True]}", flush=True)
    return contexts


async def render_browser_rows(
    rows: list[dict[str, Any]],
    output_dir: Path,
    render_module: Any,
    concurrency: int,
    prior: dict[str, dict[str, Any]] | None = None,
    contexts: dict[bool, Any] | None = None,
    sem: asyncio.Semaphore | None = None,
) -> dict[int, dict[str, Any]]:
    """Render a batch of rows.

    Passing `contexts`/`sem` selects the long-lived pool path: the caller's
    already-built browser contexts and a semaphore shared across requests are
    used, and this function neither launches nor closes a browser. Passing
    neither selects the subprocess path, which starts its own
    playwright+browser and builds a per-call semaphore. The render semantics are
    fully shared between the two paths (the same holds below).
    """
    results: dict[int, dict[str, Any]] = {}
    if not rows:
        return results

    prior = prior or {}
    # A caller-provided `sem` is process-wide. In the pool, 32 concurrent
    # requests each building their own Semaphore(4) would yield 128 lanes, i.e.
    # no throttling at all, so the concurrency cap must be held by the pool.
    sem = sem if sem is not None else asyncio.Semaphore(max(1, concurrency))
    owns_browser = contexts is None
    playwright = browser = None
    if owns_browser:
        playwright = await async_playwright().start()
        browser = await playwright.chromium.launch(headless=True)
        contexts = await open_browser_contexts(browser, render_module)
    completed = 0

    async def render_candidate_text(
        text: str, target_width: int | None, formula_mode: bool
    ) -> tuple[Image.Image | None, list[str]]:
        ctx = contexts[bool(formula_mode)]  # v8.5: DPR is per render class
        if formula_mode:
            # v8: let the render module normalize formula rows (wrap a bare body
            # in $$..$$; the single-$ currency rule lives in the module). Do not
            # use the driver-side normalize_single_dollar_math here, because its
            # HTML-boundary rejection does not apply to formula rows.
            normalized = render_module.prepare_formula_candidate(text)
        else:
            # v8.4: text/table rows get no driver-side $ -> \(..\) pre-conversion
            # either. Pre-converting and then letting the module rescan is a
            # double scan: a leftover currency `$` can enclose an
            # already-converted `\(` inside a new math span, which produced real
            # ParseErrors. The module's _protect_math handles all delimiters in a
            # single pass, structurally identical to the offline screener.
            normalized = text
        rendered, katex_errors = await render_module.render_to_pil(
            ctx,
            normalized,
            target_width=target_width,
            formula_mode=formula_mode,
            collect_errors=True,
        )
        if rendered is not None or not text.strip():
            return rendered, katex_errors
        if katex_errors:
            # ParseError case where even the error image failed to render:
            # report the failure honestly, do not fall back to a literal render.
            return None, katex_errors
        literal_html = '<div style="white-space: pre-wrap;">' + html_lib.escape(text) + "</div>"
        literal = await render_module.render_to_pil(ctx, literal_html, target_width=target_width)
        return literal, []

    async def work(row: dict[str, Any]) -> None:
        nonlocal completed
        formula_mode = should_render_as_formula(row)
        method = "browser_formula" if formula_mode else "browser"
        out_path = render_image_path(output_dir, row)
        cached = existing_render_result(out_path)
        if cached:
            cached["render_method"] = method + "_cached"
            # An error-text image and a normal render are indistinguishable on
            # disk; the KaTeX error is recorded only in the manifest. Losing it
            # would let a block that should be rejected through to scoring.
            previous = prior.get(str(row["case_id"])) or {}
            if previous.get("katex_errors"):
                cached["katex_errors"] = previous["katex_errors"]
            results[int(row["source_line_no"])] = cached
            completed += 1
            if completed % 200 == 0 or completed == len(rows):
                print(f"[browser] {completed}/{len(rows)}", flush=True)
            return

        async with sem:
            try:
                rendered, katex_errors = await render_candidate_text(
                    str(row.get("candidate_label") or ""),
                    target_width=target_width_for_row(row),
                    formula_mode=formula_mode,
                )
                if rendered is None:
                    result: dict[str, Any] = {
                        "render_ok": False,
                        "render_method": method,
                        "render_error": "katex_error_image_failed" if katex_errors else "render_failed",
                    }
                    if katex_errors:
                        result["katex_errors"] = katex_errors
                    results[int(row["source_line_no"])] = result
                else:
                    rendered.save(out_path)
                    result = {
                        "render_ok": True,
                        "render_method": method + ("_katex_error_image" if katex_errors else ""),
                        "render_width": rendered.width,
                        "render_height": rendered.height,
                    }
                    if katex_errors:
                        result["katex_errors"] = katex_errors
                    results[int(row["source_line_no"])] = result
            except Exception as exc:  # noqa: BLE001
                results[int(row["source_line_no"])] = {
                    "render_ok": False,
                    "render_method": method,
                    "render_error": f"{type(exc).__name__}: {exc}",
                }
            finally:
                completed += 1
                if completed % 200 == 0 or completed == len(rows):
                    print(f"[browser] {completed}/{len(rows)}", flush=True)

    try:
        await asyncio.gather(*(asyncio.create_task(work(row)) for row in rows))
    finally:
        if owns_browser:  # on the pool path the browser belongs to the pool; never close it here
            for closer in [c.close for c in contexts.values()] + [browser.close, playwright.stop]:
                try:
                    await asyncio.wait_for(closer(), timeout=10)
                except Exception as exc:  # noqa: BLE001
                    print(f"[WARN] Playwright cleanup failed: {type(exc).__name__}: {exc}", flush=True)
    return results


def build_manifest_rows(
    rows: list[dict[str, Any]],
    output_dir: Path,
    render_results: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    manifest_rows: list[dict[str, Any]] = []
    for row in rows:
        text_path = label_text_path(output_dir, row)
        if not text_path.exists():
            text_path.write_text(str(row.get("candidate_label") or ""), encoding="utf-8")

        result = dict(render_results.get(int(row["source_line_no"]), {"render_ok": False, "render_error": "not_rendered"}))
        result_render_image_path = str(result.pop("render_image_path", "") or render_image_path(output_dir, row))
        if not row.get("image_exists"):
            result["render_ok"] = False
            result["render_error"] = "missing_original_image"
        manifest = {
            "case_id": row["case_id"],
            "source_line_no": row["source_line_no"],
            "source_index": row["source_index"],
            "image_path": row["image_path"],
            "render_image_path": result_render_image_path,
            "candidate_label_text_path": str(text_path),
            "candidate_label": row.get("candidate_label"),
            "category": row.get("category"),
            "image_exists": row.get("image_exists"),
            "meta": row.get("meta") or {},
            **result,
        }
        manifest_rows.append(manifest)
    return manifest_rows


def count_eval_eligible(manifest_rows: list[dict[str, Any]]) -> int:
    """How many rows are actually usable for scoring.

    A row qualifies when it rendered and both of its images are present on disk.
    This is stricter than `rendered_ok`: a render can succeed and the file still be
    missing by the time the summary is written.
    """
    eligible = 0
    for row in manifest_rows:
        if not row.get("render_ok"):
            continue
        image_path = Path(str(row.get("image_path") or ""))
        render_path = Path(str(row.get("render_image_path") or ""))
        if image_path.exists() and render_path.exists():
            eligible += 1
    return eligible


def write_summary(path: Path, args: argparse.Namespace, manifest_rows: list[dict[str, Any]], elapsed: float, render_module: Any = None) -> None:
    ok_rows = [row for row in manifest_rows if row.get("render_ok")]
    summary = {
        "input_jsonl": str(args.input_jsonl),
        "output_dir": str(args.output_dir),
        "render_pipeline_version": getattr(render_module, "RENDER_PIPELINE_VERSION", "unknown"),
        "device_scale_factor_by_class": getattr(render_module, "DEVICE_SCALE_FACTOR_BY_CLASS", {"default": 2.0}),
        "katex_pinned_version": getattr(render_module, "KATEX_PINNED_VERSION", "unknown"),
        "num_shards": args.num_shards,
        "shard_id": args.shard_id,
        "total": len(manifest_rows),
        "rendered_ok": len(ok_rows),
        "rendered_failed": len(manifest_rows) - len(ok_rows),
        "katex_error_image_count": sum(1 for row in manifest_rows if row.get("katex_errors")),
        "eval_eligible": count_eval_eligible(manifest_rows),
        "category_counts": dict(Counter(str(row.get("category")) for row in manifest_rows)),
        "render_method_counts": dict(Counter(str(row.get("render_method")) for row in manifest_rows)),
        "failed_error_counts": dict(Counter(str(row.get("render_error")) for row in manifest_rows if not row.get("render_ok"))),
        "formula_concurrency": args.formula_concurrency,
        "browser_concurrency": args.browser_concurrency,
        "elapsed_sec": round(elapsed, 3),
    }
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-jsonl", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--render-module-dir", type=Path, default=DEFAULT_RENDER_MODULE_DIR)
    parser.add_argument("--playwright-browsers-path", type=Path, default=DEFAULT_PLAYWRIGHT_BROWSERS_PATH)
    parser.add_argument("--path-remap", action="append", default=[], metavar="OLD=NEW")
    parser.add_argument("--num-shards", type=int, default=1)
    parser.add_argument("--shard-id", type=int, default=0)
    parser.add_argument("--max-samples", type=int, default=None)
    parser.add_argument("--formula-concurrency", type=int, default=8)
    parser.add_argument("--browser-concurrency", type=int, default=8)
    parser.add_argument("--clean", action="store_true")
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> None:
    if args.num_shards < 1:
        raise ValueError("--num-shards must be >= 1")
    if args.shard_id < 0 or args.shard_id >= args.num_shards:
        raise ValueError("--shard-id must satisfy 0 <= shard-id < num-shards")
    if not args.input_jsonl.is_file():
        raise FileNotFoundError(f"Missing input JSONL: {args.input_jsonl}")


async def run_render_job(
    args: argparse.Namespace,
    *,
    contexts: dict[bool, Any] | None = None,
    sem: asyncio.Semaphore | None = None,
    render_module: Any | None = None,
) -> list[dict[str, Any]]:
    """Full orchestration of one render job: read -> render -> write manifest/triple/summary.

    This is an async function so the long-lived render pool can await the same
    orchestration inside the service's event loop, while the subprocess path
    still reaches it through an asyncio.run wrapper in main(). Both paths run
    this single copy of the code, so byte-identical output is a property of the
    construction rather than of manually aligning two implementations. Passing
    contexts/sem/render_module selects the pool; passing none selects the
    plain single-shot behaviour.
    """
    t0 = time.time()
    ensure_dirs(args.output_dir, clean=args.clean)
    prior = {} if args.clean else previous_manifest(args.output_dir)
    if render_module is None:  # the pool loads it at startup; no need to exec the module per request
        render_module = load_render_module(args.render_module_dir)
    remaps = parse_path_remaps(args.path_remap)

    raw_rows = read_jsonl(args.input_jsonl)
    if args.max_samples is not None:
        raw_rows = raw_rows[: args.max_samples]
    normalized = [normalize_row(row, args, remaps) for row in raw_rows]
    shard_rows = [
        row for idx, row in enumerate(normalized)
        if idx % args.num_shards == args.shard_id
    ]
    provided_rows = [row for row in shard_rows if row.get("provided_render_image_path")]
    provided_source_lines = {int(row["source_line_no"]) for row in provided_rows}
    rows_to_render = [row for row in shard_rows if int(row["source_line_no"]) not in provided_source_lines]
    formula_count = sum(1 for row in rows_to_render if should_render_as_formula(row))

    print(
        f"[INFO] loaded={len(raw_rows)} shard={args.shard_id}/{args.num_shards} "
        f"shard_rows={len(shard_rows)} provided={len(provided_rows)} "
        f"formula_mode={formula_count} browser_total={len(rows_to_render)} "
        f"pipeline={getattr(render_module, 'RENDER_PIPELINE_VERSION', 'unknown')} "
        f"katex={getattr(render_module, 'KATEX_PINNED_VERSION', 'unknown')}",
        flush=True,
    )

    render_results: dict[int, dict[str, Any]] = {}
    render_results.update(provided_render_results(provided_rows))
    # v8: formula and text/table share the one browser+KaTeX path; formula_mode
    # is decided per row inside work().
    render_results.update(
        await render_browser_rows(rows_to_render, args.output_dir, render_module,
                                  args.browser_concurrency, prior=prior,
                                  contexts=contexts, sem=sem)
    )

    manifest_rows = build_manifest_rows(shard_rows, args.output_dir, render_results)
    write_jsonl(args.output_dir / "manifest.jsonl", manifest_rows)
    write_summary(args.output_dir / "summary.json", args, manifest_rows, time.time() - t0, render_module)

    ok = sum(1 for row in manifest_rows if row.get("render_ok"))
    print(f"[INFO] done ok={ok} failed={len(manifest_rows) - ok}", flush=True)
    return manifest_rows


def main() -> None:
    args = parse_args()
    validate_args(args)

    if args.playwright_browsers_path is not None and args.playwright_browsers_path.exists():
        os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(args.playwright_browsers_path))

    asyncio.run(run_render_job(args))
    print(f"[INFO] manifest={args.output_dir / 'manifest.jsonl'}", flush=True)


if __name__ == "__main__":
    main()
