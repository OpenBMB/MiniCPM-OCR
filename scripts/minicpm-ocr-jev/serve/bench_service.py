"""Measure what the service actually does under load.

    python3 bench_service.py --base-url http://127.0.0.1:8030 \
        --concurrency 1 2 4 8 --requests 32 --candidates 4

Two measurement rules matter more than the numbers, because getting either one
wrong inflates the result rather than erroring:

  * Every request must be unique. Both halves of this service cache: the backend
    reuses multi-modal encodings and prefixes, and identical candidate text
    renders to an identical image. Replaying one payload measures cache hits.
    So each request gets its own candidate text and its own original image,
    differing in one corner pixel.
  * Every concurrency level needs several waves. With `total = max(requests,
    concurrency * 4)` the ramp-up and drain at the edges stay a small share of
    the window; at one or two waves they dominate and the number is noise.

Reported per level: requests/s, candidates/s, and the latency distribution. The
stage breakdown the service returns is averaged too, because the question this
benchmark exists to answer -- render or forward -- is answered by that split and
not by the totals.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
EXAMPLES = HERE.parent / "examples"


def unique_image(raw: bytes, seed: int) -> str:
    """The same block image, with one corner pixel set from `seed`.

    One pixel is enough to miss every cache and little enough not to change what
    the model sees in any way that matters.
    """
    with Image.open(io.BytesIO(raw)) as img:
        rgb = img.convert("RGB")
    rgb.putpixel((0, 0), (seed % 251, (seed // 251) % 251, 7))
    buf = io.BytesIO()
    rgb.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def post(url: str, payload: dict, timeout: float) -> tuple[int, dict | None, float]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"}, method="POST")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        return 200, body, time.perf_counter() - t0
    except urllib.error.HTTPError as exc:
        exc.read()
        return exc.code, None, time.perf_counter() - t0
    except Exception:
        return 0, None, time.perf_counter() - t0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://127.0.0.1:8030")
    ap.add_argument("--concurrency", type=int, nargs="+", default=[1, 2, 4, 8])
    ap.add_argument("--requests", type=int, default=32,
                    help="requests per level, raised to concurrency*4 when lower")
    ap.add_argument("--candidates", type=int, default=4, help="candidates per request")
    ap.add_argument("--example", default="01_text_putnam")
    ap.add_argument("--timeout", type=float, default=600.0)
    ap.add_argument("--out", type=Path, help="write the rows as JSON here")
    args = ap.parse_args()

    base = args.base_url.rstrip("/")
    case = json.loads((EXAMPLES / args.example / "case.json").read_text(encoding="utf-8"))
    raw = (EXAMPLES / args.example / case["block_image"]).read_bytes()
    base_text = case["candidates"][0]["text"]

    def build(seed: int) -> dict:
        return {
            "input_form": "ternary",
            "case_id": f"bench{seed}",
            "image": unique_image(raw, seed),
            # A trailing marker keeps each candidate's render distinct without
            # changing the structure of what is rendered.
            "candidates": [f"{base_text}\n\n<!-- {seed}-{k} -->"
                           for k in range(args.candidates)],
            "category": case["category"],
        }

    offset = 0
    rows = []
    # Warm-up uses seeds far from the measured range, so it cannot feed a cache
    # hit to the run that follows it.
    for seed in range(10 ** 6, 10 ** 6 + 2):
        post(f"{base}/v1/rm/score_best", build(seed), args.timeout)

    for conc in args.concurrency:
        total = max(args.requests, conc * 4)
        seeds = list(range(offset, offset + total))
        offset += total

        lock = threading.Lock()
        latencies: list[float] = []
        stages: list[dict] = []
        failures = 0

        def one(seed: int) -> None:
            nonlocal failures
            status, body, dt = post(f"{base}/v1/rm/score_best", build(seed), args.timeout)
            with lock:
                if status == 200 and body is not None:
                    latencies.append(dt)
                    stages.append(body.get("stage_sec", {}))
                else:
                    failures += 1

        t0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=conc) as pool:
            list(pool.map(one, seeds))
        wall = time.perf_counter() - t0

        ok = len(latencies)
        lat = sorted(latencies)
        row = {
            "concurrency": conc,
            "requests": total,
            "ok": ok,
            "failures": failures,
            "wall_sec": round(wall, 3),
            "req_per_s": round(ok / wall, 3) if wall else 0.0,
            "cand_per_s": round(ok * args.candidates / wall, 3) if wall else 0.0,
            "p50_ms": round(lat[len(lat) // 2] * 1000, 1) if lat else None,
            "p90_ms": round(lat[int(len(lat) * 0.9)] * 1000, 1) if lat else None,
            "mean_render_sec": round(statistics.mean(
                [s.get("render_sec", 0.0) for s in stages]), 3) if stages else None,
            "mean_forward_sec": round(statistics.mean(
                [s.get("forward_sec", 0.0) for s in stages]), 3) if stages else None,
        }
        rows.append(row)
        print(f"conc={conc:<4} {row['req_per_s']:>7.2f} req/s  "
              f"{row['cand_per_s']:>7.2f} cand/s  "
              f"p50 {row['p50_ms']:>8.1f}ms  p90 {row['p90_ms']:>8.1f}ms  "
              f"render {row['mean_render_sec']}s  forward {row['mean_forward_sec']}s  "
              f"fail {failures}")
        sys.stdout.flush()

    if args.out:
        args.out.write_text(json.dumps(rows, indent=2), encoding="utf-8")
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
