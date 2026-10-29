import { useEffect } from 'react';
import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';
import { rebuildPdfPageCrops } from '../utils/pdfImageParseCrops';
import { unservedImagePlaceholderOffsets } from '../utils/imageParseCrops';
import type { PdfPageResult } from '../utils/pdfImageParse';

/** 历史 PDF 只重建可见页的缺失裁图，换页或替换文档即取消旧渲染。 */
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
        // 无法裁切时保留已保存的正文；不重新识别或覆盖页结果。
      });
    return () => active.abort();
  }, [source, page, current, onReady]);
}
