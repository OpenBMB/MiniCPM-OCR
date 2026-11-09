"""Transformers adapter: no engine at all -- the weights live in this process.

Every other adapter here is an HTTP client. An engine was started separately, it
holds the weights, and the adapter's whole job is to put a request on the wire.
This one has no wire. `from_pretrained` runs inside the service process, the
model sits in its memory, and `forward` is a function call.

That difference is worth stating plainly because it changes what can go wrong,
not just how fast it is:

  configuration   There is no `base_url` to point at. What this adapter needs is
      `model_path`, a local checkpoint directory, and `sdk/jev_score/backends/__init__.py`
      asks for one instead -- see the `LOCAL_ENGINES` branch there.

  concurrency     Two axes, and keeping them apart is the whole design here.

      `max_in_flight` is how many forward passes run *at once*. An HTTP engine
      queues past its own capacity, so there the name bounds this process's
      sockets. Here it would bound concurrent passes on one GPU, where exceeding
      it does not queue, it runs out of memory. So that gate stays at one: the
      forward runs on a worker thread (`asyncio.to_thread`, because it is
      synchronous and would otherwise block the event loop for its whole
      duration), and a config asking for more gets a note, not a silent OOM.

      `max_batch_size` is how many candidates go through *one* pass. That is a
      different question with a different answer, because the four HTTP engines
      get their batching from the engine's own continuous batching and this one
      has none. Measured on the shipped examples, a scoring prompt is 304-590
      tokens -- nowhere near enough to saturate the GEMMs -- so widening the
      batch buys real throughput rather than just latency. It defaults to 1, so
      the shipped configuration runs exactly the code path it always did.

      What a wider pass does to the numbers, measured rather than assumed. On
      CUDA the logits move by 2-5 bf16 ulps (one ulp near 2.9 is 0.015625) when
      the batch changes, which is 3.3e-4 or less once softmaxed -- an order of
      magnitude inside the 4.4e-3 the published scores were measured in, but
      not bit-identical. The cause is the reduction order in a wider GEMM, not
      padding: a batch of the *same* candidate repeated, every row equal length
      and zero pad tokens, moves further (7.8e-2) than any mixed-length batch
      here does. Left and right padding move the logits alike, so the 18
      recurrent layers (`layer_types` is 18 linear_attention + 6 full_attention)
      are not leaking pad steps into their state either way.

      Padding is still on the right. Not for a measured reason -- there isn't
      one -- but because right padding is the shape where "the value head reads
      the last real token" needs nothing to be true of the pad handling, and
      this gets no cheaper to reason about later. The per-row pooled-position
      assert below is what actually holds the line.

  blast radius    An engine that dies is a connection error this process can
      report. A model that dies takes the service with it.

  worker count    `uvicorn --workers N` loads the model N times, once per
      process. For the HTTP adapters N is N thin clients; here it is N times
      4.1 GiB. The start script pins it to 1.

What does *not* change is the contract: two raw class logits, in class order,
and `scorer.py` applies the same softmax it applies to vLLM's. The value head is
the same tensor either way.

Two things this adapter can check that no HTTP adapter can, because the
tokenizer is right here rather than behind an engine:

  * `tokenize()` answers for real, so `selfcheck.py` never has to report the
    prompt as unverifiable.
  * every scoring call asserts the pooled position itself. The classify path
    pools the last token, this model class pools the last non-pad token, and
    with one sequence and no padding those are the same token -- but that is a
    property worth asserting per request rather than assuming, because when it
    breaks it breaks silently. 271 is the final newline of the empty assistant
    turn; 198 is the near-miss.
"""
from __future__ import annotations

import base64
import binascii
import io
from pathlib import Path
from typing import Any

from ..prompt import PromptParts
from .base import BackendError

__all__ = ["TransformersBackend", "POOLED_TOKEN_ID"]

#: The token the value head reads. Same constant as `selfcheck.EXPECTED_LAST_TOKEN`,
#: restated here rather than imported: importing it would make this module depend
#: on the self-check, when the relationship is the other way round -- the gate
#: below has to hold on every request, including deployments that never run a
#: startup check.
POOLED_TOKEN_ID = 271


def _decode_data_url(data_url: str) -> bytes:
    """The bytes behind a `data:` URL, or of bare base64.

    `scorer.py` hands every adapter data URLs because the HTTP engines want them
    on the wire. This one has to undo that, which costs a base64 round trip and
    buys the one thing that matters: the padding decision in `images.py` --
    whether this crop is too long and thin for the preprocessor -- is made in
    exactly one place for all five backends.
    """
    marker = ";base64,"
    at = data_url.find(marker)
    payload = data_url[at + len(marker):] if at != -1 else data_url
    try:
        return base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise BackendError(f"image payload is not valid base64: {exc}") from exc


