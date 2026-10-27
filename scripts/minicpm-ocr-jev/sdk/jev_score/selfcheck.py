"""Startup gate: does this engine still assemble the training prompt?

The shipped image answers this by construction -- it carries a pass-through chat
template whose fingerprint is asserted at import. A self-installed deployment
cannot: the prompt is assembled by the engine, from the model's own
`chat_template.jinja`, under request flags that this SDK sets. Any of those three
can change without this code changing.

And when they do change, nothing breaks. The engine answers 200. The number is
in range, the ranking across candidates still looks sane, and it is not the
scale the checkpoint was trained on, because the value head pooled a different
position. The failure has no symptom, so it needs a test rather than a reader.

Hence this gate, which runs before the service accepts traffic and refuses to
start if it fails. Two assertions:

    tail   the last token id is 271 -- the final newline of the empty assistant
           turn, which is the position the classify path pools.
    whole  the engine's token sequence equals the local tokenizer's rendering of
           `build_prompt()`, token for token.

`tail` is the cheap one and catches the two documented ways to get this wrong
(`add_generation_prompt` defaulting to False, `enable_thinking` at the wrong
level), both of which land on 198. `whole` is stricter and needs `transformers`
and the weights on the same host, so it is optional and skipped with a loud note
when they are absent.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from .backends import Backend, BackendError
from .prompt import IMAGES_PER_PROMPT, PromptParts, build_parts, build_prompt

__all__ = ["EXPECTED_LAST_TOKEN", "SelfCheckResult", "run_selfcheck", "SelfCheckFailed"]

#: The final newline of `<|im_start|>assistant\n<think>\n\n</think>\n\n`. The
#: classify path pools the last token, so this id *is* the position the value
#: head reads. 198 is the near-miss: the same prompt with the assistant turn cut
#: short.
EXPECTED_LAST_TOKEN = 271

#: A text that exercises the parts of the prompt most likely to be mangled:
#: markup, a newline inside the text, and non-ASCII.
PROBE_TEXT = "<table><tr><td>参考</td><td>Accuracy (%)</td></tr></table>\nE = mc^2"


class SelfCheckFailed(RuntimeError):
    """The engine does not assemble the prompt this checkpoint was trained on."""


@dataclass
class SelfCheckResult:
    passed: bool
    last_token: int | None = None
    expected_last_token: int = EXPECTED_LAST_TOKEN
    n_tokens: int | None = None
    token_equality: str = "skipped"  # "equal" | "differs" | "skipped"
    scoring_request: str = "skipped"  # "carries the template keys" | "differs" | "skipped"
    notes: list[str] = field(default_factory=list)

    def raise_for_status(self) -> "SelfCheckResult":
        if not self.passed:
            raise SelfCheckFailed("\n".join(["prompt self-check failed:", *self.notes]))
        return self


async def run_selfcheck(
    backend: Backend,
    *,
    weights: str | Path | None = None,
    probe_text: str = PROBE_TEXT,
) -> SelfCheckResult:
    """Run the gate against a live engine.

    `weights` is a local checkpoint directory, used only for the stricter
    token-for-token comparison; `JEV_WEIGHTS` is read when it is not passed.
    """
    parts: PromptParts = build_parts(probe_text)
    result = SelfCheckResult(passed=False)

    scoring_note = _check_scoring_request(backend, parts)
    if scoring_note is not None:
        result.scoring_request = "differs"
        result.notes.append(scoring_note)
        return result
    result.scoring_request = "carries the template keys"

    try:
        tokens = await backend.tokenize(parts)
    except BackendError as exc:
        result.notes.append(f"engine could not tokenize the probe: {exc}")
        return result

    if tokens is None:
        result.notes.append(
            "this engine exposes no /tokenize endpoint, so the prompt it assembles "
            "cannot be checked before traffic arrives. Scores from it are unverified."
        )
        return result

    result.n_tokens = len(tokens)
    result.last_token = tokens[-1] if tokens else None

    if result.last_token != EXPECTED_LAST_TOKEN:
        result.notes.append(
            f"last token is {result.last_token}, expected {EXPECTED_LAST_TOKEN}.\n"
            "  The classify path pools the LAST token, so the value head is reading a\n"
            "  position it never read during training, and every score is off scale.\n"
            "  The usual causes, in order of likelihood:\n"
            "    * the engine was started WITH --chat-template; it must use the\n"
            "      model's own chat_template.jinja for this request shape\n"
            "    * add_generation_prompt is not reaching the engine as True\n"
            "    * enable_thinking was sent at the top level of the body instead of\n"
            "      inside chat_template_kwargs, where it is accepted and ignored"
        )
        return result

    # ── stricter half ────────────────────────────────────────────────────────
    weights = weights or os.environ.get("JEV_WEIGHTS")
    if not weights:
        result.notes.append(
            "token-for-token comparison skipped: no weights path given "
            "(pass weights=... or set JEV_WEIGHTS). The tail check above passed."
        )
        result.passed = True
        return result

    try:
        from transformers import AutoTokenizer
    except ImportError:
        result.notes.append(
            "token-for-token comparison skipped: transformers is not installed in "
            "this environment. The tail check above passed."
        )
        result.passed = True
        return result

    tok = AutoTokenizer.from_pretrained(str(weights))
    reference = tok(build_prompt(probe_text), add_special_tokens=False)["input_ids"]

    # The two sequences cannot be compared element by element, and the reason is
    # not a defect in either of them. The engine has already expanded each image
    # placeholder into one pad token per visual patch -- a count that depends on
    # the image's dimensions -- while `build_prompt` still holds the single
    # unexpanded placeholder. Every correct deployment differs here.
    #
    # What must match is all the *text*: the OCR segment between the two images,
    # and the instruction plus assistant turn after the second. So both sequences
    # are cut at their image spans and only the text between the cuts is compared.
    vision_start = tok.convert_tokens_to_ids("<|vision_start|>")
    vision_end = tok.convert_tokens_to_ids("<|vision_end|>")

    engine_text, engine_images = _strip_image_spans(tokens, vision_start, vision_end)
    reference_text, reference_images = _strip_image_spans(reference, vision_start, vision_end)

    if engine_images != IMAGES_PER_PROMPT or reference_images != IMAGES_PER_PROMPT:
        result.token_equality = "differs"
        result.notes.append(
            f"expected {IMAGES_PER_PROMPT} image spans in the prompt, found "
            f"{engine_images} from the engine and {reference_images} locally. "
            "Ternary input is original + render, always two."
        )
        return result

    if engine_text == reference_text:
        result.token_equality = "equal"
        result.passed = True
        result.notes.append(
            f"text matches build_prompt() token for token "
            f"({len(engine_text)} tokens outside the two image spans)"
        )
    else:
        result.token_equality = "differs"
        first = next(
            (i for i in range(min(len(engine_text), len(reference_text)))
             if engine_text[i] != reference_text[i]),
            min(len(engine_text), len(reference_text)),
        )
        result.token_equality = "differs"
        result.notes.append(
            "the text the engine assembles differs from build_prompt():\n"
            f"  first difference at text token {first} of "
            f"{len(engine_text)} (engine) / {len(reference_text)} (reference)\n"
            f"  engine    {engine_text[max(0, first - 8):first + 8]}\n"
            f"  reference {reference_text[max(0, first - 8):first + 8]}\n"
            f"  engine    {tok.decode(engine_text[max(0, first - 8):first + 8])!r}\n"
            f"  reference {tok.decode(reference_text[max(0, first - 8):first + 8])!r}\n"
            "  The tail check passed, so the pooled position is right, but the prompt\n"
            "  reaching the model is not the one it was trained on."
        )
    return result


#: What the scoring request must say out loud rather than leave to a default.
#: `use_activation` is here for the same reason as the other two: its default
#: returns activated probabilities, which rank identically and are on a different
#: scale -- the one kind of wrongness that every smoke test passes.
REQUIRED_SCORING_KEYS: dict[str, object] = {
    "add_generation_prompt": True,
    "chat_template_kwargs": {"enable_thinking": False},
    "use_activation": False,
}


def _check_scoring_request(backend: Backend, parts: PromptParts) -> str | None:
    """Does the body `forward` sends carry the keys it must? None if it does.

    This is the half of the check that the engine cannot answer. /classify
    replies with two numbers, so no amount of interrogating it reveals which
    prompt produced them; and the endpoint the token check *can* interrogate,
    /tokenize, defaults `add_generation_prompt` the other way. An adapter that
    quietly stopped sending the key would leave the token check green and every
    score wrong. So this one reads the outgoing request instead of the reply.
    """
    describe = getattr(backend, "describe_scoring_request", None)
    if describe is None:
        return None  # an adapter that cannot show its request is not checked here

    body = describe(parts)
    wrong = {
        key: (body.get(key, "<missing>"), expected)
        for key, expected in REQUIRED_SCORING_KEYS.items()
        if body.get(key, "<missing>") != expected
    }
    if not wrong:
        return None
    lines = [
        "the scoring request does not carry the keys it must:",
        *(f"    {key}: sends {got!r}, must send {want!r}" for key, (got, want) in wrong.items()),
        "  These cannot be left to the endpoint's default. On vLLM 0.32.0 /classify",
        "  defaults add_generation_prompt to False while /tokenize defaults it to",
        "  True, so the prompt check below would pass while the scores came from a",
        "  prompt with the assistant turn cut off.",
    ]
    return "\n".join(lines)


def _strip_image_spans(
    tokens: list[int], vision_start: int, vision_end: int
) -> tuple[list[int], int]:
    """Drop every `<|vision_start|> … <|vision_end|>` run; count how many there were.

    The markers go with the run. They are identical on both sides by
    construction, so keeping them would only pad the comparison with tokens that
    cannot disagree.
    """
    out: list[int] = []
    spans, inside = 0, False
    for tid in tokens:
        if tid == vision_start:
            inside, spans = True, spans + 1
            continue
        if tid == vision_end:
            inside = False
            continue
        if not inside:
            out.append(tid)
    return out, spans
