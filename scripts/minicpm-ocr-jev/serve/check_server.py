"""Check that a `vllm serve` backend reproduces the reference scoring setup.

Three things can silently go wrong when the forward pass moves from an in-process
engine to an HTTP server, and each of them produces plausible-looking numbers
rather than an error. This script checks them in the order that isolates blame:

  1. The template.   Does the server turn our prompt back into our prompt?
                     Tokenized, a chat request carrying only the text part must
                     equal the same string sent as a completion. If this fails,
                     nothing downstream is meaningful.
  2. The images.     Does /classify accept two images and bind them in order?
  3. The scores.     Do the bundled examples land where they landed on the
                     reference setup?

Only the `ocr_output` candidate of each example is scored here: it is the one
whose rendered image ships with the material, so this check needs no renderer.

    python check_server.py --base-url http://127.0.0.1:8026
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from infer_vllm import build_prompt  # noqa: E402

HERE = Path(__file__).resolve().parent
EXAMPLES = HERE.parent / "examples"

#: Scores here are checked by shape, not by equality, and the reason is worth
#: stating because a tolerance would look stricter and verify less.
#:
#: The `observed_prob_yes` in each example was measured with renders produced by
#: the reference setup's own renderer. The `reference_render.png` that ships
#: alongside is a different file: for the formula and table examples it matches
#: to five decimal places, but for the text example it does not, and the same
#: candidate scores 0.0070 self-rendered against 0.0022 with the shipped render
#: -- a 3x gap, measured independently on the existing service. Rendering
#: environment moves small scores by multiples; that is a known property of this
#: model, not a fault in the server.
#:
#: So a numeric tolerance wide enough to admit that gap would also admit a
#: genuinely broken prompt, and one narrow enough to catch a broken prompt would
#: fail on a correct server. What a broken prompt or a swapped image order
#: actually does is destroy the pattern: the consistent candidate stops scoring
#: high, or the inconsistent ones stop scoring low. That is what is checked.
#:
#: The strict equality check lives in check_end_to_end.py, which renders with our
#: own renderer and therefore has a like-for-like reference.
HIGH = 0.5    # a candidate the source data labels consistent must clear this
LOW = 0.05    # one labelled inconsistent must stay under it
#: The formula example is the exception: its shipped render does come from the
#: reference run, so it is held to equality and is the sharpest single signal
#: that prompt bytes and image order are right.
FORMULA_TOLERANCE = 1e-3


def post(url: str, payload: dict, timeout: float = 300.0) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {exc.code} from {url}: {body[:800]}") from None


def get(url: str, timeout: float = 30.0) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def data_url(path: Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def prob_yes(logits: list[float]) -> float:
    a, b = float(logits[0]), float(logits[1])
    top = max(a, b)
    return math.exp(b - top) / (math.exp(a - top) + math.exp(b - top))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://127.0.0.1:8026")
    ap.add_argument("--model", default=None, help="served model name (default: ask the server)")
    args = ap.parse_args()

    base = args.base_url.rstrip("/")
    failures: list[str] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  {detail}" if detail else ""))
        if not ok:
            failures.append(name)

    # ---------------------------------------------------------------- server
    print("\n1. server")
    models = get(f"{base}/v1/models")
    served = args.model or models["data"][0]["id"]
    check("/v1/models reachable", bool(served), f"served model = {served!r}")

    # -------------------------------------------------------------- template
    # The prompt text is deliberately odd -- newlines, a trailing empty assistant
    # turn -- because that is exactly what a template is prone to "tidy up".
    print("\n2. prompt template is pass-through")
    prompt = build_prompt("TEMPLATE PROBE 模板探针")

    as_completion = post(f"{base}/tokenize", {
        "model": served, "prompt": prompt, "add_special_tokens": False,
    })
    as_chat = post(f"{base}/tokenize", {
        "model": served,
        "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        "add_special_tokens": False,
        "add_generation_prompt": False,
    })
    ids_completion = as_completion["tokens"]
    ids_chat = as_chat["tokens"]
    same = ids_completion == ids_chat
    check(
        "chat-rendered prompt == raw prompt (token for token)", same,
        f"{len(ids_completion)} tokens"
        if same else
        f"completion {len(ids_completion)} tok vs chat {len(ids_chat)} tok; "
        f"first difference at {_first_diff(ids_completion, ids_chat)}",
    )
    if not same:
        print("     -> the chat template is rewriting the prompt; scores below are "
              "not comparable to anything. Fix this before reading them.")

    # ---------------------------------------------------------------- scores
    print("\n3. scores on the bundled examples (ocr_output candidate)")
    for case_path in sorted(EXAMPLES.glob("*/case.json")):
        case = json.loads(case_path.read_text(encoding="utf-8"))
        folder = case_path.parent
        role = case.get("reference_render_of", "ocr_output")
        cand = next(c for c in case["candidates"] if c.get("role") == role)
        expected = case["observed_prob_yes"][role]

        body = {
            "model": served,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image_url",
                     "image_url": {"url": data_url(folder / case["block_image"])}},
                    {"type": "image_url",
                     "image_url": {"url": data_url(folder / case["reference_render"])}},
                    {"type": "text", "text": build_prompt(cand["text"])},
                ],
            }],
            # Raw logits; the softmax happens here so that both classes are
            # weighed against each other exactly as the reference setup does.
            "use_activation": False,
            "add_generation_prompt": False,
        }
        out = post(f"{base}/classify", body)
        got = prob_yes(out["data"][0]["probs"])
        delta = abs(got - expected)
        label = cand.get("label", "")

        if case["category"] == "formula":
            ok = delta <= FORMULA_TOLERANCE
            rule = f"== {expected:.5f} ± {FORMULA_TOLERANCE}"
        elif label == "consistent":
            ok = got >= HIGH
            rule = f">= {HIGH}"
        else:
            ok = got <= LOW
            rule = f"<= {LOW}"

        check(
            f"{case['case_id']} ({case['category']}, labelled {label or 'n/a'})",
            ok,
            f"got {got:.5f} [{rule}]; reference run {expected:.5f}, |Δ| {delta:.2e}",
        )

    # ------------------------------------------------------------- control
    # A test that only ever passes proves nothing. The formula check above is
    # the one carrying weight, so show that it can fail: send the same request
    # with the two images in the wrong order, which is the single most likely
    # way to wire this up incorrectly, and require the score to move.
    print("\n4. negative control (images swapped must NOT reproduce the score)")
    case_path = next(iter(sorted(EXAMPLES.glob("02_formula*/case.json"))))
    case = json.loads(case_path.read_text(encoding="utf-8"))
    folder = case_path.parent
    role = case.get("reference_render_of", "ocr_output")
    cand = next(c for c in case["candidates"] if c.get("role") == role)
    expected = case["observed_prob_yes"][role]
    swapped = post(f"{base}/classify", {
        "model": served,
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": data_url(folder / case["reference_render"])}},
            {"type": "image_url", "image_url": {"url": data_url(folder / case["block_image"])}},
            {"type": "text", "text": build_prompt(cand["text"])},
        ]}],
        "use_activation": False,
        "add_generation_prompt": False,
    })
    got_swapped = prob_yes(swapped["data"][0]["probs"])
    check(
        "swapped image order changes the score",
        abs(got_swapped - expected) > FORMULA_TOLERANCE,
        f"swapped {got_swapped:.5f} vs correct-order reference {expected:.5f}",
    )

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s): {', '.join(failures)}")
        return 1
    print("all checks passed")
    return 0


def _first_diff(a: list, b: list) -> int:
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return i
    return min(len(a), len(b))


if __name__ == "__main__":
    raise SystemExit(main())