class TransformersBackend:
    """Runs the forward pass in this process, on weights it loaded itself."""

    #: We assemble the prompt and nothing downstream can touch it, exactly as on
    #: the SGLang path. `selfcheck.py` therefore checks our outgoing request
    #: against `build_prompt()` rather than interrogating an engine.
    prompt_source = "client"

    #: The value head's two raw logits. `scorer.py` applies the softmax.
    output_kind = "logits"

    def __init__(
        self,
        model_path: str,
        *,
        device: str = "auto",
        dtype: str = "auto",
        attn_implementation: str = "sdpa",
        max_in_flight: int = 1,
        max_batch_size: int = 1,
        model: str | None = None,
        timeout: float | None = None,
    ) -> None:
        import asyncio

        # Imported here, not at module scope, so that `load_backend` for any of
        # the four HTTP engines never pays for -- or requires -- the model stack.
        try:
            import torch
            from transformers import AutoProcessor, Qwen3_5ForSequenceClassification
        except ImportError as exc:
            raise BackendError(
                f"the transformers backend needs the model stack in *this* "
                f"interpreter, and {exc.name!r} is not importable from it.\n"
                "  Install sdk/requirements-transformers.txt and start the service\n"
                "  with that interpreter, e.g.\n"
                "    PATH=/opt/venv-transformers/bin:$PATH bash sdk/start_score.sh 18501\n"
                "  Unlike the four HTTP engines, this backend has no separate "
                "process to hold the weights."
            ) from exc

        self.model_path = str(model_path)
        self._name = model or self.model_path
        # `timeout` is accepted and ignored: there is no request to time out. It
        # is in the signature so that one backend config schema covers every
        # engine, rather than a local-only config that rejects a key the others
        # require.
        self._timeout = timeout

        self.device, self.dtype, self.attn_implementation = _resolve_runtime(
            device, dtype, attn_implementation
        )

        self.notes: list[str] = []
        if max_in_flight > 1:
            self.notes.append(
                f"max_in_flight={max_in_flight} was lowered to 1: this backend runs "
                "the forward pass in this process, where concurrent passes compete "
                "for one GPU's memory instead of queueing."
            )
        self._gate = asyncio.Semaphore(1)

        self.max_batch_size = max(1, int(max_batch_size))

        self.processor = AutoProcessor.from_pretrained(self.model_path)

        # Right padding, set rather than assumed -- it is the HF default, but a
        # checkpoint's tokenizer_config.json is free to override it. Right is the
        # side on which "pool the last real token" holds without depending on how
        # any layer treats pad positions; measured, this checkpoint is indifferent
        # (see `concurrency` in the module docstring), so this is the conservative
        # choice rather than a required one. Asserted after setting, so a future
        # tokenizer that ignores the attribute fails loudly instead of padding the
        # other way in silence.
        self._pad_token_id = self.processor.tokenizer.pad_token_id
        if self.max_batch_size > 1 and self._pad_token_id is None:
            raise BackendError(
                "max_batch_size > 1 needs a pad token to batch with, and this "
                "tokenizer defines none. The pooled-position rule that picks the "
                "value head's token is 'rightmost id != pad_token_id'; without a "
                "pad id there is nothing for it to exclude."
            )
        self.processor.tokenizer.padding_side = "right"
        if self.processor.tokenizer.padding_side != "right":
            raise BackendError(
                "the tokenizer would not accept padding_side='right'. This backend "
                "batches by right-padding only, so that the token the value head "
                "pools is the last real one on every row."
            )

        # The class is named, not resolved from the checkpoint's `architectures`.
        # That field says `Qwen3_5ForConditionalGeneration`, and the weights do
        # not contain an `lm_head` -- they contain `score.weight`, shape [2, 2048].
        # Loading the generative class therefore initialises a head at random,
        # drops the one that was trained, and warns about both rather than
        # failing. The result scores every candidate in range and means nothing.
        self.model, loading_info = Qwen3_5ForSequenceClassification.from_pretrained(
            self.model_path,
            dtype=self.dtype,
            attn_implementation=self.attn_implementation,
            output_loading_info=True,
        )
        # Deliberately `.to(device)` rather than `device_map=`: the latter pulls
        # in `accelerate` for a placement this adapter does not need, since it
        # never shards across devices.
        self.model = self.model.to(self.device)
        self.model.eval()

        missing = set(loading_info.get("missing_keys") or ())
        unexpected = set(loading_info.get("unexpected_keys") or ())
        if missing or unexpected:
            raise BackendError(
                "the checkpoint did not load cleanly into the sequence-classification "
                f"class.\n  missing: {sorted(missing)}\n  unexpected: {sorted(unexpected)}\n"
                "  A missing 'score.weight' means the value head was initialised at "
                "random and every score is noise; an unexpected one means it was "
                "loaded into a class that has no use for it."
            )
        if self.model.config.num_labels != 2:
            raise BackendError(
                f"expected a 2-class head, got num_labels={self.model.config.num_labels}"
            )

        # Two pad ids, and batching is only correct when they agree. The tokenizer's
        # is what gets *written* into the padded rows; the config's is what
        # `GenericForSequenceClassification` excludes when it picks the token to
        # pool. If they differ, the head pools a pad and every padded row scores
        # noise -- silently, since a pad position still produces two finite logits.
        # Harmless at batch size 1, which is why it is only fatal above it.
        config_pad = self.model.config.get_text_config().pad_token_id
        if self.max_batch_size > 1 and config_pad != self._pad_token_id:
            raise BackendError(
                f"the tokenizer pads with id {self._pad_token_id} but the model "
                f"config calls {config_pad} the pad token. Batching pads rows with "
                "the former and the value head skips the latter when choosing what "
                "to read, so padded rows would be pooled at a pad position."
            )

        self._torch = torch

    # ── identity ─────────────────────────────────────────────────────────────

    async def served_name(self) -> str | None:
        """The checkpoint directory, which is what identifies this model.

        A path rather than a name, like the SGLang adapter's `/get_model_info`:
        there is no server to have been started with a name, and the directory is
        the only thing that says which weights answered.
        """
        return self._name

    # ── request shape ────────────────────────────────────────────────────────

    def _scoring_request(
        self, parts: PromptParts, original_data_url: str, render_data_url: str
    ) -> dict[str, Any]:
        """What this adapter would put on the wire, if it had one.

        It has no wire, but `selfcheck.py` checks `client`-source adapters by
        reading this -- `text` against `build_prompt()`, `image_data` for two
        images in order -- and that check is just as meaningful here: the prompt
        and the image order are still ours to get wrong, and both fail silently.
        So the shape is kept identical to SGLang's rather than invented.
        """
        return {
            "text": parts.raw,
            "image_data": [original_data_url, render_data_url],
        }

    def describe_scoring_request(self, parts: PromptParts) -> dict[str, Any]:
        """`_scoring_request` with the image payloads elided, for the self-check."""
        return self._scoring_request(parts, "<original>", "<render>")

    # ── the two calls ────────────────────────────────────────────────────────

    def _pooled_positions(self, input_ids: Any) -> Any:
        """Which token the value head will read, per row.

        This is `GenericForSequenceClassification.forward`'s rule restated, not a
        rule of our own: the rightmost id that is not `pad_token_id`. It has to be
        the same rule, because the point of the assert below is to check the
        position the model is *actually* about to pool -- a second, independent
        notion of "last token" would check something else and pass while the head
        read a pad.
        """
        torch = self._torch
        non_pad = (input_ids != self._pad_token_id).to(torch.int32)
        indices = torch.arange(input_ids.shape[-1], dtype=torch.int32)
        return (indices * non_pad).argmax(-1)

    def _forward_sync(
        self, batch: list[tuple[PromptParts, str, str]]
    ) -> list[list[float]]:
        """One forward pass over `batch`. Synchronous, GPU-bound, not re-entrant.

        A batch of one is not a special case with its own code path, but it does
        skip `padding`: with nothing to pad to, asking for it would be a no-op
        that still changes which kwargs the processor sees. The default config
        therefore runs byte-for-byte what it ran before batching existed.
        """
        from PIL import Image

        torch = self._torch
        texts: list[str] = []
        images = []
        # Flat, in candidate order: this processor consumes the image list in the
        # order the placeholders appear across the whole batch, two per prompt.
        # Nesting per row is the shape another VL processor wants and is silently
        # wrong here -- it would pair row 0's prompt with both of row 0's images
        # only by accident of the flattening.
        for parts, original_data_url, render_data_url in batch:
            texts.append(parts.raw)
            for data_url in (original_data_url, render_data_url):
                with Image.open(io.BytesIO(_decode_data_url(data_url))) as img:
                    images.append(img.convert("RGB"))

        extra: dict[str, Any] = {}
        if len(batch) > 1:
            extra = {"padding": True, "padding_side": "right"}
        inputs = self.processor(
            text=texts, images=images, return_tensors="pt", **extra
        )

        input_ids = inputs["input_ids"]
        pooled_at = self._pooled_positions(input_ids)
        for row in range(input_ids.shape[0]):
            pooled = int(input_ids[row][int(pooled_at[row])])
            if pooled != POOLED_TOKEN_ID:
                hint = " (198 is the assistant turn cut short)" if pooled == 198 else ""
                where = f" (row {row} of {input_ids.shape[0]})" if len(batch) > 1 else ""
                raise BackendError(
                    f"the token this forward pass would pool is {pooled}, expected "
                    f"{POOLED_TOKEN_ID}{hint}{where}. The value head would read a "
                    "position it never read during training, and the score would be "
                    "off scale."
                )

        inputs = {
            key: (value.to(self.model.device) if hasattr(value, "to") else value)
            for key, value in inputs.items()
        }
        with torch.inference_mode():
            logits = self.model(**inputs).logits
        # float() before leaving the GPU dtype: bfloat16 has ~3 decimal digits,
        # and the softmax upstream is where the published score comes from.
        logits = logits.float()
        if logits.shape[0] != len(batch):
            raise BackendError(
                f"asked the value head for {len(batch)} rows, got {logits.shape[0]}."
            )
        if logits.shape[-1] != 2:
            raise BackendError(
                f"expected 2 class logits from the value head, got {logits.shape[-1]}."
            )
        return [[float(row[0]), float(row[1])] for row in logits]

    async def forward(
        self,
        parts: PromptParts,
        original_data_url: str,
        render_data_url: str,
    ) -> list[float]:
        return (await self.forward_batch([(parts, original_data_url, render_data_url)]))[0]

    async def forward_batch(
        self, batch: list[tuple[PromptParts, str, str]]
    ) -> list[list[float]]:
        """Score several candidates in one pass, in input order.

        The gate is still one: `max_batch_size` widens the pass, it does not add
        a second concurrent one. Callers are expected to have split to
        `max_batch_size` already -- this does not re-split, because a caller that
        hands over more than it configured should hear about it rather than have
        the limit quietly applied twice in different places.
        """
        import asyncio

        if not batch:
            return []
        if len(batch) > self.max_batch_size:
            raise BackendError(
                f"asked for a batch of {len(batch)} with max_batch_size="
                f"{self.max_batch_size}. Split before calling."
            )

        async with self._gate:
            try:
                return await asyncio.to_thread(self._forward_sync, batch)
            except BackendError:
                raise
            except Exception as exc:  # torch raises its own hierarchy
                raise BackendError(f"forward pass failed: {type(exc).__name__}: {exc}") from exc

    async def tokenize(self, parts: PromptParts) -> list[int] | None:
        """The prompt's token ids, from the tokenizer in this process.

        Answered rather than declined. The SGLang adapter returns None here on
        the grounds that asking an engine to tokenize a string we just handed it
        proves nothing -- true for an engine, but this is the same tokenizer the
        forward pass will use, loaded from the same directory, so its answer is
        the one that counts.
        """
        ids = self.processor.tokenizer(parts.raw, add_special_tokens=False)["input_ids"]
        return list(ids)

    async def aclose(self) -> None:
        """Drop the model and give the memory back.

        The HTTP adapters close sockets here. This one is holding several GiB of
        device memory, and a caller that builds a second Scorer in the same
        process -- a test, a notebook -- would otherwise be holding two copies.
        """
        model = getattr(self, "model", None)
        self.model = None
        del model
        try:
            if self._torch.cuda.is_available():
                self._torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001  -- releasing memory must not raise
            pass


