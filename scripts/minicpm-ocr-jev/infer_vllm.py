"""Score OCR candidates with the reward model, using vLLM for the forward pass.

The model is a vision-language reward model with a value head: a 2-class
sequence-classification head on top of a Qwen3.5-VL backbone. It answers one
question -- "does this OCR text match this document image?" -- and it answers it
by looking at two images at once:

    image 1: the original document block
    image 2: that block's candidate OCR text, rendered back into an image

Scoring one candidate therefore takes three steps, and this script runs all three:

    precheck  ->  render  ->  forward

`prob_yes` is softmax(logits)[1], the probability that the candidate is consistent
with the original. Higher is better. Candidates that fail precheck or rendering are
reported with prob_yes = 0.0, since a candidate whose LaTeX cannot even be parsed is
not a plausible transcription.

Input form: this checkpoint is ternary -- original image, text, and rendered image.
It always needs the rendered image; there is no text-only or single-image mode.

Reproducibility: scores are not bitwise reproducible. vLLM batches requests
continuously, so the same candidate can be computed alongside different neighbours
and differ in the last few decimal places. Compare rankings, not absolute values,
and do not hard-code thresholds derived from one run.

Usage:

    # score two candidates for one block
    python infer_vllm.py --model /path/to/weights \
        --image examples/01_text_putnam/block.png --category text \
        --candidate "first candidate" --candidate "second candidate"

    # score the bundled examples
    python infer_vllm.py --model /path/to/weights --examples

    # score a JSONL file: {"case_id", "image_path", "candidates": [...], "category"}
    python infer_vllm.py --model /path/to/weights --input-jsonl blocks.jsonl
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from PIL import Image

from rm_render import CATEGORIES, Candidate, RenderResult, render_candidates

HERE = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# Prompt
#
# These bytes are part of the model, not a configuration choice. The checkpoint was
# trained with exactly this text, in exactly this order: original image, the OCR
# text, the rendered image, then the instruction. Changing any of it -- including
# whitespace, or swapping the two images -- changes what the scores mean.
#
# Two details here look like padding and are not:
#
#  * Each image placeholder is followed by a newline. Dropping it is the single most
#    common way to get this wrong, because building the prompt through a chat
#    template's content list renders the placeholder without one.
#
#  * The prompt ends with an empty assistant turn, including the empty <think>
#    block. The model was trained as a sequence classifier, where the framework
#    appends that turn, and vLLM's classify path pools the LAST token. So the value
#    head reads the hidden state of the final newline in that assistant turn. Cut
#    the turn off and you are pooling a position the model never saw pooled during
#    training -- it still produces plausible-looking numbers, which is what makes
#    the mistake hard to notice.
#
# The fingerprint below is asserted at import time so an accidental edit fails loudly
# instead of silently shifting every score.
# ---------------------------------------------------------------------------

IMAGE_PLACEHOLDER = "<|vision_start|><|image_pad|><|vision_end|>"

INSTRUCTION = (
    "第一张图是原图，第二张图是上述 OCR 文本渲染得到的图片。\n"
    "请判断该 OCR 文本及其对应渲染图是否与原图内容一致。\n"
    "这是一个二分类任务：一致标为 1，不一致标为 0。"
)

#: The empty assistant turn the training framework appends for a sequence
#: classifier. It is what the value head actually reads; see the note above.
ASSISTANT_SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"

PROMPT_TEMPLATE_MD5 = "9aab68e8ba8ab4da17ba9752bddb199c"

#: Images per prompt. Ternary input means two: original, then render.
IMAGES_PER_PROMPT = 2

#: Qwen3.5-VL rejects extreme aspect ratios. Document block crops are often very
#: wide and only a few pixels tall, so anything past this ratio is padded with white
#: rather than resized -- padding preserves the glyph scale, resizing would not.
MAX_ASPECT_RATIO = 199.0


def build_prompt(text: str) -> str:
    """Assemble the raw prompt string for one candidate."""
    return (
        f"<|im_start|>user\n"
        f"{IMAGE_PLACEHOLDER}\n"
        f"OCR文本：\n{text}\n"
        f"{IMAGE_PLACEHOLDER}\n"
        f"{INSTRUCTION}"
        f"{ASSISTANT_SUFFIX}"
    )


def _assert_prompt_unchanged() -> None:
    fingerprint = hashlib.md5(build_prompt("{text}").encode("utf-8")).hexdigest()
    if fingerprint != PROMPT_TEMPLATE_MD5:
        raise RuntimeError(
            "The prompt template has been modified. Scores produced with a modified "
            f"template are not comparable to published ones.\n"
            f"  expected md5 {PROMPT_TEMPLATE_MD5}\n  got      md5 {fingerprint}\n"
            "If the change is deliberate, update PROMPT_TEMPLATE_MD5."
        )


_assert_prompt_unchanged()


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

def load_image(path: str | Path, max_ratio: float = MAX_ASPECT_RATIO) -> Image.Image:
    """Open an image, padding it with white if it is too long and thin."""
    img = Image.open(path).convert("RGB")
    width, height = img.size
    longest, shortest = max(width, height), max(1, min(width, height))
    if longest / shortest <= max_ratio:
        return img

    if width >= height:
        new_w, new_h = width, max(height, int(width / max_ratio + 0.999999))
    else:
        new_h, new_w = height, max(width, int(height / max_ratio + 0.999999))
    canvas = Image.new("RGB", (new_w, new_h), "white")
    canvas.paste(img, ((new_w - width) // 2, (new_h - height) // 2))
    return canvas


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------

@dataclass
class Scored:
    """One candidate's score, plus why it has the score it has."""

    case_id: str
    text: str
    prob_yes: float
    #: "scored", "precheck_reject", "render_error", "missing_original_image"
    verdict: str
    render_image_path: str | None = None
    katex_errors: list[str] | None = None
    detail: str | None = None

    @property
    def scored(self) -> bool:
        return self.verdict == "scored"


