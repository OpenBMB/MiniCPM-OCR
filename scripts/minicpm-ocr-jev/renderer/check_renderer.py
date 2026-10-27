"""Check your local renderer against the bundled reference images.

The model was trained on images produced by one specific renderer. Your local build
pins the same KaTeX and the same Chromium, but fonts come from your operating system,
so the output can differ. This script tells you how much.

It renders each bundled example's OCR candidate and compares the result with the
reference PNG shipped next to it, then prints a verdict per example:

  identical   byte-for-byte equal to the reference.
  close       a few percent of pixels differ. Normal: anti-aliasing and font
              hinting differ between builds of the same font.
  drifted     noticeably different, but the layout still holds. Expected when your
              fonts or browser build differ from the reference environment. Scores
              move slightly; rankings normally do not.
  different   large pixel differences at nearly the same size. Usually a missing
              font: text is drawn with a fallback face, or as empty boxes.
  mismatched  the image geometry does not match. Something structural: wrong device
              scale factor, wrong KaTeX, or a failed render.

Only `different` and `mismatched` are treated as failures. Some drift is unavoidable:
the reference images were produced on a different machine, at a different date, from
the one you are running on, and body-text fonts come from the operating system.

A useful calibration point: formula renders tend to come out byte-identical anywhere,
because KaTeX ships its own fonts. Text and table renders drift, because they do not.
So if a formula example reports anything worse than `close`, suspect your KaTeX or
browser pin rather than your fonts.

What the verdicts do NOT tell you is how much your scores will move. That depends on
the model, not the pixels.

Run:  python3 renderer/check_renderer.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

from PIL import Image, ImageChops  # noqa: E402

from rm_render import Candidate, RenderUnavailable, render_candidates  # noqa: E402

#: Relative size difference past which the geometry is considered wrong rather than
#: drifted. Font shaping changes glyph advance widths, so a trimmed render can come
#: out a couple of percent narrower on a different machine; a wrong device scale
#: factor changes it by a whole multiple.
SIZE_DRIFT_LIMIT = 0.05

#: Fraction of pixels allowed to differ while still counting as "close", then as
#: "drifted". Anti-aliasing and hinting touch only glyph edges, a small share of a
#: mostly-white image. A missing font changes far more than the upper bound.
CLOSE_PIXEL_FRACTION = 0.03
DRIFT_PIXEL_FRACTION = 0.15


def compare(rendered: Path, reference: Path) -> tuple[str, str]:
    """Return (verdict, human-readable detail)."""
    if rendered.read_bytes() == reference.read_bytes():
        return "identical", "byte-for-byte equal"

    with Image.open(rendered) as a_img, Image.open(reference) as b_img:
        a = a_img.convert("RGB")
        b = b_img.convert("RGB")

    (aw, ah), (bw, bh) = a.size, b.size
    size_drift = max(abs(aw - bw) / max(bw, 1), abs(ah - bh) / max(bh, 1))
    size_note = "" if a.size == b.size else f"size {aw}x{ah} vs {bw}x{bh} reference; "

    if size_drift > SIZE_DRIFT_LIMIT:
        return "mismatched", (
            f"{size_note}{size_drift * 100:.1f}% size difference, past the "
            f"{SIZE_DRIFT_LIMIT * 100:.0f}% that font shaping explains"
        )

    # Sizes are close but may not be equal, so compare on a shared canvas rather
    # than refusing to compare at all. Both are top-left aligned on white, which is
    # the renderer's own background, so the padding itself contributes no difference.
    width, height = max(aw, bw), max(ah, bh)
    canvas_a = Image.new("RGB", (width, height), "white")
    canvas_b = Image.new("RGB", (width, height), "white")
    canvas_a.paste(a, (0, 0))
    canvas_b.paste(b, (0, 0))

    diff = ImageChops.difference(canvas_a, canvas_b).convert("L")
    histogram = diff.histogram()
    total = width * height
    differing = total - histogram[0]
    fraction = differing / total if total else 0.0
    # Mean intensity of the difference, over differing pixels only.
    weighted = sum(i * n for i, n in enumerate(histogram))
    mean_over_differing = (weighted / differing) if differing else 0.0

    detail = (
        f"{size_note}{fraction * 100:.2f}% of pixels differ, "
        f"mean delta {mean_over_differing:.1f}/255 over those pixels"
    )
    if fraction <= CLOSE_PIXEL_FRACTION:
        verdict = "close"
    elif fraction <= DRIFT_PIXEL_FRACTION:
        verdict = "drifted"
    else:
        verdict = "different"
    return verdict, detail


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--render-python",
        help="interpreter to run the render driver with. Use this when Chromium "
             "needs a wrapper that sets LD_LIBRARY_PATH; defaults to this interpreter.",
    )
    ap.add_argument(
        "--work-dir",
        help="where to write the renders this check produces. Defaults to "
             ".render_check inside the repo, which needs the repo to be writable; "
             "point this elsewhere when it is mounted read-only.",
    )
    args = ap.parse_args()

    cases = sorted((ROOT / "examples").glob("*/case.json"))
    if not cases:
        print("No examples found; expected examples/*/case.json", file=sys.stderr)
        return 2

    work = Path(args.work_dir) if args.work_dir else ROOT / ".render_check"
    # Deployments that mount this tree read-only are reasonable; failing on them
    # with a bare OSError from inside the render driver is not.
    try:
        work.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        print(f"Cannot write renders to {work}: {exc}", file=sys.stderr)
        print("Pass --work-dir <writable path> (the repo itself is read-only here).",
              file=sys.stderr)
        return 2
    plan: list[tuple[str, Path, Candidate]] = []

    for case_path in cases:
        case = json.loads(case_path.read_text(encoding="utf-8"))
        case_dir = case_path.parent
        reference = case_dir / case["reference_render"]
        # The reference image is the render of one specific candidate; use that one.
        wanted_role = case.get("reference_render_of", "ocr_output")
        candidate = next(
            (c for c in case["candidates"] if c.get("role") == wanted_role),
            case["candidates"][-1],
        )
        plan.append((
            case["case_id"],
            reference,
            Candidate(
                case_id=case["case_id"],
                image_path=str(case_dir / case["block_image"]),
                text=candidate["text"],
                category=case["category"],
            ),
        ))

    print(f"Rendering {len(plan)} example(s) …")
    try:
        results = render_candidates(
            [c for _, _, c in plan],
            work_dir=work,
            # Checking the renderer should not depend on Node being installed.
            precheck=False,
            python_bin=args.render_python,
        )
    except RenderUnavailable as exc:
        print(f"\nThe renderer could not run:\n{exc}", file=sys.stderr)
        text = str(exc)
        if "error while loading shared libraries" in text or "cannot open shared object" in text:
            print(
                "\nChromium is present but its system libraries are not. This is the"
                "\nmost common first-run failure. Install them with:"
                "\n    python3 -m playwright install --with-deps chromium"
                "\nIf you cannot install system packages, point --render-python at an"
                "\ninterpreter wrapper that sets LD_LIBRARY_PATH to a directory holding"
                "\nthe missing libraries.",
                file=sys.stderr,
            )
        return 2

    by_id = {r.case_id: r for r in results}
    verdicts: list[str] = []

    for case_id, reference, _cand in plan:
        result = by_id[case_id]
        print()
        print(f"=== {case_id}")
        if not result.ok or not result.render_image_path:
            print(f"  FAILED to render: {result.reason} {result.detail or ''}")
            verdicts.append("failed")
            continue
        if not reference.is_file():
            print(f"  no reference image at {reference}")
            verdicts.append("no-reference")
            continue

        verdict, detail = compare(Path(result.render_image_path), reference)
        verdicts.append(verdict)
        print(f"  {verdict}: {detail}")
        print(f"  rendered:  {result.render_image_path}")
        print(f"  reference: {reference}")

    print()
    print("=== summary")
    for verdict in ("identical", "close", "drifted", "different", "mismatched",
                    "failed", "no-reference"):
        n = verdicts.count(verdict)
        if n:
            print(f"  {verdict}: {n}")

    print(f"\nRendered images kept in {work} for inspection.")

    bad = [v for v in verdicts if v in ("different", "mismatched", "failed")]
    if bad:
        print(
            "\nSomething is off. In order of likelihood:"
            "\n  1. Browser build. Check `python3 -m playwright --version` is 1.62.0."
            "\n     A different Playwright fetches a different Chromium, which shifts"
            "\n     text layout and shows up as a size difference."
            "\n  2. Fonts. Run `fc-list :lang=zh | wc -l`; zero means Chinese is being"
            "\n     drawn as empty boxes. Having *some* CJK font matters; which one"
            "\n     matters far less."
            "\n  3. KaTeX. Confirm renderer/assets/katex-0.16.47 is intact. A formula"
            "\n     example reporting worse than `close` points here."
        )
        return 1

    if "drifted" in verdicts:
        print(
            "\nSome renders drifted from the references. That is expected on a"
            "\ndifferent machine and does not mean the renderer is wrong -- but if you"
            "\nneed scores closely comparable to published ones, match the font set as"
            "\nwell as the pins."
        )
    print("\nRenderer is usable.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
