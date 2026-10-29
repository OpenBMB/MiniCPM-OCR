import copy
import re

import numpy as np
import pytest
from PIL import Image

from minicpmvocr.cli import _absolute_image_links, _sync_markdown_images
from minicpmvocr.pipeline._blocks import _attach_output_images
from minicpmvocr.postprocess.markdown import assemble_markdown
from minicpmvocr.prompts import DEFAULT_PROMPT_MAP, get_element_cfg, load_prompt_map


IMAGE_PATH = "imgs/page/002_img_in_image_box_95_301_1148_1574.png"
DRAWING_TEXT = "7号交叉口平面布置图\n1:150"


def _prompt_map(**assembly):
    prompt_map = copy.deepcopy(DEFAULT_PROMPT_MAP)
    prompt_map["markdown_assembly"].update(assembly)
    return prompt_map


def _image(content=DRAWING_TEXT, image_path=IMAGE_PATH, label="image", order=0):
    block = {"order": order, "label": label, "content": content}
    if image_path:
        block["image_path"] = image_path
    return block


def _load(tmp_path=None, use_ocr_for_image_block=False, external=None):
    prompt_map_path = ""
    if external is not None:
        prompt_map_path = tmp_path / "prompt_map.yaml"
        prompt_map_path.write_text(external, encoding="utf-8")
    return load_prompt_map({
        "prompt": {"prompt_map": str(prompt_map_path), "override_mode": "legacy"},
        "layout": {"use_ocr_for_image_block": use_ocr_for_image_block},
    })


def test_unrecognized_image_links_the_crop():
    out = assemble_markdown([_image(content="")], _prompt_map())
    assert out == "![image](%s)" % IMAGE_PATH
    # Plain markdown image syntax, so text-only consumers can strip it.
    assert re.sub(r"!\[.*?\]\(.*?\)", "", out) == ""


def test_recognized_image_text_follows_the_reference():
    out = assemble_markdown([_image()], _prompt_map())
    assert out == "![image](%s)\n\n%s" % (IMAGE_PATH, DRAWING_TEXT)


def test_recognized_image_text_can_be_hidden():
    out = assemble_markdown([_image()], _prompt_map(image_show_ocr_content=False))
    assert out == "![image](%s)" % IMAGE_PATH


@pytest.mark.parametrize("assembly, block", [
    ({"image_render": "placeholder"}, _image()),
    ({}, _image(image_path=None)),
])
def test_placeholder_fallback_keeps_recognized_text(assembly, block):
    out = assemble_markdown([block], _prompt_map(**assembly))
    assert out == "![image]()\n\n" + DRAWING_TEXT


def test_issue_12_reproduction_keeps_image_text():
    blocks = [
        {"order": 0, "label": "image", "content": "main bore right tunnel / reinforcement section / 500 / 250"},
        {"order": 1, "label": "chart", "content": "<table><tr><td>A</td></tr></table>"},
        {"order": 2, "label": "seal", "content": "Design Institute"},
    ]
    assert assemble_markdown(blocks, copy.deepcopy(DEFAULT_PROMPT_MAP)) == (
        "![image]()\n\nmain bore right tunnel / reinforcement section / 500 / 250"
        "\n\n<table><tr><td>A</td></tr></table>\n\nDesign Institute"
    )


def test_image_format_content_template():
    prompt_map = _prompt_map(image_render="placeholder", image_format="{content}")
    assert assemble_markdown([_image()], prompt_map) == DRAWING_TEXT
    text = {"order": 1, "label": "text", "content": "body"}
    assert assemble_markdown([_image(content=""), text], prompt_map) == "body"


def test_header_and_footer_images_are_ignored_by_default():
    blocks = [
        _image(label="header_image", order=0),
        {"order": 1, "label": "text", "content": "body"},
        _image(label="footer_image", order=2),
    ]
    assert assemble_markdown(blocks, _prompt_map()) == "body"


@pytest.mark.parametrize("label", ["chart", "seal"])
def test_chart_and_seal_render_as_images_only_without_content(label):
    prompt_map = _prompt_map()
    assert assemble_markdown([_image(content="<table></table>", label=label)], prompt_map) == "<table></table>"
    assert assemble_markdown([_image(content="", label=label)], prompt_map) == "![image](%s)" % IMAGE_PATH


def test_unknown_image_render_mode_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="image_render"):
        assemble_markdown([_image()], _prompt_map(image_render="html"))
    with pytest.raises(ValueError, match="image_render"):
        _load(tmp_path, external="markdown_assembly:\n  image_render: html\n")


@pytest.mark.parametrize("layout_cfg", [
    {"use_ocr_for_image_block": True},
    {"use_ocr_for_image_block": False, "skip_vlm_labels": []},
])
def test_every_way_of_recognizing_images_shows_their_text(layout_cfg):
    prompt_map = load_prompt_map({"prompt": {"prompt_map": "", "override_mode": "legacy"}, "layout": layout_cfg})
    assert get_element_cfg(prompt_map, "image") is not None
    assert assemble_markdown([_image()], prompt_map) == "![image](%s)\n\n%s" % (IMAGE_PATH, DRAWING_TEXT)


def test_prompt_map_can_hide_recognized_image_text(tmp_path):
    prompt_map = _load(tmp_path, True, "markdown_assembly:\n  image_show_ocr_content: false\n")
    assert assemble_markdown([_image()], prompt_map) == "![image](%s)" % IMAGE_PATH


