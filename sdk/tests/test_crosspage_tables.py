"Tests for cross-page table merging ported from PaddleOCR-VL's merge_table.py."

import pytest

from minicpmvocr.postprocess.crosspage import (
    apply_cross_page_merge,
    assemble_document_markdown,
    calculate_table_total_columns,
    can_merge_tables,
    detect_table_headers,
    full_to_half,
    merge_cross_page_tables,
    perform_table_merge,
)

pytest.importorskip("bs4", reason="cross-page merge needs beautifulsoup4")

from bs4 import BeautifulSoup  # noqa: E402


def _table(rows, header=("Name", "Qty")):

    head = "<tr>" + "".join(f"<td>{c}</td>" for c in header) + "</tr>"
    body = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f"<table>{head}{body}</table>"


def _block(label, content="", bbox=(0, 0, 100, 50)):
    return {"label": label, "content": content, "bbox": list(bbox)}


def _table_block(rows, bbox=(0, 0, 100, 50), header=("Name", "Qty")):
    return _block("table", _table(rows, header), bbox)


def _rows_of(html):
    return BeautifulSoup(html, "html.parser").find_all("tr")


def test_full_to_half_normalizes_fullwidth_ascii():
    assert full_to_half("（Ａ１）") == "(A1)"
    assert full_to_half("表格") == "表格"


def test_total_columns_accounts_for_rowspan():

    html = (
        "<table>"
        '<tr><td rowspan="2">A</td><td>B</td><td>C</td></tr>'
        "<tr><td>D</td><td>E</td></tr>"
        "</table>"
    )
    assert calculate_table_total_columns(BeautifulSoup(html, "html.parser")) == 3


def test_total_columns_survives_junk_spans():

    html = '<table><tr><td colspan="abc">A</td><td colspan="99999">B</td></tr></table>'
    assert calculate_table_total_columns(BeautifulSoup(html, "html.parser")) == 2


def test_detect_headers_counts_repeated_leading_rows():
    t1 = _table([["a", "1"]])
    t2 = _table([["b", "2"]])
    s1, s2 = BeautifulSoup(t1, "html.parser"), BeautifulSoup(t2, "html.parser")
    assert detect_table_headers(s1, s2) == 1


def test_detect_headers_is_zero_when_they_differ():
    t1 = _table([["a", "1"]], header=("Name", "Qty"))
    t2 = _table([["b", "2"]], header=("Other", "Cols"))
    s1, s2 = BeautifulSoup(t1, "html.parser"), BeautifulSoup(t2, "html.parser")
    assert detect_table_headers(s1, s2) == 0


def test_merges_a_plain_split_table():
    prev = [_table_block([["a", "1"], ["b", "2"]])]
    curr = [_table_block([["c", "3"]])]
    ok, prev_idx, curr_idx = can_merge_tables(prev, curr)
    assert ok and prev_idx == 0 and curr_idx == 0


def test_width_mismatch_blocks_the_merge():

    prev = [_table_block([["a", "1"]], bbox=(0, 0, 100, 50))]
    curr = [_table_block([["c", "3"]], bbox=(0, 0, 60, 50))]
    assert can_merge_tables(prev, curr)[0] is False


def test_text_after_the_first_table_blocks_the_merge():
    prev = [_table_block([["a", "1"]]), _block("text", "A closing paragraph.")]
    curr = [_table_block([["c", "3"]])]
    assert can_merge_tables(prev, curr)[0] is False


def test_footer_after_the_first_table_is_allowed():
    prev = [_table_block([["a", "1"]]), _block("footer", "page 3")]
    curr = [_table_block([["c", "3"]])]
    assert can_merge_tables(prev, curr)[0] is True


def test_text_before_the_second_table_blocks_the_merge():
    prev = [_table_block([["a", "1"]])]
    curr = [_block("text", "A new section begins."), _table_block([["c", "3"]])]
    assert can_merge_tables(prev, curr)[0] is False


