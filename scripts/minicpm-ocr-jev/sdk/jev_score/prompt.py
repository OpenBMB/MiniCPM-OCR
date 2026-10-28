"""The prompt, in the two shapes the backends need it.

The bytes themselves are not defined here. They live in `infer_vllm.py` at the
root of this material, which asserts their fingerprint at import time; a second
copy would be a second thing to keep in step, and the one that drifted would go
on producing plausible numbers. So this module only *arranges* them.

Two arrangements are needed, because the engines disagree about who applies the
chat template:

  parts      vLLM's /classify applies the model's own `chat_template.jinja` to a
             content list. The interleaving -- image, text, image, text -- is what
             makes the rendered result equal the training prompt.

  raw        SGLang's /classify takes the finished prompt string and applies no
             template at all. That is what `build_prompt()` already returns.

  ocr_text   llama.cpp's and Ollama's /v1/systemone take the candidate text bare
             and wrap it in a template baked into the GGUF. Neither of the two
             arrangements above fits: `raw` would be wrapped a second time, and
             the segments carry the prompt's own punctuation around the text.

Both are built from the same source, so they cannot disagree about the words.
What they *can* disagree about is the handful of tokens a template adds at the
end, which is why `selfcheck.py` exists.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

#: Material root: this file is <root>/sdk/jev_score/prompt.py.
MATERIAL_ROOT = Path(__file__).resolve().parents[2]
if str(MATERIAL_ROOT) not in sys.path:
    sys.path.insert(0, str(MATERIAL_ROOT))

from infer_vllm import (  # noqa: E402
    IMAGES_PER_PROMPT,
    INSTRUCTION,
    PROMPT_TEMPLATE_MD5,
    build_prompt,
)

__all__ = [
    "IMAGES_PER_PROMPT",
    "INSTRUCTION",
    "PROMPT_TEMPLATE_MD5",
    "PromptParts",
    "build_parts",
    "build_prompt",
]


@dataclass(frozen=True)
class PromptParts:
    """One candidate's prompt, ready for either kind of backend.

    `text_after_original` and `text_after_render` are the two text segments that
    sit between and after the two image placeholders. `raw` is the same prompt as
    a finished string, for engines that do not apply a template. `ocr_text` is the
    candidate text with nothing around it, for engines that hold the template
    themselves and want only the part that varies.
    """

    text_after_original: str
    text_after_render: str
    raw: str
    ocr_text: str


def build_parts(ocr_text: str) -> PromptParts:
    """Arrange the prompt for one candidate's OCR text.

    `ocr_text` goes in exactly as given -- no strip, no newline normalisation.
    Whitespace at either end is part of what the model is being asked to judge:
    it is in the rendered image too, and the training data kept it.

    The leading newlines on both text segments are not cosmetic. The chat
    template emits an image placeholder with no trailing newline, while the
    training prompt has one after each; carrying it on the front of the following
    text segment is what closes that gap. Drop either and the prompt still
    renders, still scores, and is no longer the prompt this checkpoint was
    trained on -- see `selfcheck.py`, which is there to catch exactly that.
    """
    return PromptParts(
        text_after_original=f"\nOCR文本：\n{ocr_text}\n",
        text_after_render="\n" + INSTRUCTION,
        raw=build_prompt(ocr_text),
        ocr_text=ocr_text,
    )
