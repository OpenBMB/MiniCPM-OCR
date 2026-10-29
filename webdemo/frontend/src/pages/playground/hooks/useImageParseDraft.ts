/**
 * 识别结果草稿态。
 *
 * 用途：OCR 结果必然有错，光能看不能改就只是个演示。这里把结果变成可编辑草稿，
 * 复制与下载都取草稿而不是原始输出，用户改完就能直接带走。
 *
 * 跟随规则：新一轮解析（含流式推进）会覆盖草稿——那是新结果，不是用户的编辑；
 * 用户自己的改动用 dirty 标出来，并保留一键还原。
 *
 * 实现上不用 useEffect 同步 state：把编辑连同「它基于哪一版结果」一起存下来，
 * 结果一变，基线不匹配，草稿自然失效并回落到新结果——少一次级联渲染。
 */

import { useCallback, useState } from 'react';
import type { ImageParseTextRange } from '../utils/imageParseBlocks';
import { imageParseDraftRanges } from '../utils/imageParseDraftRanges';

const EMPTY_RANGES: ReadonlyMap<string, ImageParseTextRange> = new Map();

/** 草稿态。 */
export interface ImageParseDraft {
  /** 当前文本，复制/下载都用它 */
  value: string;
  /** 是否不同于基础识别，包含主动重生成，供还原操作使用。 */
  dirty: boolean;
  /** 是否存在人工修改；旧调用方未提供时按 dirty 兼容。 */
  manuallyEdited?: boolean;
  setValue: (next: string, editedRange?: ImageParseTextRange, source?: 'user' | 'model') => void;
  /** 与当前草稿同步的原图定位范围。 */
  ranges: ReadonlyMap<string, ImageParseTextRange>;
  /** 丢弃编辑，回到模型原始输出 */
  reset: () => void;
  /** 连续文档预览读取同一草稿缓存，不另建逐页编辑状态。 */
  forResult?: (
    markdown: string,
    resultKey: string,
    ranges: ReadonlyMap<string, ImageParseTextRange>,
  ) => ImageParseDraft;
}

/** 一次编辑：value 是改后的文本，base 是它当时基于的模型输出。 */
interface DraftEdit {
  resultKey: string;
  base: string;
  value: string;
  ranges: ReadonlyMap<string, ImageParseTextRange>;
  manuallyEdited: boolean;
}

/**
 * 把解析结果包装成可编辑草稿。
 * @param markdown 模型原始输出（流式期间会持续变化）
 * @param resultKey 文档与解析轮次标识，防止相同输出恢复上一轮的编辑
 */
export function useImageParseDraft(
  markdown: string,
  resultKey = '',
  baseRanges: ReadonlyMap<string, ImageParseTextRange> = EMPTY_RANGES,
): ImageParseDraft {
  const [edits, setEdits] = useState<Record<string, DraftEdit>>({});
  const forResult = useCallback(
    (
      base: string,
      key: string,
      ranges: ReadonlyMap<string, ImageParseTextRange>,
    ): ImageParseDraft => {
      const live = edits[key]?.base === base ? edits[key] : undefined;
      return {
        value: live?.value ?? base,
        ranges: live && live.value !== base ? live.ranges : ranges,
        dirty: Boolean(live && live.value !== base),
        manuallyEdited: Boolean(live?.manuallyEdited && live.value !== base),
        setValue: (next, editedRange, source = 'user') =>
          setEdits((previous) => {
            const current = previous[key]?.base === base ? previous[key] : undefined;
            return {
              ...previous,
              [key]: {
                base,
                value: next,
                resultKey: key,
                manuallyEdited: source === 'user' || Boolean(current?.manuallyEdited),
                ranges: imageParseDraftRanges(
                  current?.value ?? base,
                  next,
                  current?.ranges ?? ranges,
                  editedRange,
                ),
              },
            };
          }),
        reset: () =>
          setEdits((previous) => {
            const next = { ...previous };
            delete next[key];
            return next;
          }),
      };
    },
    [edits],
  );
  return { ...forResult(markdown, resultKey, baseRanges), forResult };
}