def test_continued_caption_before_the_second_table_is_allowed():

    prev = [_table_block([["a", "1"]])]
    curr = [_block("figure_title", "Table 1 (continued)"), _table_block([["c", "3"]])]
    assert can_merge_tables(prev, curr)[0] is True


def test_chinese_continued_marker_is_allowed():
    prev = [_table_block([["a", "1"]])]
    curr = [_block("figure_title", "表 1（续）"), _table_block([["c", "3"]])]
    assert can_merge_tables(prev, curr)[0] is True


def test_incompatible_shapes_block_the_merge():
    prev = [_block("table", "<table><tr><td>a</td></tr></table>")]
    curr = [
        _block(
            "table",
            "<table><tr><td>b</td><td>c</td><td>d</td></tr>"
            "<tr><td>e</td><td>f</td><td>g</td></tr></table>",
        )
    ]
    assert can_merge_tables(prev, curr)[0] is False


def test_non_table_content_is_rejected():

    prev = [_block("table", "just some text")]
    curr = [_table_block([["c", "3"]])]
    assert can_merge_tables(prev, curr)[0] is False


def test_merge_drops_the_repeated_header():
    merged = perform_table_merge(_table([["a", "1"]]), _table([["b", "2"]]))
    rows = _rows_of(merged)
    assert len(rows) == 3
    assert merged.count("Name") == 1
    assert "a" in merged and "b" in merged


def test_merge_keeps_all_rows_when_there_is_no_repeated_header():
    t1 = _table([["a", "1"]], header=("Name", "Qty"))
    t2 = _table([["b", "2"]], header=("X", "Y"))
    rows = _rows_of(perform_table_merge(t1, t2))
    assert len(rows) == 4


def test_three_page_table_chains_into_one():

    pages = [
        [_table_block([["a", "1"]])],
        [_table_block([["b", "2"]])],
        [_table_block([["c", "3"]])],
    ]
    merged, count = merge_cross_page_tables(pages)
    assert count == 2
    rows = _rows_of(merged[0][0]["content"])
    assert len(rows) == 4
    for page in merged[1:]:
        assert page[0]["content"] == ""
        assert page[0]["merged_into_previous_page"] is True


def test_merge_does_not_mutate_the_input():
    pages = [[_table_block([["a", "1"]])], [_table_block([["b", "2"]])]]
    before = pages[0][0]["content"]
    merge_cross_page_tables(pages)
    assert pages[0][0]["content"] == before
    assert "merged_into_previous_page" not in pages[1][0]


def test_unrelated_pages_are_left_alone():
    pages = [[_block("text", "hello")], [_block("text", "world")]]
    merged, count = merge_cross_page_tables(pages)
    assert count == 0
    assert merged == pages