# ---------------------------------------------------------------------------
# Scorer
# ---------------------------------------------------------------------------

class RMScorer:
    """Wraps a vLLM engine configured for sequence classification.

    The engine is loaded once and reused. Loading takes a few minutes (weight load,
    graph capture, multi-modal warmup), so build one scorer and keep it.

    `vllm.LLM` is the offline API: pass it every prompt you have and it will batch
    them internally. For a long-running service, use vLLM's async engine instead;
    this class is for batch scoring and single-shot use.
    """

    def __init__(
        self,
        model: str | Path,
        *,
        dtype: str = "bfloat16",
        max_model_len: int = 16384,
        gpu_memory_utilization: float = 0.6,
        **llm_kwargs: Any,
    ) -> None:
        # Imported here so that `--help` and the renderer CLI work without vLLM.
        from vllm import LLM, PoolingParams

        self._pooling_params = PoolingParams(
            # Return raw logits. The activation is applied below, explicitly, so that
            # the two class logits can be softmaxed against each other.
            use_activation=False,
        )
        self.llm = LLM(
            model=str(model),
            runner="pooling",
            convert="classify",
            dtype=dtype,
            max_model_len=max_model_len,
            gpu_memory_utilization=gpu_memory_utilization,
            limit_mm_per_prompt={"image": IMAGES_PER_PROMPT},
            **llm_kwargs,
        )

    def forward(self, triples: Sequence[tuple[str, str, str]]) -> list[float]:
        """Score (original image path, render image path, text) triples.

        Returns prob_yes per triple, in input order.
        """
        if not triples:
            return []

        prompts = [
            {
                "prompt": build_prompt(text),
                "multi_modal_data": {
                    "image": [load_image(original), load_image(render)],
                },
            }
            for original, render, text in triples
        ]
        outputs = self.llm.classify(prompts, pooling_params=self._pooling_params)
        return [_prob_yes(o.outputs.probs) for o in outputs]

    def score(
        self,
        candidates: Sequence[Candidate],
        *,
        work_dir: str | Path | None = None,
        precheck: bool = True,
        browser_concurrency: int = 4,
        keep_renders: bool = False,
        render_python: str | None = None,
    ) -> list[Scored]:
        """Run the whole pipeline: precheck, render, forward.

        Results come back in input order. Candidates that never reached the model are
        included with prob_yes = 0.0 and a verdict saying what stopped them.

        The rendered images have to outlive rendering, because the forward pass reads
        them back off disk. So this method owns the directory they live in: a caller
        that passes `work_dir` keeps them, otherwise they go to a temporary directory
        that is removed once scoring is done.
        """
        import shutil
        import tempfile

        owned_tmp: str | None = None
        if work_dir is None:
            owned_tmp = tempfile.mkdtemp(prefix="rm_score_")
            work_dir = owned_tmp

        try:
            return self._score_in(
                candidates, Path(work_dir), precheck, browser_concurrency, render_python
            )
        finally:
            if owned_tmp is not None and not keep_renders:
                shutil.rmtree(owned_tmp, ignore_errors=True)

    def _score_in(
        self,
        candidates: Sequence[Candidate],
        work_dir: Path,
        precheck: bool,
        browser_concurrency: int,
        render_python: str | None,
    ) -> list[Scored]:
        renders = render_candidates(
            candidates,
            work_dir=work_dir,
            precheck=precheck,
            browser_concurrency=browser_concurrency,
            python_bin=render_python,
        )
        by_id = {r.case_id: r for r in renders}

        forwardable: list[tuple[int, Candidate, RenderResult]] = []
        for i, cand in enumerate(candidates):
            r = by_id[cand.case_id]
            if not (r.ok and r.render_image_path):
                continue
            if not Path(r.render_image_path).is_file():
                # The renderer reported success but the file is not there. Say so
                # here rather than letting it surface as a FileNotFoundError from
                # inside the image loader, where the cause is unrecognisable.
                r.ok = False
                r.reason = "render_error"
                r.detail = f"render reported ok but {r.render_image_path} is missing"
                continue
            forwardable.append((i, cand, r))

        probs = self.forward([
            (cand.image_path, r.render_image_path or "", cand.text)
            for _, cand, r in forwardable
        ])

        scores: dict[int, float] = {idx: p for (idx, _, _), p in zip(forwardable, probs)}

        out: list[Scored] = []
        for i, cand in enumerate(candidates):
            r = by_id[cand.case_id]
            if i in scores:
                out.append(Scored(
                    case_id=cand.case_id, text=cand.text, prob_yes=scores[i],
                    verdict="scored", render_image_path=r.render_image_path,
                    katex_errors=r.katex_errors or None,
                ))
            else:
                out.append(Scored(
                    case_id=cand.case_id, text=cand.text, prob_yes=0.0,
                    verdict=r.reason or "render_error",
                    katex_errors=r.katex_errors or None, detail=r.detail,
                ))
        return out


