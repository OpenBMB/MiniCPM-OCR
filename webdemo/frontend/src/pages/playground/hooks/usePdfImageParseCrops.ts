import { useEffect } from 'react';
import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';
import { rebuildPdfPageCrops } from '../utils/pdfImageParseCrops';
import { unservedImagePlaceholderOffsets } from '../utils/imageParseCrops';
import type { PdfPageResult } from '../utils/pdfImageParse';

/** A history PDF rebuilds only missing crops of the visible page, and changing the page or replacing the document cancels the old render. */
export function usePdfImageParseCrops(
  source: string,
  page: number,
  current: PdfPageResult | undefined,
  onReady: (page: number, result: ImageParseSdkResult, crops: readonly string[]) => void,
) {
  useEffect(() => {
    const result = current?.result;
    if (!source || !result || current?.crops || unservedImagePlaceholderOffsets(result.markdown).length === 0) return;
    const active = new AbortController();
    void rebuildPdfPageCrops(source, page, result, active.signal)
      .then((crops) => {
        if (!active.signal.aborted) onReady(page, result, crops);
      })
      .catch(() => {
        // When it cannot be cropped, keep the saved body; do not run recognition again or overwrite the page result.
      });
    return () => active.abort();
  }, [source, page, current, onReady]);
}