def _resolve_runtime(device: str, dtype: str, attn_implementation: str) -> tuple[str, Any, str]:
    """Turn the three `auto`s in the config into what torch wants.

    `attn_implementation` defaults to sdpa and `auto` resolves to it, rather than
    to flash_attention_2 where that is installed. Measured against the reference
    scores on 12 samples: sdpa lands within 4.4e-3, flash_attention_2 within
    7.6e-3. Both rank identically and both look fine; only the first stays inside
    the 5e-3 band this checkpoint's published numbers were measured in.
    """
    import torch

    if device == "auto":
        # Apple's Metal backend is checked, not skipped. This checkpoint runs on
        # it: 18 of the 24 layers are linear attention, which is where an
        # unimplemented operator would have surfaced, and none did -- no
        # PYTORCH_ENABLE_MPS_FALLBACK required. Falling through to "cpu" on a
        # machine that has mps would cost a factor of ~100 for nothing.
        if torch.cuda.is_available():
            device = "cuda:0"
        elif getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
    if dtype == "auto":
        # bfloat16 on every accelerator, float32 only on CPU.
        #
        # The CPU exception is the usual one: bfloat16 is emulated there, and a
        # CPU deployment is not the one being compared against published scores
        # anyway. What is *not* an exception, and was wrong here until mps was
        # measured, is treating mps like the CPU. On an M-series GPU, one forward
        # pass of this model takes 0.3 s in bfloat16 and 38 s in float32 -- a
        # factor of ~100 -- and float32 also lands slightly further from the
        # reference scores (4.9e-3 against 4.1e-3), not closer. So the wider dtype
        # buys nothing on this device and costs two orders of magnitude.
        torch_dtype = torch.float32 if device.startswith("cpu") else torch.bfloat16
    else:
        torch_dtype = getattr(torch, dtype)
    if attn_implementation == "auto":
        attn_implementation = "sdpa"
    return device, torch_dtype, attn_implementation
