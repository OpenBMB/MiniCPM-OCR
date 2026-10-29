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
 * Copy the selected recognition block; when the range is missing or the write fails, show a stable error notice.
 * @param options current draft, block ranges, and the notice entry
 * @returns a copy callback that accepts a block ID
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
