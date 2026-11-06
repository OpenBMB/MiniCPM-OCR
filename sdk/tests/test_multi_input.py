"""Several input files in one run: one result per file, plus the two image scopes."""
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from minicpmvocr.prompts import DEFAULT_PROMPT_MAP
from minicpmvocr.pipeline._sources import (
    read_sources,
    image_document_scope,
    page_lookup,
    write_sources,
)
from minicpmvocr.pipeline._response import RESPONSE_DIRNAME, page_response, assemble_documents_json
from minicpmvocr.postprocess.crosspage import (
    apply_cross_page_merge,
    assemble_document_markdown,
    assemble_documents_markdown,
    load_document_pages,
)
from minicpmvocr._utils import write_json


def _page_json(image_id, path, text, page_index=0):
    layout = {
        "image_id": image_id,
        "image_width": 100,
        "image_height": 200,
        "source": {"type": "pdf" if page_index is not None and path.endswith(".pdf") else "image",
                   "path": path, "page_index": page_index},
        "blocks": [],
    }
    page = page_response(layout=layout, blocks=[], markdown=text)
    page["ocr"]["blocks"] = []
    return page


def _write_run(tmp_path, sources, pages, scope="collection"):
    """sources: [(path, type, [image_id...])]; pages: {image_id: (text, blocks)}."""
    write_sources(tmp_path / "runtime", [
        {"source_type": kind, "source_path": path, "page_count": len(ids), "image_ids": ids}
        for path, kind, ids in sources
    ], scope)
    for image_id, (text, blocks) in pages.items():
        path = next(p for p, _k, ids in sources if image_id in ids)
        page_index = 0
        if path.endswith(".pdf"):
            page_index = next(k for k, i in enumerate(next(ids for p, _k, ids in sources if p == path)) if i == image_id)
        layout = {
            "image_id": image_id, "image_width": 100, "image_height": 200,
            "source": {"type": "pdf" if path.endswith(".pdf") else "image",
                       "path": path, "page_index": page_index if path.endswith(".pdf") else None},
            "blocks": [],
        }
        write_json(tmp_path / RESPONSE_DIRNAME / f"{image_id}.json",
                   page_response(layout=layout, blocks=[], markdown=text))
        write_json(tmp_path / "results_json" / f"{image_id}.json", {
            "image_id": image_id,
            "image_width": 100,
            "image_height": 200,
            "source": layout["source"],
            "crop_blocks": blocks,
            "markdown": text,
            "result_stage": "infer_final",
        })


def _block(content):
    return {"order": 0, "label": "text", "bbox": [0, 0, 10, 10], "content": content,
            "status": "ok"}


def _table(rows):
    html = "<table>" + "".join(
        "<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>" for row in rows) + "</table>"
    return {"order": 0, "label": "table", "bbox": [0, 0, 10, 10], "content": html,
            "status": "ok"}


def test_sources_manifest_round_trips(tmp_path):
    write_sources(tmp_path / "runtime", [
        {"source_type": "image", "source_path": "/in/a.png", "page_count": 1, "image_ids": ["a"]},
        {"source_type": "pdf", "source_path": "/in/b.pdf", "page_count": 2,
         "image_ids": ["b_page_001", "b_page_002"]},
    ], "file")
    manifest = read_sources(tmp_path)
    assert manifest["image_document_scope"] == "file"
    assert [s["source_id"] for s in manifest["sources"]] == ["s001", "s002"]
    assert [s["path"] for s in manifest["sources"]] == ["/in/a.png", "/in/b.pdf"]
    assert page_lookup(manifest)["b_page_002"]["source_id"] == "s002"
    assert page_lookup(manifest)["b_page_002"]["order"] == 1


def test_run_without_manifest_keeps_working(tmp_path):
    assert read_sources(tmp_path) is None
    assert image_document_scope(None, {"pipeline": {"image_document_scope": "file"}}) == "file"
    assert image_document_scope(None, {}) == "collection"
    assert image_document_scope({"image_document_scope": "file"}, {}) == "file"


