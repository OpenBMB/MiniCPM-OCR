"""Contract tests for the scoring service in app.py.

Run against a live service (and its backend):

    python3 check_service.py --base-url http://127.0.0.1:8030

What is asserted and what is only measured is a deliberate split.

Asserted: the things that are true of a correct service regardless of which
machine it runs on -- the four verdict counts add up, a bad item does not take
its batch down with it, unparsable LaTeX is rejected rather than scored, the
best candidate is the one with the highest score, the two rates mean what their
names say.

Measured but not asserted: the scores themselves. The renderer draws text with
the operating system's own font and text-shaping libraries, so a different Linux
produces slightly different pixels and therefore slightly different numbers. How
far they move is the thing worth knowing, so it is printed; turning it into a
pass/fail condition would just encode one machine's output as the specification.

Ranking is asserted because ranking is what the model is used for, and it is
what survives the pixel differences.
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXAMPLES = HERE.parent / "examples"

#: Printed as a warning when a score moves further than this from the reference
#: run. Not a failure -- see the module docstring.
DRIFT_NOTICE = 1e-3


class Report:
    def __init__(self) -> None:
        self.failed: list[str] = []
        self.notes: list[str] = []

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  {detail}" if detail else ""))
        if not ok:
            self.failed.append(name)
        return ok

    def info(self, name: str, detail: str) -> None:
        print(f"  [INFO] {name}  {detail}")

    def note(self, text: str) -> None:
        self.notes.append(text)


def post(url: str, payload: dict, timeout: float = 600.0) -> tuple[int, dict | str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        try:
            return exc.code, json.loads(body)
        except json.JSONDecodeError:
            return exc.code, body


def get(url: str, timeout: float = 30.0) -> tuple[int, dict | str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def load_examples() -> list[dict]:
    out = []
    for case_path in sorted(EXAMPLES.glob("*/case.json")):
        case = json.loads(case_path.read_text(encoding="utf-8"))
        case["_dir"] = case_path.parent
        out.append(case)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://127.0.0.1:8030")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")
    r = Report()
    cases = load_examples()

    # ---------------------------------------------------------------- health
    print("\nT1 /healthz")
    status, body = get(f"{base}/healthz")
    r.check("200 and backend alive", status == 200 and isinstance(body, dict)
            and body.get("backend", {}).get("alive") is True, f"status={status}")
    if isinstance(body, dict):
        r.info("identity", f"model={body.get('scorer', {}).get('model')} "
                           f"template_md5={body.get('input_forms', {}).get('template_md5')} "
                           f"forms={body.get('input_forms', {}).get('supported')}")

    # ------------------------------------------------------------ score_best
    # The service renders here: no render_image is supplied, which is the path
    # an ordinary caller takes.
    print("\nT2 /v1/rm/score_best on the bundled examples (service renders)")
    for case in cases:
        texts = [c["text"] for c in case["candidates"]]
        roles = [c.get("role", "") for c in case["candidates"]]
        status, body = post(f"{base}/v1/rm/score_best", {
            "input_form": "ternary",
            "case_id": case["case_id"],
            "image": b64(case["_dir"] / case["block_image"]),
            "candidates": texts,
            "category": case["category"],
        })
        if not r.check(f"{case['case_id']}: HTTP 200", status == 200, str(body)[:200]):
            continue
        assert isinstance(body, dict)

        scores = body["scores"]
        expected = case["observed_prob_yes"]
        # Ranking is the assertion. The reference run's own best candidate is
        # whichever role scored highest there.
        want_role = max(expected, key=lambda k: expected[k])
        want_index = roles.index(want_role)
        r.check(f"{case['case_id']}: best candidate is the reference run's best",
                body["best_index"] == want_index,
                f"got index {body['best_index']} ({roles[body['best_index']]}), "
                f"expected {want_index} ({want_role})")

        drift = []
        for role, got in zip(roles, scores):
            ref = expected.get(role)
            if ref is None:
                continue
            drift.append(f"{role} {got:.5f} vs {ref:.5f} (Δ{abs(got - ref):.1e})")
            if abs(got - ref) > DRIFT_NOTICE:
                r.note(f"{case['case_id']}/{role}: {got:.5f} vs reference {ref:.5f}")
        r.info(f"{case['case_id']}: scores", "; ".join(drift))
        r.info(f"{case['case_id']}: stages", json.dumps(body.get("stage_sec", {})))

    # ----------------------------------------------------------------- score
    print("\nT3 /v1/rm/score summary arithmetic and rate caliber")
    items = []
    for i, case in enumerate(cases):
        for j, cand in enumerate(case["candidates"]):
            items.append({"case_id": f"{case['case_id']}__{j}",
                          "image": b64(case["_dir"] / case["block_image"]),
                          "ocr_text": cand["text"], "category": case["category"]})
    status, body = post(f"{base}/v1/rm/score", {"input_form": "ternary", "items": items})
    if r.check("HTTP 200", status == 200, str(body)[:200]) and isinstance(body, dict):
        s = body["summary"]
        parts = s["scored"] + s["precheck_reject"] + s["render_error"] + s["forward_error"]
        r.check("scored + precheck_reject + render_error + forward_error == total",
                parts == s["total"], f"{parts} vs {s['total']}")

        got = [x["prob_yes"] for x in body["results"] if x["verdict"] == "scored"]
        if got:
            lo, hi = min(got), max(got)
            # Two thresholds that must give opposite answers. Picking them from
            # the observed scores is what makes this check mean something: a
            # fixed pair can land on the same side of every score and leave the
            # assertion true by accident.
            below = max(0.0, lo - 1e-6)
            above = min(1.0, hi + 1e-6)
            _, b_lo = post(f"{base}/v1/rm/score",
                           {"input_form": "ternary", "items": items, "threshold": below})
            _, b_hi = post(f"{base}/v1/rm/score",
                           {"input_form": "ternary", "items": items, "threshold": above})
            assert isinstance(b_lo, dict) and isinstance(b_hi, dict)
            r.check("throughput_rate responds to threshold",
                    b_lo["summary"]["throughput_rate"] > b_hi["summary"]["throughput_rate"],
                    f"τ={below:.6f} -> {b_lo['summary']['throughput_rate']:.3f}, "
                    f"τ={above:.6f} -> {b_hi['summary']['throughput_rate']:.3f}")
            r.check("pass_rate does NOT respond to threshold (it is not the throughput rate)",
                    b_lo["summary"]["pass_rate"] == b_hi["summary"]["pass_rate"],
                    f"{b_lo['summary']['pass_rate']:.3f} both")
            # τ exactly equal to a score must count as passing: the test is >=.
            _, b_eq = post(f"{base}/v1/rm/score",
                           {"input_form": "ternary", "items": items, "threshold": hi})
            assert isinstance(b_eq, dict)
            r.check("τ exactly equal to a score passes (>= not >)",
                    b_eq["summary"]["throughput_rate"] > 0.0,
                    f"τ={hi:.6f} -> {b_eq['summary']['throughput_rate']:.3f}")

    # ----------------------------------------------------- bad input in batch
    print("\nT4 one bad image does not take down its batch")
    good = cases[0]
    status, body = post(f"{base}/v1/rm/score", {"input_form": "ternary", "items": [
        {"case_id": "mix::good1", "image": b64(good["_dir"] / good["block_image"]),
         "ocr_text": good["candidates"][0]["text"], "category": good["category"]},
        # Not valid base64: length is not a multiple of four. This is the shape
        # that used to escape as an unhandled exception and fail the request.
        {"case_id": "mix::bad", "image": "AAAA" + "A", "ocr_text": "x", "category": "text"},
        {"case_id": "mix::good2", "image": b64(good["_dir"] / good["block_image"]),
         "ocr_text": good["candidates"][1]["text"], "category": good["category"]},
    ]})
    if r.check("HTTP 200 for a batch containing a bad item", status == 200, str(body)[:200]):
        assert isinstance(body, dict)
        by_id = {x["case_id"]: x for x in body["results"]}
        r.check("the bad item is reported per-item, not as a failed request",
                by_id["mix::bad"]["verdict"] == "encode_error",
                f"verdict={by_id['mix::bad']['verdict']}")
        r.check("the good items in the same batch still scored",
                by_id["mix::good1"]["verdict"] == "scored"
                and by_id["mix::good2"]["verdict"] == "scored")
        r.check("a failed item's prob_yes is a sentinel outside (0,1)",
                not (0.0 < by_id["mix::bad"]["prob_yes"] < 1.0),
                f"prob_yes={by_id['mix::bad']['prob_yes']}")

    # ------------------------------------------------------------- precheck
    print("\nT5 unparsable LaTeX is rejected, not scored")
    status, body = post(f"{base}/v1/rm/score", {"input_form": "ternary", "items": [
        {"case_id": "bad_latex", "image": b64(good["_dir"] / good["block_image"]),
         "ocr_text": r"$\frac{1}{$ \begin{nosuchenv} x \end{nosuchenv}",
         "category": "formula"},
    ]})
    if r.check("HTTP 200", status == 200, str(body)[:200]) and isinstance(body, dict):
        item = body["results"][0]
        r.check("verdict is precheck_reject", item["verdict"] == "precheck_reject",
                f"verdict={item['verdict']} detail={item['detail'][:120]}")
        r.check("rejected candidate scores 0.0, so it loses every argmax",
                item["prob_yes"] == 0.0, f"prob_yes={item['prob_yes']}")

    # --------------------------------------------------------- form rejected
    print("\nT6 binary input form is refused, not silently accepted")
    status, _ = post(f"{base}/v1/rm/score", {"input_form": "binary", "items": [
        {"case_id": "x", "image": b64(good["_dir"] / good["block_image"]),
         "ocr_text": "x", "category": "text"}]})
    r.check("binary is a 4xx", 400 <= status < 500, f"status={status}")

    # ------------------------------------------------- caller-supplied render
    print("\nT7 a caller-supplied render skips the renderer")
    role = good.get("reference_render_of", "ocr_output")
    cand = next(c for c in good["candidates"] if c.get("role") == role)
    status, body = post(f"{base}/v1/rm/score_best", {
        "input_form": "ternary", "case_id": "byo_render",
        "image": b64(good["_dir"] / good["block_image"]),
        "candidates": [cand["text"]],
        "render_images": [b64(good["_dir"] / good["reference_render"])],
        "category": good["category"],
    })
    if r.check("HTTP 200", status == 200, str(body)[:200]) and isinstance(body, dict):
        stages = body.get("stage_sec", {})
        r.check("no render stage ran", "render_sec" not in stages,
                f"stage_sec keys={sorted(stages)}")
        r.info("score with the shipped render", f"{body['scores'][0]:.5f} "
               f"(service-rendered reference run: {good['observed_prob_yes'][role]:.5f})")

    # ----------------------------------------------------------------- batch
    print("\nT8 /v1/rm/score_best_batch returns one result per block")
    status, body = post(f"{base}/v1/rm/score_best_batch", {
        "input_form": "ternary",
        "items": [{
            "input_form": "ternary", "case_id": c["case_id"],
            "image": b64(c["_dir"] / c["block_image"]),
            "candidates": [x["text"] for x in c["candidates"]],
            "category": c["category"],
        } for c in cases],
    })
    if r.check("HTTP 200", status == 200, str(body)[:300]) and isinstance(body, dict):
        r.check("one result per block", len(body["results"]) == len(cases),
                f"{len(body['results'])} vs {len(cases)}")
        r.check("every candidate has a verdict",
                all(len(res["verdicts"]) == len(c["candidates"])
                    for res, c in zip(body["results"], cases)))
        r.info("batch", f"batch_size={body.get('batch_size')} "
                        f"stage_sec={json.dumps(body.get('stage_sec', {}))}")

    # ---------------------------------------------------------------- report
    print()
    if r.notes:
        print(f"{len(r.notes)} score(s) moved more than {DRIFT_NOTICE} from the reference run:")
        for n in r.notes:
            print(f"  - {n}")
        print("  (expected on a machine whose font and text-shaping libraries differ;")
        print("   measured, not asserted -- see the module docstring)")
        print()
    if r.failed:
        print(f"FAILED: {len(r.failed)} check(s): {', '.join(r.failed)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