def test_external_prompt_map_merges_into_the_defaults(tmp_path):
    prompt_map = _load(tmp_path, external=(
        "markdown_assembly:\n  image_format: '{content}'\n"
        "element_prompts:\n  table:\n    max_new_tokens: 16\n"
    ))
    assembly = prompt_map["markdown_assembly"]
    assert assembly["image_format"] == "{content}"
    assert assembly["title_format"] == DEFAULT_PROMPT_MAP["markdown_assembly"]["title_format"]
    assert assembly["ignore_labels"] == DEFAULT_PROMPT_MAP["markdown_assembly"]["ignore_labels"]
    assert prompt_map["element_prompts"]["table"]["max_new_tokens"] == 16
    assert prompt_map["element_prompts"]["table"]["prompt"] == "Table Recognition:"
    assert "seal" in prompt_map["element_prompts"]


def _crop_blocks():
    return [
        {"order": 0, "label": "text", "content": "body", "crop_filename": "000_text.png", "bbox": [0, 0, 4, 2]},
        {"order": 1, "label": "image", "content": "", "crop_filename": "001_image.png", "bbox": [1, 2, 5, 6]},
        {"order": 2, "label": "chart", "content": "<table></table>", "crop_filename": "002_chart.png", "bbox": [0, 0, 4, 2]},
        {"order": 3, "label": "seal", "content": "", "crop_filename": "003_seal.png", "bbox": [0, 0, 4, 2]},
        {"order": 4, "label": "header_image", "content": "", "crop_filename": "004_header_image.png", "bbox": [0, 0, 4, 2]},
    ]


def _crop_arrays():
    return {
        block["crop_filename"]: np.full((2, 4, 3), index, dtype=np.uint8)
        for index, block in enumerate(_crop_blocks())
    }


def test_rendered_image_crops_are_published_from_memory(tmp_path):
    blocks = _crop_blocks()
    _attach_output_images(tmp_path, "page", blocks, _prompt_map(), _crop_arrays())
    paths = {block["label"]: block.get("image_path") for block in blocks}
    assert paths == {
        "text": None,
        "image": "imgs/page/001_img_in_image_box_1_2_5_6.png",
        "chart": None,
        "seal": "imgs/page/003_img_in_seal_box_0_0_4_2.png",
        "header_image": None,
    }
    published = sorted(p.name for p in (tmp_path / "output" / "imgs" / "page").iterdir())
    assert published == ["001_img_in_image_box_1_2_5_6.png", "003_img_in_seal_box_0_0_4_2.png"]
    assert np.asarray(Image.open(tmp_path / "output" / paths["image"])).max() == 1


def test_rendered_image_crops_are_copied_from_disk(tmp_path):
    crops_dir = tmp_path / "runtime" / "intermediate" / "crops" / "page"
    crops_dir.mkdir(parents=True)
    for name, array in _crop_arrays().items():
        Image.fromarray(array).save(crops_dir / name)
    blocks = _crop_blocks()
    _attach_output_images(tmp_path, "page", blocks, _prompt_map())
    assert (tmp_path / "output" / blocks[1]["image_path"]).read_bytes() == (crops_dir / "001_image.png").read_bytes()


def test_placeholder_mode_publishes_nothing(tmp_path):
    blocks = _crop_blocks()
    _attach_output_images(tmp_path, "page", blocks, _prompt_map(image_render="placeholder"), _crop_arrays())
    assert not any("image_path" in block for block in blocks)
    assert not (tmp_path / "output").exists()


def test_sync_merges_into_an_existing_imgs_dir(tmp_path):
    run_dir = tmp_path / "run"
    (run_dir / "output" / "imgs" / "page").mkdir(parents=True)
    (run_dir / "output" / "imgs" / "page" / "001.png").write_bytes(b"crop")
    user_imgs = tmp_path / "out" / "imgs"
    user_imgs.mkdir(parents=True)
    (user_imgs / "photo.jpg").write_bytes(b"user")

    _sync_markdown_images(run_dir, "![image](imgs/page/001.png)", tmp_path / "out" / "doc.md")

    assert (user_imgs / "photo.jpg").read_bytes() == b"user"
    assert (user_imgs / "page" / "001.png").read_bytes() == b"crop"


def test_sync_skips_markdown_without_image_links(tmp_path):
    run_dir = tmp_path / "run"
    (run_dir / "output" / "imgs").mkdir(parents=True)
    _sync_markdown_images(run_dir, "see imgs/ folder\n\n![image]()", tmp_path / "out" / "doc.md")
    assert not (tmp_path / "out").exists()


def test_stdout_links_point_into_the_run(tmp_path):
    run_dir = tmp_path / "run"
    root = (run_dir / "output").resolve().as_posix()
    markdown = "![image](imgs/page/001.png)\n\nsee imgs/notes\n\n![image]()"
    assert _absolute_image_links(markdown, run_dir) == (
        "![image](%s/imgs/page/001.png)\n\nsee imgs/notes\n\n![image]()" % root
    )
    spaced = tmp_path / "my run"
    root = (spaced / "output").resolve().as_posix()
    assert _absolute_image_links("![image](imgs/a.png)", spaced) == "![image](<%s/imgs/a.png>)" % root