def test_documents_json_one_entry_per_input_in_input_order(tmp_path):
    _write_run(tmp_path, [
        ("/in/b.png", "image", ["b"]),
        ("/in/a.png", "image", ["a"]),
        ("/in/doc.pdf", "pdf", ["doc_page_001", "doc_page_002"]),
    ], {"a": ("alpha", []), "b": ("beta", []), "doc_page_001": ("one", []),
        "doc_page_002": ("two", [])})
    document = assemble_documents_json(tmp_path)
    assert document["status"] == "Success"
    assert (document["files_done"], document["files_total"]) == (3, 3)
    assert [f["path"] for f in document["files"]] == ["/in/b.png", "/in/a.png", "/in/doc.pdf"]
    assert [f["markdown"] for f in document["files"]] == ["beta", "alpha", "one\n\ntwo"]
    assert document["files"][2]["pages_total"] == 2
    assert document["files"][0]["pages"][0]["metadata"]["source"] == "/in/b.png"


def test_documents_json_reports_partial_and_failed(tmp_path):
    _write_run(tmp_path, [
        ("/in/a.png", "image", ["a"]),
        ("/in/b.png", "image", ["b"]),
        ("/in/c.png", "image", ["c"]),
    ], {"a": ("alpha", [])})
    document = assemble_documents_json(tmp_path)
    assert document["status"] == "Partial"
    assert [f["status"] for f in document["files"]] == ["Success", "Failed", "Failed"]
    assert (document["files_done"], document["files_total"]) == (1, 3)

    fresh = tmp_path / "fresh"
    _write_run(fresh, [("/in/a.png", "image", ["a"])], {})
    assert assemble_documents_json(fresh)["status"] == "Failed"


def test_documents_markdown_is_one_document_per_input(tmp_path):
    _write_run(tmp_path, [
        ("/in/a.png", "image", ["a"]),
        ("/in/b.png", "image", ["b"]),
    ], {"a": ("alpha", []), "b": ("beta", [])})
    markdowns = assemble_documents_markdown(
        tmp_path, DEFAULT_PROMPT_MAP, merge_tables=False, delimiter="\n---\n")
    assert {k: v["markdown"] for k, v in markdowns.items()} == {"s001": "alpha", "s002": "beta"}


def test_collection_scope_merges_tables_across_images(tmp_path):
    _write_run(tmp_path, [
        ("/in/a.png", "image", ["a"]),
        ("/in/b.png", "image", ["b"]),
    ], {"a": ("", [_table([["h"], ["1"]])]), "b": ("", [_table([["h"], ["2"]])])})
    pages = load_document_pages(tmp_path)
    assert [p["document"] for p in pages] == ["", ""]
    assert set(apply_cross_page_merge(pages, DEFAULT_PROMPT_MAP)) == {"a", "b"}
    merged, _, merges = assemble_document_markdown(
        tmp_path, DEFAULT_PROMPT_MAP, merge_tables=True, delimiter="\n---\n")
    assert merges == 1 and merged.count("<table") == 1


def test_file_scope_keeps_each_image_separate(tmp_path):
    _write_run(tmp_path, [
        ("/in/a.png", "image", ["a"]),
        ("/in/b.png", "image", ["b"]),
    ], {"a": ("", [_table([["h"], ["1"]])]), "b": ("", [_table([["h"], ["2"]])])}, scope="file")
    pages = load_document_pages(tmp_path)
    assert [p["document"] for p in pages] == ["/in/a.png", "/in/b.png"]
    assert apply_cross_page_merge(pages, DEFAULT_PROMPT_MAP) == {}
    _, _, merges = assemble_document_markdown(
        tmp_path, DEFAULT_PROMPT_MAP, merge_tables=True, delimiter="\n---\n")
    assert merges == 0


