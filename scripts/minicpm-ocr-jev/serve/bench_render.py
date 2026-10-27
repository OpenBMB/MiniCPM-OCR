"""Find the renderer's ceiling, with the model out of the way.

    python3 bench_render.py --workers 1 2 4 8 --browsers 2 --pages 8

Renders candidates and nothing else, in the same shape the service uses: N worker
processes, each owning its own RenderPool. Reports candidates/s per shape, so the
renderer's capacity can be compared against the backend's (bench_backend.py) and
the two sized against each other.

The worker axis is the one that matters and the reason is not obvious: a process
drives all of its browsers over one Playwright connection from one asyncio loop,
and screenshots come back through it, so that pipe saturates before the browsers
do. Measuring workers and browsers separately is what makes that visible; a
single combined number would just look like "rendering is slow".
"""
from __future__ import annotations

import argparse
import asyncio
import json
import multiprocessing as mp
import shutil
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
MATERIAL = HERE.parent
sys.path.insert(0, str(MATERIAL))
sys.path.insert(0, str(HERE))


def _worker(wid: int, browsers: int, pages: int, batches: int, per_batch: int,
            inflight: int, precheck: bool, result_q: "mp.Queue") -> None:
    from render_pool import RenderPool
    from rm_render import Candidate

    example = MATERIAL / "examples" / "01_text_putnam"
    case = json.loads((example / "case.json").read_text(encoding="utf-8"))
    image = str(example / case["block_image"])
    text = case["candidates"][0]["text"]

    async def run() -> tuple[int, int, float]:
        pool = RenderPool(browsers=browsers, pages_per_browser=pages, precheck=precheck)
        await pool.start()
        work = Path(tempfile.mkdtemp(prefix=f"benchr{wid}_"))
        try:
            # Warm the pool: the first batch on a fresh browser pays for font and
            # KaTeX loading, which is not what this is measuring.
            await pool.render([Candidate(case_id=f"w{wid}warm{i}", image_path=image,
                                         text=f"{text}\n\n<!-- warm {wid} {i} -->",
                                         category=case["category"])
                               for i in range(per_batch)], work / "warm")

            async def one_batch(b: int) -> int:
                cands = [
                    Candidate(case_id=f"w{wid}b{b}c{i}", image_path=image,
                              # Unique text per candidate: identical text would
                              # render to an identical file and could be served
                              # from the driver's own on-disk cache.
                              text=f"{text}\n\n<!-- {wid} {b} {i} -->",
                              category=case["category"])
                    for i in range(per_batch)
                ]
                results = await pool.render(cands, work / f"b{b}")
                return sum(1 for r in results if r.ok)

            # `inflight` batches at a time, because that is the shape a worker
            # actually sees: a service handles several requests at once, and a
            # pool rendering one batch at a time leaves most of its pages idle.
            # Measuring the sequential case and calling it the renderer's ceiling
            # understates it by whatever the concurrency would have been.
            gate = asyncio.Semaphore(max(1, inflight))

            async def gated(b: int) -> int:
                async with gate:
                    return await one_batch(b)

            t0 = time.perf_counter()
            done = await asyncio.gather(*(gated(b) for b in range(batches)))
            elapsed = time.perf_counter() - t0
            return sum(done), batches * per_batch, elapsed
        finally:
            await pool.close()
            shutil.rmtree(work, ignore_errors=True)

    result_q.put((wid, *asyncio.run(run())))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, nargs="+", default=[1, 2, 4, 8])
    ap.add_argument("--browsers", type=int, nargs="+", default=[2])
    ap.add_argument("--pages", type=int, default=8)
    ap.add_argument("--batches", type=int, default=12, help="render batches per worker")
    ap.add_argument("--per-batch", type=int, default=4, help="candidates per batch")
    ap.add_argument("--inflight", type=int, default=4,
                    help="batches a worker renders at once (its request concurrency)")
    ap.add_argument("--no-precheck", action="store_true")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()

    rows = []
    print(f"{'workers':>8} {'browsers':>9} {'pages':>6} {'inflight':>9} "
          f"{'cand/s':>9} {'s/batch':>9} {'chromiums':>10}")
    for browsers in args.browsers:
        for workers in args.workers:
            ctx = mp.get_context("spawn")
            q: "mp.Queue" = ctx.Queue()
            procs = [
                ctx.Process(target=_worker,
                            args=(w, browsers, args.pages, args.batches,
                                  args.per_batch, args.inflight,
                                  not args.no_precheck, q))
                for w in range(workers)
            ]
            t0 = time.perf_counter()
            for p in procs:
                p.start()
            # Wall clock across all workers, not the sum of their own timers:
            # the workers overlap, and summing would count the overlap twice.
            collected = [q.get() for _ in procs]
            for p in procs:
                p.join()
            wall = time.perf_counter() - t0

            done = sum(c[1] for c in collected)
            total = sum(c[2] for c in collected)
            slowest = max(c[3] for c in collected)
            cand_s = done / slowest if slowest else 0.0
            # Batch latency with `inflight` of them in the air, so it is a
            # queueing-included figure, not a best case.
            sec_per_batch = slowest / (args.batches / max(1, args.inflight))
            row = {"workers": workers, "browsers": browsers, "pages": args.pages,
                   "inflight": args.inflight, "per_batch": args.per_batch,
                   "candidates": total, "rendered_ok": done,
                   "cand_per_s": round(cand_s, 2),
                   "sec_per_batch": round(sec_per_batch, 3),
                   "chromiums": workers * browsers,
                   "wall_sec": round(wall, 2)}
            rows.append(row)
            print(f"{workers:>8} {browsers:>9} {args.pages:>6} {args.inflight:>9} "
                  f"{cand_s:>9.2f} {sec_per_batch:>9.3f} {workers * browsers:>10}")
            if done != total:
                print(f"         ! only {done}/{total} candidates rendered ok")

    if args.out:
        args.out.write_text(json.dumps(rows, indent=2), encoding="utf-8")
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
