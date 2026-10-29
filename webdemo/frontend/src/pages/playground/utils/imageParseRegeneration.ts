import type { ImageParseRegenerateResult } from '@/api/map/imageParseSdk';

import type { ImageParseLayoutBlock } from './imageParseSample';
import { IMAGE_PARSE_REVIEW_THRESHOLD, imageParseBlockCanRegenerate } from './imageParseQuality';
import {
  imageParseBlockId,
  imageParseConfidence,
  type ImageParseTextRange,
} from './imageParseBlocks';

/** Per-block request budget for one active optimization; intermediate candidates are not shown. */
export const IMAGE_PARSE_MAX_RETRIES = 5;

/** Show only stable error keys, and do not expose SDK or upstream messages on the page directly. */
export function imageParseRegenerationErrorKey(failure: unknown): string {
  const known = [
    'imageParseRegenerateEdited',
    'imageParseRegenerateUnmapped',
    'imageParseRegenerateUnavailable',
    'imageParseInvalidResult',
    'imageParseRegenerateSourceMissing',
    'imageParseRegenerateSourceInvalid',
    'imageParseRegenerateUnsupported',
    'imageParseServiceAuthFailed',
    'imageParseServiceIPDenied',
    'imageParseServiceUnavailable',
    'imageParseInvalidRequest',
    'imageParseTimeout',
  ];
  if (failure instanceof DOMException && failure.name === 'TimeoutError')
    return 'imageParseTimeout';
  const message = failure instanceof Error ? failure.message : '';
  return known.includes(message) ? message : 'imageParseRegenerateFailed';
}

/** Comparison of the two versions and recoverable operation state; original is always the first base recognition. */
export interface ImageParseRegeneration {
  original: ImageParseLayoutBlock;
  best: ImageParseLayoutBlock;
  rounds: number;
  improved: boolean;
  error?: string;
  optimization?: Pick<
    ImageParseRegenerateResult,
    'priorScore' | 'roundsUsed' | 'stopReason' | 'exhausted' | 'requestId' | 'sourceRequestId'
  >;
}

interface RegenerationDraft {
  value: string;
  ranges: ReadonlyMap<string, ImageParseTextRange>;
}

/** Every low-score target that can be recomputed; unmapped blocks and manual edits are not queued, and display paging does not affect the target set. */
export function imageParseRegenerationIds(
  blocks: readonly ImageParseLayoutBlock[],
  draft: RegenerationDraft,
): string[] {
  return blocks.flatMap((block, index) => {
    const id = imageParseBlockId(block, index);
    const range = draft.ranges.get(id);
    return imageParseBlockCanRegenerate(block) &&
      imageParseConfidence(block.confidence) !== null &&
      block.confidence !== null &&
      block.confidence < IMAGE_PARSE_REVIEW_THRESHOLD &&
      range &&
      draft.value.slice(range.start, range.end) === block.markdown
      ? [id]
      : [];
  });
}

interface RegenerateMappedBlockInput {
  id: string;
  original: ImageParseLayoutBlock;
  currentBest: ImageParseLayoutBlock;
  signal: AbortSignal;
  generate: (attempt: number, best: ImageParseLayoutBlock) => Promise<ImageParseRegenerateResult>;
  getDraft: () => RegenerationDraft;
  onApply: (next: string, range: ImageParseTextRange) => void;
}

/** Check the live mapping each round and before writing; if the target block has a manual edit, do not keep requesting or overwrite it. */
export async function regenerateMappedImageParseBlock({
  id,
  original,
  currentBest,
  signal,
  generate,
  getDraft,
  onApply,
}: RegenerateMappedBlockInput): Promise<ImageParseRegeneration> {
  const assertMapping = () => {
    const draft = getDraft();
    const range = draft.ranges.get(id);
    if (!range) throw new Error('imageParseRegenerateUnmapped');
    if (draft.value.slice(range.start, range.end) !== currentBest.markdown)
      throw new Error('imageParseRegenerateEdited');
    return { draft, range };
  };
  assertMapping();
  const result = await optimizeImageParseBlock(
    original,
    (attempt, best) => {
      assertMapping();
      return generate(attempt, best);
    },
    signal,
    currentBest,
  );
  signal.throwIfAborted();
  const { draft, range } = assertMapping();
  if (result.improved)
    onApply(
      draft.value.slice(0, range.start) + result.best.markdown + draft.value.slice(range.end),
      range,
    );
  return result;
}

