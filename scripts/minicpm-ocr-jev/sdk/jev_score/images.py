"""Image bytes to the data URLs a backend accepts.

This is deliberately a near-copy of `serve/app.py::_data_url`, not an import of
it. Two reasons: importing `serve/app.py` builds a FastAPI application and reads
the service's environment as a side effect of the import, and `serve/` is frozen
-- the shipped image is built from it byte for byte, so it cannot grow a shared
module for this.

The behaviour it copies is the part that matters, and it is easy to get wrong in
a way nothing reports:

    an image that needs no padding is forwarded byte for byte.

Re-encoding everything through Pillow would be the obvious implementation and
would be wrong twice over. It costs CPU on the hot path, and it changes the
pixels the model sees -- a PNG round-trip is not the identity on an image that
arrived as JPEG, and the scores move without anything failing. The reference
service forwards untouched bytes, so this does too; `check_l1_parity.py` is what
proves the two still agree.
"""
from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image

from . import prompt as _prompt  # noqa: F401  (its import puts the material root on sys.path)
from infer_vllm import MAX_ASPECT_RATIO  # noqa: E402

__all__ = ["MAX_ASPECT_RATIO", "to_data_url", "read_data_url"]


def to_data_url(raw: bytes) -> str:
    """Encode image bytes as a data URL, padding extreme aspect ratios with white.

    Qwen3.5-VL's preprocessor refuses images longer than 200:1, and document block
    crops are routinely a few pixels tall. Such an image is padded rather than
    resized: padding keeps the glyphs at the scale the model was trained to
    compare against, resizing would not.
    """
    with Image.open(io.BytesIO(raw)) as img:
        fmt = (img.format or "PNG").upper()
        width, height = img.size
        longest, shortest = max(width, height), max(1, min(width, height))
        if longest / shortest <= MAX_ASPECT_RATIO:
            mime = "image/jpeg" if fmt in ("JPEG", "JPG") else "image/png"
            return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")

        rgb = img.convert("RGB")
        if width >= height:
            new_w, new_h = width, max(height, int(width / MAX_ASPECT_RATIO + 0.999999))
        else:
            new_h, new_w = height, max(width, int(height / MAX_ASPECT_RATIO + 0.999999))
        canvas = Image.new("RGB", (new_w, new_h), "white")
        canvas.paste(rgb, ((new_w - width) // 2, (new_h - height) // 2))

    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def read_data_url(path: str | Path) -> str:
    """`to_data_url` on a file's contents."""
    return to_data_url(Path(path).read_bytes())
