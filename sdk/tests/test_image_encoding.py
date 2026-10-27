import base64
import io

import numpy as np
from PIL import Image

from minicpmvocr.backends import PNG_COMPRESS_LEVEL, encode_image_b64


def _text_like_crop(width=520, height=70):

    rng = np.random.default_rng(0)
    pixels = np.full((height, width, 3), 245, dtype=np.uint8)
    top, bottom = height // 6, height - height // 6
    rows = bottom - top
    for x in range(4, max(width - 8, 5), 11):
        cols = min(6, width - x)
        pixels[top:bottom, x : x + cols] = rng.integers(0, 70, size=(rows, cols, 3), dtype=np.uint8)
    return Image.fromarray(pixels)


def test_encode_image_b64_is_lossless():
    image = _text_like_crop()
    decoded = Image.open(io.BytesIO(base64.b64decode(encode_image_b64(image)))).convert("RGB")
    assert np.array_equal(np.asarray(decoded), np.asarray(image))


def test_encode_image_b64_emits_png():
    image = _text_like_crop(64, 32)
    raw = base64.b64decode(encode_image_b64(image))
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"


def test_compress_level_stays_in_fast_lossless_range():

    assert 0 < PNG_COMPRESS_LEVEL <= 3


def test_non_png_format_ignores_compress_level():

    image = _text_like_crop(64, 32)
    raw = base64.b64decode(encode_image_b64(image, image_format="JPEG"))
    assert raw[:2] == b"\xff\xd8"