/** v4 ends on the server round; the old SDK does at most five single rounds, and only a candidate with a strictly higher score is accepted. */
export async function optimizeImageParseBlock(
  original: ImageParseLayoutBlock,
  generate: (attempt: number, best: ImageParseLayoutBlock) => Promise<ImageParseRegenerateResult>,
  signal: AbortSignal,
  currentBest = original,
): Promise<ImageParseRegeneration> {
  let best = currentBest;
  let rounds = 0;
  let optimization: ImageParseRegeneration['optimization'];
  for (let attempt = 1; attempt <= IMAGE_PARSE_MAX_RETRIES; attempt += 1) {
    signal.throwIfAborted();
    let candidate: ImageParseRegenerateResult;
    try {
      candidate = await generate(attempt, best);
    } catch (failure) {
      signal.throwIfAborted();
      if (!rounds) throw failure;
      // A later network failure must not discard candidates already scored, but the UI still has to say the optimization did not run to completion.
      return {
        original,
        best,
        rounds,
        improved: best !== currentBest,
        error: 'imageParseRegenerateFailed',
      };
    }
    signal.throwIfAborted();
    if (
      !candidate ||
      typeof candidate.markdown !== 'string' ||
      !candidate.markdown.trim() ||
      !Number.isFinite(candidate.confidence) ||
      candidate.confidence < 0 ||
      candidate.confidence > 1 ||
      (candidate.roundsUsed !== undefined &&
        (!Number.isSafeInteger(candidate.roundsUsed) ||
          candidate.roundsUsed < 0 ||
          candidate.roundsUsed > 5))
    ) {
      if (!rounds) throw new Error('imageParseInvalidResult');
      return {
        original,
        best,
        rounds,
        improved: best !== currentBest,
        error: 'imageParseInvalidResult',
      };
    }
    rounds = candidate.roundsUsed ?? attempt;
    if (candidate.confidence > (best.confidence ?? -1)) {
      best = {
        ...original,
        markdown: candidate.markdown,
        text: candidate.text ?? candidate.markdown,
        confidence: candidate.confidence,
      };
    }
    if (candidate.roundsUsed !== undefined) {
      const { priorScore, roundsUsed, stopReason, exhausted, requestId, sourceRequestId } =
        candidate;
      optimization = { priorScore, roundsUsed, stopReason, exhausted, requestId, sourceRequestId };
      break;
    }
    if ((best.confidence ?? 0) >= IMAGE_PARSE_REVIEW_THRESHOLD) break;
  }
  return {
    original,
    best,
    rounds,
    improved: best !== currentBest,
    ...(optimization ? { optimization } : {}),
  };
}

/** Isolate the differing region by the common prefix and suffix; linear complexity avoids quadratic cost on a long table. */
export function imageParseTextDifference(before: string, after: string) {
  const left = Array.from(before);
  const right = Array.from(after);
  let start = 0;
  while (start < Math.min(left.length, right.length) && left[start] === right[start]) start += 1;
  let tail = 0;
  while (
    tail < Math.min(left.length, right.length) - start &&
    left[left.length - 1 - tail] === right[right.length - 1 - tail]
  )
    tail += 1;
  return {
    prefix: left.slice(0, start).join(''),
    before: left.slice(start, left.length - tail).join(''),
    after: right.slice(start, right.length - tail).join(''),
    suffix: tail ? left.slice(-tail).join('') : '',
  };
}
