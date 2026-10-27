"""Precheck and render: turn candidate OCR text into the image the reward model expects.

The reward model does not read candidate text as a string. It compares two images:
the original document block, and a rendered image of the candidate text. This module
produces the second one, using the exact renderer the model was trained with.

Two stages run here, both as subprocesses:

1. Precheck (Node + KaTeX). Screens each candidate for LaTeX that KaTeX cannot parse.
   A candidate that fails precheck is rejected without being rendered or scored.
2. Render (Python + Playwright Chromium + KaTeX). Converts candidate text to a PNG.

Both stages run out-of-process on purpose: it is the only way to guarantee that the
bytes produced here are identical to the bytes produced by the offline pipeline the
model was trained against. Reimplementing either stage in-process would silently
change the rendered pixels, and therefore the scores.

Rendering geometry is derived from the original block image, so `image_path` must
point at a readable file: the renderer uses the original image's width as the render
target width. Formula blocks additionally render at a higher device scale factor.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence

HERE = Path(__file__).resolve().parent
RENDERER_DIR = HERE / "renderer"
PRECHECK_JS = RENDERER_DIR / "precheck" / "screen_v225_node.js"
RENDER_DRIVER = RENDERER_DIR / "render_triple_rm_labels.py"
RENDER_MODULE_DIR = RENDERER_DIR / "render_module"
KATEX_DIR = RENDERER_DIR / "assets" / "katex-0.16.47"

#: Block categories the renderer understands. The category selects the render mode,
#: so a formula sent as "text" renders as literal text and will score poorly.
CATEGORIES = ("text", "formula", "table")


@dataclass
class Candidate:
    """One candidate text to be rendered and scored against one block image."""

    case_id: str
    image_path: str
    text: str
    category: str = "text"

    def __post_init__(self) -> None:
        if self.category not in CATEGORIES:
            raise ValueError(
                f"{self.case_id}: category must be one of {CATEGORIES}, got {self.category!r}"
            )


@dataclass
class RenderResult:
    """Outcome of precheck + render for a single candidate."""

    case_id: str
    ok: bool
    render_image_path: str | None = None
    #: Why this candidate has no usable render. One of: "precheck_reject",
    #: "render_error", "missing_original_image". None when ok.
    reason: str | None = None
    #: KaTeX diagnostics. Non-empty means the render succeeded but shows an error
    #: message where the formula should be, which the model will score as wrong.
    katex_errors: list[str] = field(default_factory=list)
    detail: str | None = None


class RenderUnavailable(RuntimeError):
    """A stage could not run at all (missing asset, missing node, crashed driver)."""


# ---------------------------------------------------------------------------
# asset checks
# ---------------------------------------------------------------------------

def check_assets(*, require_node: bool = True) -> None:
    """Fail early and specifically, rather than deep inside a subprocess."""
    missing = [p for p in (PRECHECK_JS, RENDER_DRIVER, RENDER_MODULE_DIR, KATEX_DIR) if not p.exists()]
    if missing:
        raise RenderUnavailable(
            "renderer assets missing: " + ", ".join(str(p) for p in missing)
        )
    if require_node and _which("node") is None:
        raise RenderUnavailable(
            "`node` not found on PATH. The precheck stage needs Node.js. "
            "Install Node 18 or newer, or pass precheck=False to skip screening "
            "(candidates with unparsable LaTeX will then be scored instead of rejected)."
        )


def _which(name: str) -> str | None:
    from shutil import which

    return which(name)


# ---------------------------------------------------------------------------
# stage 1: precheck
# ---------------------------------------------------------------------------

def run_precheck(
    candidates: Sequence[Candidate],
    work: Path,
    *,
    node_bin: str = "node",
) -> dict[str, dict[str, Any]]:
    """Return {case_id: hit record} for candidates KaTeX cannot parse.

    A case_id absent from the result passed the screen.
    """
    if not candidates:
        return {}

    precheck_in = work / "precheck_input.jsonl"
    hits_path = work / "precheck_hits.json"
    summary_path = work / "precheck_summary.json"
    # `category` and `label` are read by the screen for its summary grouping. We have
    # no label at inference time, so it is sent empty rather than left absent, which
    # would show up as the string "undefined" in the summary.
    _write_jsonl(
        precheck_in,
        [{"case_id": c.case_id, "label_text": c.text, "category": c.category, "label": ""}
         for c in candidates],
    )

    # The script's argv is positional: input, hits out, text field, id field, summary out.
    _run(
        [node_bin, str(PRECHECK_JS), str(precheck_in), str(hits_path),
         "label_text", "case_id", str(summary_path)],
        tag="precheck",
    )

    hits = json.loads(hits_path.read_text(encoding="utf-8"))
    return {str(rec["id"]): rec for rec in hits}


# ---------------------------------------------------------------------------
# stage 2: render
# ---------------------------------------------------------------------------

def run_render(
    candidates: Sequence[Candidate],
    work: Path,
    *,
    browser_concurrency: int = 4,
    python_bin: str | None = None,
) -> dict[str, dict[str, Any]]:
    """Render each candidate to a PNG. Returns {case_id: manifest row}."""
    if not candidates:
        return {}

    render_in = work / "render_input.jsonl"
    render_out = work / "render"
    # Only these top-level fields are accepted; the driver rejects anything else.
    _write_jsonl(
        render_in,
        [
            {
                "case_id": c.case_id,
                "image_path": str(Path(c.image_path).resolve()),
                "label_text": c.text,
                "category": c.category,
            }
            for c in candidates
        ],
    )

    env = dict(os.environ)
    env["KATEX_ASSET_DIR"] = str(KATEX_DIR)

    _run(
        [
            python_bin or sys.executable,
            str(RENDER_DRIVER),
            "--input-jsonl", str(render_in),
            "--output-dir", str(render_out),
            "--render-module-dir", str(RENDER_MODULE_DIR),
            "--browser-concurrency", str(browser_concurrency),
            "--clean",
        ],
        env=env,
        tag="render",
    )

    manifest = render_out / "manifest.jsonl"
    if not manifest.is_file():
        raise RenderUnavailable(f"render driver produced no manifest at {manifest}")
    return {str(row["case_id"]): row for row in _read_jsonl(manifest)}


# ---------------------------------------------------------------------------
# both stages
# ---------------------------------------------------------------------------

def render_candidates(
    candidates: Sequence[Candidate],
    *,
    work_dir: str | Path | None = None,
    precheck: bool = True,
    browser_concurrency: int = 4,
    node_bin: str = "node",
    python_bin: str | None = None,
) -> list[RenderResult]:
    """Precheck, then render everything that survived.

    Results come back in the same order as `candidates`. A rejected or failed
    candidate still gets a result, with ok=False and a reason, so callers can
    score it as "definitely wrong" rather than dropping it.

    ⚠ The returned paths point at files on disk, and this function never deletes
    them -- deleting a directory whose paths you just handed out leaves the caller
    holding dangling filenames. Pass `work_dir` to put them where you want them;
    otherwise a temporary directory is created and **the caller owns it**.
    """
    if not candidates:
        return []

    seen: set[str] = set()
    for c in candidates:
        if c.case_id in seen:
            raise ValueError(f"duplicate case_id {c.case_id!r}; case ids must be unique")
        seen.add(c.case_id)

    check_assets(require_node=precheck)

    if work_dir is None:
        work = Path(tempfile.mkdtemp(prefix="rm_render_"))
    else:
        work = Path(work_dir)
        work.mkdir(parents=True, exist_ok=True)

    rejected: dict[str, dict[str, Any]] = {}
    if precheck:
        rejected = run_precheck(candidates, work, node_bin=node_bin)

    survivors = [c for c in candidates if c.case_id not in rejected]
    manifest = run_render(
        survivors, work,
        browser_concurrency=browser_concurrency,
        python_bin=python_bin,
    )

    return results_from_manifest(candidates, rejected, manifest)


def results_from_manifest(
    candidates: Sequence[Candidate],
    rejected: dict[str, dict[str, Any]],
    manifest: dict[str, dict[str, Any]],
) -> list[RenderResult]:
    """Turn a precheck result and a render manifest into one verdict per candidate.

    Kept separate from `render_candidates` because there is more than one way to
    run the renderer -- a subprocess per batch, or a long-lived browser inside a
    service -- and the verdicts must not depend on which was used. A second copy
    of this mapping would be free to drift, and the drift would show up as
    candidates being rejected for different reasons on different deployments.
    """
    results: list[RenderResult] = []
    for c in candidates:
        hit = rejected.get(c.case_id)
        if hit is not None:
            results.append(RenderResult(
                case_id=c.case_id,
                ok=False,
                reason="precheck_reject",
                detail=_hit_detail(hit),
            ))
            continue

        row = manifest.get(c.case_id)
        if row is None:
            results.append(RenderResult(
                case_id=c.case_id, ok=False, reason="render_error",
                detail="case id absent from render manifest",
            ))
            continue

        katex_errors = list(row.get("katex_errors") or [])
        if row.get("render_ok"):
            results.append(RenderResult(
                case_id=c.case_id,
                ok=True,
                render_image_path=str(row.get("render_image_path") or ""),
                katex_errors=katex_errors,
            ))
        else:
            err = str(row.get("render_error") or "unknown")
            reason = "missing_original_image" if err == "missing_original_image" else "render_error"
            results.append(RenderResult(
                case_id=c.case_id, ok=False, reason=reason,
                detail=err, katex_errors=katex_errors,
            ))
    return results


def _hit_detail(hit: dict[str, Any]) -> str:
    """The screen's own diagnosis, which is the useful part of a rejection.

    A hit looks like {"id", "status", "reasons": [...], "errors": [...]}, where
    `errors` carries KaTeX's parse error verbatim -- that string is what tells a
    caller which part of the candidate's LaTeX is malformed.
    """
    status = str(hit.get("status") or "rejected")
    errors = [str(e) for e in (hit.get("errors") or []) if e]
    reasons = [str(r) for r in (hit.get("reasons") or []) if r]
    parts = errors or reasons
    return f"{status}: {'; '.join(parts)}" if parts else status


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

def _write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _run(cmd: list[str], *, env: dict[str, str] | None = None, tag: str = "") -> None:
    proc = subprocess.run(
        cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    )
    if proc.returncode != 0:
        # The driver prints progress to stdout, so the tail is the useful part.
        tail = (proc.stdout or "")[-4000:]
        raise RenderUnavailable(f"stage {tag!r} failed (exit {proc.returncode}):\n{tail}")


# ---------------------------------------------------------------------------
# CLI: render without scoring
# ---------------------------------------------------------------------------

def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(
        description="Render candidate OCR text to the PNG the reward model expects.",
    )
    ap.add_argument("--image", required=True, help="original document block image")
    ap.add_argument("--candidate", dest="candidates", action="append", default=[],
                    metavar="TEXT", help="candidate text (repeat for several)")
    ap.add_argument("--category", default="text", choices=list(CATEGORIES))
    ap.add_argument("--out-dir", required=True, help="where to write renders")
    ap.add_argument("--no-precheck", action="store_true",
                    help="skip the KaTeX screen (does not need Node)")
    ap.add_argument("--browser-concurrency", type=int, default=4)
    ap.add_argument("--render-python",
                    help="interpreter to run the render driver with, when Chromium "
                         "needs a wrapper that sets LD_LIBRARY_PATH")
    args = ap.parse_args()

    if not args.candidates:
        ap.error("at least one --candidate is required")

    cands = [
        Candidate(case_id=f"cand{i}", image_path=args.image, text=text, category=args.category)
        for i, text in enumerate(args.candidates)
    ]
    results = render_candidates(
        cands,
        work_dir=args.out_dir,
        precheck=not args.no_precheck,
        browser_concurrency=args.browser_concurrency,
        python_bin=args.render_python,
    )
    for r in results:
        if r.ok:
            note = f"  katex_errors={r.katex_errors}" if r.katex_errors else ""
            print(f"{r.case_id}: {r.render_image_path}{note}")
        else:
            print(f"{r.case_id}: FAILED ({r.reason}) {r.detail or ''}")


if __name__ == "__main__":
    main()
