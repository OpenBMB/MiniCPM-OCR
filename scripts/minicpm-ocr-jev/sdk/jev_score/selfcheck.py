"""Startup gate: is this engine going to score the prompt this model was trained on?

The shipped image answers that by construction -- it carries a pass-through chat
template whose fingerprint is asserted at import. A self-installed deployment
cannot, and *how* it cannot depends on which engine runs it, because the engines
do not divide the work the same way:

    vLLM        we hand it a content list; its copy of the model's
                chat_template.jinja assembles the prompt      -> prompt_source "engine"
    SGLang      we hand it a finished prompt string; it
                applies no template at all                    -> prompt_source "client"
    llama.cpp   the template is baked into the GGUF and runs
    Ollama      server-side, where we cannot read it           -> prompt_source "server_template"

The failure is the same in all three cases and has no symptom: the engine answers
200, the number is in range, the ranking across candidates still looks sane, and
it is not the scale the checkpoint was trained on. So each one needs a test
rather than a reader -- but not the same test, because what can go wrong moves:

  * With "engine" the prompt is assembled out of our sight, so the engine is the
    one that has to be interrogated: tokenize the probe and compare.
  * With "client" nothing downstream can touch the prompt, so interrogating the
    engine proves nothing -- it would only confirm it can tokenize a string we
    just handed it. What can go wrong is on our side, so the check reads the
    outgoing request and compares it against `build_prompt()`.
  * With "server_template" neither is possible. That is a fact to report rather
    than paper over: the gate says so, and the service starts knowing the scale
    of its scores is established only by comparison against a known backend.

One check does apply to all three, and it is the only one that catches an engine
serving the wrong model class: ask for one real forward pass and count the
numbers that come back. Two is a classifier; two thousand is a hidden state.
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

#: 1x1 white PNG. The forward-shape check needs two images of *some* size, and
#: the pixels are irrelevant to what it asserts, so one pixel keeps startup fast.
PIXEL_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

#: What the two numbers are called, per `Backend.output_kind`. Only wording --
#: the check itself is the same one either way, because what it rules out
#: (an engine serving the generative class) looks the same in both families.
_OUTPUT_NOUN = {"logits": "logits", "probabilities": "probabilities"}

#: What `scoring_request` reports once the per-source check passes.
_SCORING_OK = {
    "engine": "carries the template keys",
    "client": "carries the finished prompt",
    "server_template": "skipped",
}


class SelfCheckFailed(RuntimeError):
    """The engine does not assemble the prompt this checkpoint was trained on."""


@dataclass
class SelfCheckResult:
    passed: bool
    prompt_source: str = "engine"  # "engine" | "client" | "server_template"
    last_token: int | None = None
    expected_last_token: int = EXPECTED_LAST_TOKEN
    n_tokens: int | None = None
    token_equality: str = "skipped"  # "equal" | "differs" | "skipped"
    scoring_request: str = "skipped"  # see _SCORING_OK, or "differs"
    forward_shape: str = "skipped"  # "2 logits" | "2 probabilities" | "differs" | "skipped"
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
    token-level comparison; `JEV_WEIGHTS` is read when it is not passed.
    """
    parts: PromptParts = build_parts(probe_text)
    source = str(getattr(backend, "prompt_source", "engine"))
    kind = str(getattr(backend, "output_kind", "logits"))
    result = SelfCheckResult(passed=False, prompt_source=source)

    # ── 1. what goes out on the wire ─────────────────────────────────────────
    scoring_note = _check_scoring_request(backend, parts, source, probe_text)
    if scoring_note is not None:
        result.scoring_request = "differs"
        result.notes.append(scoring_note)
        return result
    result.scoring_request = _SCORING_OK.get(source, "skipped")

    # ── 2. does this engine answer like a classifier at all ──────────────────
    shape_note = await _check_forward_shape(backend, parts)
    if shape_note is not None:
        result.forward_shape = "differs"
        result.notes.append(shape_note)
        return result
    # Named after what this engine actually returned, not after the one family the
    # check was first written for: a reader comparing /healthz across two legs is
    # entitled to see which side of that difference each one is on.
    result.forward_shape = f"2 {_OUTPUT_NOUN.get(kind, 'numbers')}"

    # ── 3. is the prompt the training prompt ─────────────────────────────────
    if source == "engine":
        return await _check_engine_prompt(backend, parts, result, weights, probe_text)
    if source == "client":
        return _check_local_prompt(result, weights, probe_text)

    result.notes.append(
        "this engine builds the prompt from a template of its own that cannot be "
        "read from here, so the prompt itself is not checked before traffic "
        "arrives. The forward-shape check above passed; the scale of the scores "
        "has to be established by comparing against a known backend on the same "
        "inputs."
    )
    result.passed = True
    return result


