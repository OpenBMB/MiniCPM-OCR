import { useCallback } from 'react';

import {
  copyImageParseRegion,
  imageParseCopyRegionMarkdown,
} from '../utils/imageParseClipboard';
import type { ImageParseTextRange } from '../utils/imageParseBlocks';

interface ImageParseRegionCopyOptions {
  markdown: string;
  ranges: ReadonlyMap<string, ImageParseTextRange>;
  toast: (options: { title: string; variant?: 'error' }) => void;
  translate: (key: string) => string;
}

/**
 * 复制选中识别块；范围缺失或写入失败时给出稳定错误提示。
 * @param options 当前草稿、块范围与提示入口
 * @returns 接受块 ID 的复制回调
 */
export function useImageParseRegionCopy({
  markdown,
  ranges,
  toast,
  translate,
}: ImageParseRegionCopyOptions) {
  return useCallback(
    async (id: string) => {
      const range = ranges.get(id);
      if (!range) {
        toast({ title: translate('copyFailed'), variant: 'error' });
        return;
      }
      const ok = await copyImageParseRegion(imageParseCopyRegionMarkdown(markdown, range));
      toast(
        ok
          ? { title: translate('imageParseRegionCopied') }
          : { title: translate('copyFailed'), variant: 'error' },
      );
    },
    [markdown, ranges, toast, translate],
  );
}
