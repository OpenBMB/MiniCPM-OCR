import type { ImageParseRegenerateResult } from '@/api/map/imageParseSdk';

import type { ImageParseLayoutBlock } from './imageParseSample';
import { IMAGE_PARSE_REVIEW_THRESHOLD, imageParseBlockCanRegenerate } from './imageParseQuality';
import {
  imageParseBlockId,
  imageParseConfidence,
  type ImageParseTextRange,
} from './imageParseBlocks';

/** 每次主动优化的单块请求预算，不展示中间候选。 */
export const IMAGE_PARSE_MAX_RETRIES = 5;

/** 只展示稳定错误键，不将 SDK 或上游返回的消息直接暴露到页面。 */
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

/** 两版对比与可恢复的操作状态；original 始终是首次基础识别。 */
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

/** 全部可重算低分目标；未映射或人工改稿不纳入队列，展示分页不影响目标集合。 */
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

/** 每轮及写入前检查实时映射，目标块有人工修改时不继续请求或覆盖。 */
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

/** v4 按服务端轮次结束；旧 SDK 最多五次单轮，仅采纳评分严格更高的候选。 */
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
      // 后续网络故障不能丢弃此前已评分的候选，但界面仍需说明优化未完整执行。
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

/** 以公共前后文隔离差异区域，线性复杂度避免长表格造成二次方开销。 */
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