def _prob_yes(logits: Sequence[float]) -> float:
    """softmax over the two class logits, probability of class 1 (consistent)."""
    import math

    if len(logits) != 2:
        raise ValueError(
            f"expected 2 class logits from the value head, got {len(logits)}. "
            "This checkpoint may not be a 2-class sequence-classification model."
        )
    a, b = float(logits[0]), float(logits[1])
    top = max(a, b)
    exp_a, exp_b = math.exp(a - top), math.exp(b - top)
    return exp_b / (exp_a + exp_b)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _load_examples() -> list[dict[str, Any]]:
    blocks = []
    for case_dir in sorted((HERE / "examples").glob("*/case.json")):
        case = json.loads(case_dir.read_text(encoding="utf-8"))
        blocks.append({
            "case_id": case["case_id"],
            "image_path": str(case_dir.parent / case["block_image"]),
            "category": case["category"],
            "candidates": [c["text"] for c in case["candidates"]],
            "_roles": [c.get("role", "") for c in case["candidates"]],
            "_labels": [c.get("label", "") for c in case["candidates"]],
            "_expected": case.get("observed_prob_yes", {}),
            "_note": case.get("what_this_shows", ""),
        })
    return blocks


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    blocks = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                blocks.append(json.loads(line))
    return blocks


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(
        description="Score OCR candidates with the reward model.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--model", required=True, help="path to the checkpoint directory")

    source = ap.add_argument_group("what to score (pick one)")
    source.add_argument("--image", help="original document block image")
    source.add_argument("--candidate", dest="candidates", action="append", default=[],
                        metavar="TEXT", help="candidate text (repeat for several)")
    source.add_argument("--category", default="text", choices=list(CATEGORIES))
    source.add_argument("--examples", action="store_true",
                        help="score the bundled examples in examples/")
    source.add_argument("--input-jsonl", type=Path,
                        help='one block per line: {"case_id", "image_path", "candidates", "category"}')

    engine = ap.add_argument_group("engine")
    engine.add_argument("--max-model-len", type=int, default=16384)
    engine.add_argument("--gpu-memory-utilization", type=float, default=0.6)
    engine.add_argument("--dtype", default="bfloat16")

    pipeline = ap.add_argument_group("pipeline")
    pipeline.add_argument("--no-precheck", action="store_true",
                          help="skip the KaTeX screen (does not need Node)")
    pipeline.add_argument("--browser-concurrency", type=int, default=4)
    pipeline.add_argument("--render-python",
                          help="interpreter to run the render driver with, when Chromium "
                               "needs a wrapper that sets LD_LIBRARY_PATH")
    pipeline.add_argument("--save-renders", metavar="DIR",
                          help="keep the rendered images here for inspection")
    pipeline.add_argument("--json", action="store_true", help="print results as JSON")

    args = ap.parse_args()

    if args.examples:
        blocks = _load_examples()
    elif args.input_jsonl:
        blocks = _load_jsonl(args.input_jsonl)
    elif args.image and args.candidates:
        blocks = [{
            "case_id": "block",
            "image_path": args.image,
            "category": args.category,
            "candidates": list(args.candidates),
        }]
    else:
        ap.error("pass --examples, or --input-jsonl, or both --image and --candidate")

    # Flatten to candidates. Case ids must be unique across the whole batch, so the
    # block id is suffixed with the candidate index.
    cands: list[Candidate] = []
    for block in blocks:
        for i, text in enumerate(block["candidates"]):
            cands.append(Candidate(
                case_id=f"{block['case_id']}#{i}",
                image_path=block["image_path"],
                text=text,
                category=block.get("category", "text"),
            ))

    print(f"loading {args.model} …")
    scorer = RMScorer(
        args.model,
        dtype=args.dtype,
        max_model_len=args.max_model_len,
        gpu_memory_utilization=args.gpu_memory_utilization,
    )

    results = scorer.score(
        cands,
        work_dir=args.save_renders,
        precheck=not args.no_precheck,
        browser_concurrency=args.browser_concurrency,
        keep_renders=bool(args.save_renders),
        render_python=args.render_python,
    )
    by_id = {r.case_id: r for r in results}

    if args.json:
        print(json.dumps([r.__dict__ for r in results], ensure_ascii=False, indent=2))
        return

    for block in blocks:
        rows = [by_id[f"{block['case_id']}#{i}"] for i in range(len(block["candidates"]))]
        best = max(range(len(rows)), key=lambda i: rows[i].prob_yes) if rows else None

        print()
        print(f"=== {block['case_id']}  ({block.get('category', 'text')})")
        if block.get("_note"):
            print(f"    {block['_note']}")
        for i, r in enumerate(rows):
            marker = "*" if i == best else " "
            extra = ""
            if block.get("_roles"):
                role = block["_roles"][i]
                label = block["_labels"][i]
                extra = f"  [{role}" + (f", labelled {label}" if label else "") + "]"
                expected = (block.get("_expected") or {}).get(role)
                if expected is not None:
                    extra += f"  (reference run: {expected:.5f})"
            print(f"  {marker} prob_yes={r.prob_yes:.5f}  {r.verdict}{extra}")
            if r.katex_errors:
                print(f"      katex: {r.katex_errors}")
            if r.detail:
                print(f"      detail: {r.detail}")
            print(f"      text: {r.text[:100]!r}")
        if best is not None:
            print(f"  best candidate: index {best}")


if __name__ == "__main__":
    main()