def test_pdf_pages_still_merge_under_file_scope(tmp_path):
    _write_run(tmp_path, [
        ("/in/doc.pdf", "pdf", ["doc_page_001", "doc_page_002"]),
    ], {"doc_page_001": ("", [_table([["h"], ["1"]])]),
        "doc_page_002": ("", [_table([["h"], ["2"]])])}, scope="file")
    _, _, merges = assemble_document_markdown(
        tmp_path, DEFAULT_PROMPT_MAP, merge_tables=True, delimiter="\n---\n")
    assert merges == 1


def test_config_reads_file_paths_and_scope(tmp_path, monkeypatch):
    from minicpmvocr.config import load_config

    for name in ("a.png", "b.png"):
        Image.new("RGB", (10, 10)).save(tmp_path / name)
    model = tmp_path / "PP-DocLayoutV3_infer"
    model.mkdir()
    (model / "inference.pdiparams").write_bytes(b"w")
    config_path = tmp_path / "cfg.yaml"
    config_path.write_text(
        "input:\n  file_paths: [a.png, b.png]\n"
        "pipeline:\n  image_document_scope: file\n"
        f"layout:\n  model_dir: {model}\n"
        "engine:\n  type: vllm\n  server_url: http://localhost:1\n  model_name: m\n",
        encoding="utf-8")
    cfg = load_config(str(config_path))
    assert cfg["input"]["file_paths"] == [str(tmp_path / "a.png"), str(tmp_path / "b.png")]
    assert cfg["pipeline"]["image_document_scope"] == "file"


def test_config_rejects_unknown_scope_and_missing_file_paths(tmp_path):
    from minicpmvocr.config import load_config

    model = tmp_path / "PP-DocLayoutV3_infer"
    model.mkdir()
    (model / "inference.pdiparams").write_bytes(b"w")
    base = ("engine:\n  type: vllm\n  server_url: http://localhost:1\n  model_name: m\n"
            f"layout:\n  model_dir: {model}\n")
    bad_scope = tmp_path / "bad_scope.yaml"
    bad_scope.write_text("input:\n  image_dir: .\npipeline:\n  image_document_scope: pages\n" + base,
                         encoding="utf-8")
    with pytest.raises(ValueError, match="image_document_scope"):
        load_config(str(bad_scope))

    missing = tmp_path / "missing.yaml"
    missing.write_text("input:\n  file_paths: [nope.png]\n" + base, encoding="utf-8")
    with pytest.raises(FileNotFoundError, match="nope.png"):
        load_config(str(missing))


def _args(**kwargs):
    defaults = dict(path=[], input=[], inputs=[], run_tag="", split_images=False)
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_expanding_a_directory_takes_top_level_files_only(tmp_path):
    from minicpmvocr.cli import _resolve_parse_inputs

    for name in ("b.png", "a.png", "notes.txt"):
        (tmp_path / name).write_text("x")
    nested = tmp_path / "nested"
    nested.mkdir()
    (nested / "c.png").write_text("x")
    inputs = _resolve_parse_inputs(_args(path=[str(tmp_path)]))
    assert [p.name for p in inputs] == ["a.png", "b.png"]


def test_inputs_keep_order_and_drop_duplicates(tmp_path):
    from minicpmvocr.cli import _resolve_parse_inputs

    for name in ("a.png", "b.png"):
        (tmp_path / name).write_text("x")
    inputs = _resolve_parse_inputs(
        _args(path=[str(tmp_path / "b.png")], input=[str(tmp_path / "a.png"),
                                                    str(tmp_path / "b.png")]))
    assert [p.name for p in inputs] == ["b.png", "a.png"]


def test_output_names_prefix_shared_stems():
    from minicpmvocr.cli import _output_names

    names = _output_names([
        {"source_id": "s001", "path": "/x/a.png"},
        {"source_id": "s002", "path": "/y/a.png"},
        {"source_id": "s003", "path": "/z/b.pdf"},
    ])
    assert names == {"s001": "s001_a", "s002": "s002_a", "s003": "b"}


def test_split_images_sets_file_scope():
    from minicpmvocr.cli import _build_parse_overrides

    overrides = _build_parse_overrides(_args(inputs=[Path("/in/a.png")], split_images=True))
    assert overrides["pipeline"] == {"image_document_scope": "file"}
