"""Find the forward pass's ceiling, with the renderer out of the way.

    python3 bench_backend.py --base-url http://127.0.0.1:8026 \
        --concurrency 1 4 8 16 32 64

Talks straight to `vllm serve`, sending the images that ship with the examples
rather than rendering anything. The number it reports is what the GPU can do, and
it is the ceiling the whole service is eventually limited by -- worth knowing
separately, because a service slower than this is slow for a reason you can fix,
and a service at this number is finished.

Every request is made unique by a single corner pixel. Without that, the backend's
multi-modal and prefix caches serve most of the traffic and the measurement
describes the cache rather than the model.

Saturation shows up as throughput going flat while latency keeps climbing in step
with concurrency: once throughput x p50 equals the concurrency, every extra
caller is queueing and nothing more is being served.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
EXAMPLES = HERE.parent / "examples"

import sys  # noqa: E402

sys.path.insert(0, str(HERE.parent))
from infer_vllm import build_prompt  # noqa: E402


def unique_data_url(raw: bytes, seed: int) -> str:
    with Image.open(io.BytesIO(raw)) as img:
        rgb = img.convert("RGB")
    rgb.putpixel((0, 0), (seed % 251, (seed // 251) % 251, 11))
    buf = io.BytesIO()
    rgb.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://127.0.0.1:8026")
    ap.add_argument("--model", default=None)
    ap.add_argument("--concurrency", type=int, nargs="+", default=[1, 4, 8, 16, 32, 64])
    ap.add_argument("--requests", type=int, default=96)
    ap.add_argument("--example", default="01_text_putnam")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()

    base = args.base_url.rstrip("/")
    with urllib.request.urlopen(f"{base}/v1/models", timeout=30) as resp:
        served = args.model or json.loads(resp.read().decode("utf-8"))["data"][0]["id"]

    folder = EXAMPLES / args.example
    case = json.loads((folder / "case.json").read_text(encoding="utf-8"))
    block = (folder / case["block_image"]).read_bytes()
    render = (folder / case["reference_render"]).read_bytes()
    text = case["candidates"][0]["text"]

    def body(seed: int) -> dict:
        return {
            "model": served,
            "messages": [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": unique_data_url(block, seed)}},
                {"type": "image_url", "image_url": {"url": unique_data_url(render, seed)}},
                {"type": "text", "text": build_prompt(text)},
            ]}],
            "use_activation": False,
            "add_generation_prompt": False,
        }

    def one(seed: int) -> tuple[bool, float]:
        data = json.dumps(body(seed)).encode("utf-8")
        req = urllib.request.Request(
            f"{base}/classify", data=data,
            headers={"Content-Type": "application/json"}, method="POST")
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                resp.read()
            return True, time.perf_counter() - t0
        except Exception:
            return False, time.perf_counter() - t0

    # Warm up on seeds far outside the measured range, so the first level does
    # not pay for graph capture and does not get a cache hit either.
    for seed in range(10 ** 7, 10 ** 7 + 4):
        one(seed)

    offset = 0
    rows = []
    print(f"{'conc':>5} {'req/s':>9} {'p50 ms':>9} {'p90 ms':>9} "
          f"{'rps*p50':>9} {'fail':>5}")
    for conc in args.concurrency:
        total = max(args.requests, conc * 4)
        seeds = list(range(offset, offset + total))
        offset += total

        lock = threading.Lock()
        lat: list[float] = []
        fails = 0

        def run(seed: int) -> None:
            nonlocal fails
            ok, dt = one(seed)
            with lock:
                if ok:
                    lat.append(dt)
                else:
                    fails += 1

        t0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=conc) as pool:
            list(pool.map(run, seeds))
        wall = time.perf_counter() - t0

        lat.sort()
        rps = len(lat) / wall if wall else 0.0
        p50 = lat[len(lat) // 2] if lat else 0.0
        p90 = lat[int(len(lat) * 0.9)] if lat else 0.0
        # Little's law: at saturation this equals the concurrency, and every
        # caller beyond it is just waiting in line.
        row = {"concurrency": conc, "requests": total, "ok": len(lat), "failures": fails,
               "req_per_s": round(rps, 3), "p50_ms": round(p50 * 1000, 1),
               "p90_ms": round(p90 * 1000, 1), "little": round(rps * p50, 2)}
        rows.append(row)
        print(f"{conc:>5} {rps:>9.2f} {p50 * 1000:>9.1f} {p90 * 1000:>9.1f} "
              f"{rps * p50:>9.2f} {fails:>5}")

    if args.out:
        args.out.write_text(json.dumps(rows, indent=2), encoding="utf-8")
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