# ── 1. the outgoing request ──────────────────────────────────────────────────

#: What a templating engine's scoring request must say out loud rather than
#: leave to a default. `use_activation` is here for the same reason as the other
#: two: its default returns activated probabilities, which rank identically and
#: are on a different scale -- the one kind of wrongness that every smoke test
#: passes.
REQUIRED_SCORING_KEYS: dict[str, object] = {
    "add_generation_prompt": True,
    "chat_template_kwargs": {"enable_thinking": False},
    "use_activation": False,
}


def _check_scoring_request(
    backend: Backend, parts: PromptParts, source: str, probe_text: str
) -> str | None:
    """Does the body `forward` sends carry what it must? None if it does."""
    describe = getattr(backend, "describe_scoring_request", None)
    if describe is None:
        return None  # an adapter that cannot show its request is not checked here

    body = describe(parts)
    if source == "client":
        return _check_client_body(body, probe_text)
    if source == "engine":
        return _check_template_keys(body)
    return None


def _check_template_keys(body: dict) -> str | None:
    """The engine assembles the prompt, so the flags that steer it must be sent.

    This is the half of the check that the engine cannot answer. /classify
    replies with two numbers, so no amount of interrogating it reveals which
    prompt produced them; and the endpoint the token check *can* interrogate,
    /tokenize, defaults `add_generation_prompt` the other way. An adapter that
    quietly stopped sending the key would leave the token check green and every
    score wrong. So this one reads the outgoing request instead of the reply.
    """
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


def _check_client_body(body: dict, probe_text: str) -> str | None:
    """We assemble the prompt, so what gets checked is what we assembled.

    For such a backend this is the prompt check, not a preliminary to it -- and
    it is the stricter of the two kinds: it compares the exact string that will
    be sent, rather than a tokenization of a probe that resembles it.
    """
    expected = build_prompt(probe_text)
    sent = body.get("text")
    if sent != expected:
        if not isinstance(sent, str):
            return (
                "the scoring request carries no prompt string: 'text' is "
                f"{type(sent).__name__}, expected the output of build_prompt()"
            )
        first = next(
            (i for i in range(min(len(sent), len(expected))) if sent[i] != expected[i]),
            min(len(sent), len(expected)),
        )
        return (
            "the prompt this adapter sends is not build_prompt():\n"
            f"  first difference at character {first} of "
            f"{len(sent)} (sent) / {len(expected)} (expected)\n"
            f"  sent     {sent[max(0, first - 30):first + 30]!r}\n"
            f"  expected {expected[max(0, first - 30):first + 30]!r}"
        )

    images = body.get("image_data")
    if not isinstance(images, list) or len(images) != IMAGES_PER_PROMPT:
        got = len(images) if isinstance(images, list) else type(images).__name__
        return (
            f"the scoring request carries {got} images, expected {IMAGES_PER_PROMPT}. "
            "Ternary input is original + render, always two, in that order."
        )
    return None


# ── 2. the forward pass ──────────────────────────────────────────────────────


async def _check_forward_shape(backend: Backend, parts: PromptParts) -> str | None:
    """Ask for one real score and count the numbers. None if two came back.

    The only check here that runs the model, and the only one that catches an
    engine serving the wrong class: a checkpoint loaded as its generative self
    answers the same endpoint with a hidden state of a few thousand dimensions.
    Two numbers is the whole assertion -- their values mean nothing, because the
    images are one white pixel.
    """
    try:
        logits = await backend.forward(parts, PIXEL_PNG, PIXEL_PNG)
    except BackendError as exc:
        return (
            f"the engine could not score the startup probe: {exc}\n"
            "  Nothing can be verified about an engine that does not answer."
        )
    if len(logits) != 2:
        noun = _OUTPUT_NOUN.get(str(getattr(backend, "output_kind", "logits")), "numbers")
        return (
            f"the engine returned {len(logits)} numbers for one candidate, expected "
            f"2 class {noun}. This checkpoint may not be loaded as a 2-class "
            "sequence-classification model."
        )
    return None


