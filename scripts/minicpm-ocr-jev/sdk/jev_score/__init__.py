"""score: score one OCR candidate against the block it came from.

    from jev_score import Scorer, ScoreInput

    scorer = Scorer()                      # reads sdk/backends/vllm.yaml
    p = await scorer.score(ScoreInput.from_paths("block.png", "render.png", text))

Inputs are the original block image, that candidate rendered back to an image,
and the candidate text. The output is `prob_1`: the probability that the text is
consistent with the image. Higher is better.

This layer does not render and does not decide. `sdk/app.py` is the layer that
renders; the threshold belongs to whoever is using the number.
"""
from .backends import Backend, BackendError, load_backend
from .prompt import INSTRUCTION, PROMPT_TEMPLATE_MD5, PromptParts, build_parts
from .scorer import ScoreInput, Scorer, softmax_prob_1
from .selfcheck import EXPECTED_LAST_TOKEN, SelfCheckFailed, SelfCheckResult, run_selfcheck

__all__ = [
    "Backend",
    "BackendError",
    "EXPECTED_LAST_TOKEN",
    "INSTRUCTION",
    "PROMPT_TEMPLATE_MD5",
    "PromptParts",
    "ScoreInput",
    "Scorer",
    "SelfCheckFailed",
    "SelfCheckResult",
    "build_parts",
    "load_backend",
    "run_selfcheck",
    "softmax_prob_1",
]
