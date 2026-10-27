import numpy as np
import pytest
from PIL import Image

from minicpmvocr.pipeline._inputs import _iter_source_pages, _open_page_image
from minicpmvocr.constants import PDF_RENDER_PAGES_PER_JOB

fitz = pytest.importorskip("fitz", reason="PDF support needs PyMuPDF")

PAGES = 3


@pytest.fixture
def two_page_pdf(tmp_path):
    doc = fitz.open()
    for i in range(PAGES):
        page = doc.new_page(width=300, height=400)
        page.draw_rect(fitz.Rect(20, 20 + i * 10, 280, 120), color=(0, 0, 0), fill=(0.1, 0.2, 0.3))
    path = tmp_path / "sample.pdf"
    doc.save(path)
    doc.close()
    return path


@pytest.fixture
def many_page_pdf(tmp_path):

    doc = fitz.open()
    for i in range(PDF_RENDER_PAGES_PER_JOB + 4):
        page = doc.new_page(width=300, height=400)
        page.draw_rect(fitz.Rect(20, 20 + i * 5, 280, 120), color=(0, 0, 0), fill=(0.1, 0.2, 0.3))
    path = tmp_path / "many.pdf"
    doc.save(path)
    doc.close()
    return path


def _cfg(pdf_path, **pipeline_overrides):
    return {
        "input": {"file_path": str(pdf_path), "manifest": "", "image_dir": "", "files_dir": "", "limit": 0},
        "run": {"mode": "full"},
        "pipeline": pipeline_overrides,
    }


def test_pdf_pages_render_to_one_buffer_each(tmp_path, two_page_pdf):
    entries = _iter_source_pages(_cfg(two_page_pdf), tmp_path)

    assert len(entries) == PAGES
    for idx, entry in enumerate(entries):
        assert entry["source_type"] == "pdf"
        assert entry["page_index"] == idx
        width, height = entry["image_size"]
        assert len(entry["image_bytes"]) == width * height * 3


def test_rendered_buffer_matches_the_rasteriser_output(tmp_path, two_page_pdf):

    entries = _iter_source_pages(_cfg(two_page_pdf), tmp_path)

    doc = fitz.open(two_page_pdf)
    try:
        for entry in entries:
            pix = doc.load_page(entry["page_index"]).get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
            expected = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
            rendered = np.asarray(_open_page_image(entry))
            assert np.array_equal(rendered, expected)
    finally:
        doc.close()


def test_no_page_image_directory_is_written(tmp_path, two_page_pdf):

    intermediate = tmp_path / "intermediate"
    entries = _iter_source_pages(_cfg(two_page_pdf), intermediate)

    assert all(entry["image_path"] == "" for entry in entries)
    assert not (intermediate / "page_images").exists()


@pytest.mark.parametrize("render_workers", [2, 4])
def test_render_pool_agrees_with_the_serial_fallback(tmp_path, many_page_pdf, render_workers):

    serial_cfg = _cfg(many_page_pdf, render_workers=1)
    serial = _iter_source_pages(serial_cfg, tmp_path)
    pooled_cfg = _cfg(many_page_pdf, render_workers=render_workers)
    pooled = _iter_source_pages(pooled_cfg, tmp_path)

    assert serial_cfg["_meta"]["render_workers"] == 1
    assert pooled_cfg["_meta"]["render_workers"] == render_workers
    assert [e["image_size"] for e in serial] == [e["image_size"] for e in pooled]
    assert [e["image_bytes"] for e in serial] == [e["image_bytes"] for e in pooled]