# ── 3a. the prompt, when the engine assembles it ─────────────────────────────


async def _check_engine_prompt(
    backend: Backend,
    parts: PromptParts,
    result: SelfCheckResult,
    weights: str | Path | None,
    probe_text: str,
) -> SelfCheckResult:
    """Two assertions against the engine's own assembly.

        tail   the last token id is 271 -- the final newline of the empty
               assistant turn, which is the position the classify path pools.
        whole  the engine's token sequence equals the local tokenizer's
               rendering of `build_prompt()`, token for token.

    `tail` is the cheap one and catches the two documented ways to get this wrong
    (`add_generation_prompt` defaulting to False, `enable_thinking` at the wrong
    level), both of which land on 198. `whole` is stricter and needs
    `transformers` and the weights on the same host, so it is optional and
    skipped with a loud note when they are absent.
    """
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

    reference = _local_reference_tokens(result, weights, probe_text)
    if reference is None:
        result.passed = True  # the note explaining the skip is already in place
        return result
    tok, reference_ids = reference

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
    reference_text, reference_images = _strip_image_spans(reference_ids, vision_start, vision_end)

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


# ── 3b. the prompt, when we assemble it ──────────────────────────────────────


def _check_local_prompt(
    result: SelfCheckResult, weights: str | Path | None, probe_text: str
) -> SelfCheckResult:
    """Tokenize our own prompt and confirm it pools where training pooled.

    The string itself was already compared against `build_prompt()` in step 1,
    which is the assertion that carries the weight for this backend. This adds
    the one thing a string comparison cannot show: that the string tokenizes to a
    sequence ending on token 271, the position the value head reads. It needs the
    local tokenizer, so it is skipped -- not failed -- when the weights are not
    on this host.
    """
    reference = _local_reference_tokens(result, weights, probe_text)
    if reference is None:
        result.passed = True  # the note explaining the skip is already in place
        return result
    _, reference_ids = reference

    result.n_tokens = len(reference_ids)
    result.last_token = reference_ids[-1] if reference_ids else None
    if result.last_token != EXPECTED_LAST_TOKEN:
        result.token_equality = "differs"
        result.notes.append(
            f"build_prompt() tokenizes to a sequence ending on {result.last_token}, "
            f"expected {EXPECTED_LAST_TOKEN}.\n"
            "  The classify path pools the LAST token. The prompt string itself\n"
            "  matches its fingerprint, so this points at the tokenizer in the\n"
            "  weights directory rather than at the prompt."
        )
        return result

    result.token_equality = "equal"
    result.passed = True
    result.notes.append(
        f"the prompt we send matches build_prompt() character for character and "
        f"tokenizes to {len(reference_ids)} tokens ending on {EXPECTED_LAST_TOKEN}"
    )
    return result


def _local_reference_tokens(
    result: SelfCheckResult, weights: str | Path | None, probe_text: str
) -> tuple[object, list[int]] | None:
    """The local tokenizer's ids for `build_prompt(probe_text)`, if available.

    Returns None and appends the reason when `transformers` or the weights are
    missing, which is a skip rather than a failure in both callers.
    """
    weights = weights or os.environ.get("JEV_WEIGHTS")
    if not weights:
        result.notes.append(
            "token-for-token comparison skipped: no weights path given "
            "(pass weights=... or set JEV_WEIGHTS). The checks above passed."
        )
        return None

    try:
        from transformers import AutoTokenizer
    except ImportError:
        result.notes.append(
            "token-for-token comparison skipped: transformers is not installed in "
            "this environment. The checks above passed."
        )
        return None

    tok = AutoTokenizer.from_pretrained(str(weights))
    ids = tok(build_prompt(probe_text), add_special_tokens=False)["input_ids"]
    return tok, list(ids)


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
