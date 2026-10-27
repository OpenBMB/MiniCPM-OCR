"""Check that the persistent browser renders the same bytes as a fresh one.

    python3 check_render_parity.py

The pool exists to avoid relaunching Chromium, and the whole argument for it is
that the pixels do not change. That argument rests on both paths calling one copy
of the render orchestration -- which is a good reason to believe it and not a
reason to skip checking it, because the two paths still differ in everything
around that call: process age, a browser that has rendered before, contexts that
other requests have used.

A browser that has been alive for a while is exactly where a difference would
appear, so each candidate is rendered twice through the pool as well: once on a
cold pool and once after it has done other work. Identical hashes across all
three renders is the result worth having.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
MATERIAL = HERE.parent
sys.path.insert(0, str(MATERIAL))

from render_pool import RenderPool  # noqa: E402
from rm_render import Candidate, render_candidates  # noqa: E402

EXAMPLES = MATERIAL / "examples"


def load_candidates() -> list[Candidate]:
    out = []
    for case_path in sorted(EXAMPLES.glob("*/case.json")):
        case = json.loads(case_path.read_text(encoding="utf-8"))
        folder = case_path.parent
        for i, cand in enumerate(case["candidates"]):
            out.append(Candidate(
                case_id=f"{case['case_id']}#{i}",
                image_path=str(folder / case["block_image"]),
                text=cand["text"],
                category=case["category"],
            ))
    return out


def digest(path: str | None) -> str:
    if not path or not Path(path).is_file():
        return "<missing>"
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()[:16]


async def main() -> int:
    candidates = load_candidates()
    work = Path(tempfile.mkdtemp(prefix="parity_"))
    try:
        print(f"{len(candidates)} candidates\n")

        print("subprocess path (fresh Chromium per batch) …")
        sub = render_candidates(candidates, work_dir=work / "subprocess",
                                precheck=True, browser_concurrency=8)
        sub_hash = {r.case_id: (r.reason or "ok", digest(r.render_image_path)) for r in sub}

        pool = RenderPool(browsers=2, pages_per_browser=8)
        await pool.start()
        try:
            print("pool path, first batch (cold browser) …")
            cold = await pool.render(candidates, work / "pool_cold")
            cold_hash = {r.case_id: (r.reason or "ok", digest(r.render_image_path)) for r in cold}

            print("pool path, second batch (same browser, after other work) …")
            warm = await pool.render(candidates, work / "pool_warm")
            warm_hash = {r.case_id: (r.reason or "ok", digest(r.render_image_path)) for r in warm}
            # Taken before close, so that "alive" and the restart count describe
            # the pool as it was while it did the work.
            pool_state = pool.describe()
        finally:
            await pool.close()

        print()
        failures = 0
        for c in candidates:
            s, cold_v, warm_v = sub_hash[c.case_id], cold_hash[c.case_id], warm_hash[c.case_id]
            same = s == cold_v == warm_v
            failures += 0 if same else 1
            print(f"  [{'PASS' if same else 'FAIL'}] {c.case_id:<28} "
                  f"subprocess {s[1]} / cold {cold_v[1]} / warm {warm_v[1]}"
                  + ("" if s[0] == "ok" else f"  ({s[0]})"))

        print()
        print(f"pool: {json.dumps(pool_state)}")
        if failures:
            print(f"FAILED: {failures} candidate(s) rendered differently")
            return 1
        print("all renders byte-identical across the three paths")
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