def _write_run(tmp_path, pages):

    import json

    results = tmp_path / "results_json"
    results.mkdir(parents=True)
    for i, (source, page_index, blocks) in enumerate(pages):
        image_id = f"p{i:03d}"
        (results / f"{image_id}.json").write_text(
            json.dumps(
                {
                    "image_id": image_id,
                    "source": {"path": source, "page_index": page_index},
                    "crop_blocks": blocks,
                    "markdown": "\n\n".join(b["content"] for b in blocks if b["content"]),
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    return tmp_path


def test_document_assembly_merges_only_when_asked(tmp_path):
    from minicpmvocr.prompts import DEFAULT_PROMPT_MAP

    run = _write_run(
        tmp_path,
        [
            ("/doc.pdf", 0, [_table_block([["a", "1"]])]),
            ("/doc.pdf", 1, [_table_block([["b", "2"]])]),
        ],
    )
    plain, pages, merges = assemble_document_markdown(
        run, DEFAULT_PROMPT_MAP, merge_tables=False, delimiter="\n---\n"
    )
    assert pages == 2 and merges == 0
    assert plain.count("<table") == 2

    merged, pages, merges = assemble_document_markdown(
        run, DEFAULT_PROMPT_MAP, merge_tables=True, delimiter="\n---\n"
    )
    assert pages == 2 and merges == 1
    assert merged.count("<table") == 1
    assert merged.count("Name") == 1


def test_document_assembly_never_merges_across_two_sources(tmp_path):

    from minicpmvocr.prompts import DEFAULT_PROMPT_MAP

    run = _write_run(
        tmp_path,
        [
            ("/a.pdf", 0, [_table_block([["a", "1"]])]),
            ("/b.pdf", 0, [_table_block([["b", "2"]])]),
        ],
    )
    _, _, merges = assemble_document_markdown(
        run, DEFAULT_PROMPT_MAP, merge_tables=True, delimiter="\n---\n"
    )
    assert merges == 0


def test_standalone_images_count_as_one_document(tmp_path):

    from minicpmvocr.prompts import DEFAULT_PROMPT_MAP

    run = _write_run(
        tmp_path,
        [
            ("/scan/page_001.png", None, [_table_block([["a", "1"]])]),
            ("/scan/page_002.png", None, [_table_block([["b", "2"]])]),
        ],
    )
    merged, pages, merges = assemble_document_markdown(
        run, DEFAULT_PROMPT_MAP, merge_tables=True, delimiter="\n---\n"
    )
    assert pages == 2 and merges == 1
    assert merged.count("<table") == 1


def test_document_assembly_orders_by_page_index_not_filename(tmp_path):

    from minicpmvocr.prompts import DEFAULT_PROMPT_MAP

    import json

    results = tmp_path / "results_json"
    results.mkdir(parents=True)
    for image_id, page_index, text in [("zzz", 0, "first"), ("aaa", 1, "second")]:
        (results / f"{image_id}.json").write_text(
            json.dumps(
                {
                    "image_id": image_id,
                    "source": {"path": "/doc.pdf", "page_index": page_index},
                    "crop_blocks": [],
                    "markdown": text,
                }
            ),
            encoding="utf-8",
        )
    out, _, _ = assemble_document_markdown(
        tmp_path, DEFAULT_PROMPT_MAP, merge_tables=False, delimiter="|"
    )
    assert out == "first|second"


def _page(image_id, blocks, document="/doc.pdf", page_index=0):
    return {
        "image_id": image_id,
        "document": document,
        "page_index": page_index,
        "markdown": "\n\n".join(b["content"] for b in blocks if b["content"]),
        "blocks": blocks,
    }


def test_change_set_labels_extended_and_absorbed():

    from minicpmvocr.prompts import DEFAULT_PROMPT_MAP

    pages = [
        _page("p1", [_table_block([["a", "1"]])], page_index=0),
        _page("p2", [_table_block([["b", "2"]])], page_index=1),
    ]
    changes = apply_cross_page_merge(pages, DEFAULT_PROMPT_MAP)
    assert set(changes) == {"p1", "p2"}
    assert changes["p1"]["extended"] is True and changes["p1"]["absorbed"] is False
    assert changes["p2"]["absorbed"] is True and changes["p2"]["extended"] is False
    assert changes["p1"]["markdown"].count("<tr") == 3
    assert changes["p2"]["markdown"].strip() == ""

    assert any(b.get("merged_into_previous_page") for b in changes["p2"]["blocks"])


def test_change_set_is_empty_when_nothing_merges():

    from minicpmvocr.prompts import DEFAULT_PROMPT_MAP

    pages = [
        _page("p1", [_block("text", "hello")], page_index=0),
        _page("p2", [_block("text", "world")], page_index=1),
    ]
    assert apply_cross_page_merge(pages, DEFAULT_PROMPT_MAP) == {}


def test_change_set_does_not_mutate_input_pages():
    from minicpmvocr.prompts import DEFAULT_PROMPT_MAP

    pages = [
        _page("p1", [_table_block([["a", "1"]])], page_index=0),
        _page("p2", [_table_block([["b", "2"]])], page_index=1),
    ]
    before = [p["markdown"] for p in pages]
    apply_cross_page_merge(pages, DEFAULT_PROMPT_MAP)
    assert [p["markdown"] for p in pages] == before
    assert "merged_into_previous_page" not in pages[1]["blocks"][0]
