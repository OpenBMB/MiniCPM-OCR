import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';

import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';
import {
  hideImageParseHeaderFooter,
  stabilizeImageParseResult,
} from '../utils/imageParseHeaderFooter';
import type { PdfImageParseSnapshot } from '../utils/imageParseHistoryTypes';
import type { PdfPageResult } from '../utils/pdfImageParse';
import { usePdfImageParseCrops } from './usePdfImageParseCrops';

// 仅缓存纯派生结果；WeakMap 随原始结果释放，不额外持有文档。
const hiddenCache = new WeakMap<ImageParseSdkResult, ImageParseSdkResult>();

interface PdfImageParsePresentationOptions {
  source: string;
  page: number;
  pages: number;
  results: Record<number, PdfPageResult>;
  setResults: Dispatch<SetStateAction<Record<number, PdfPageResult>>>;
  valid: boolean;
  finished: boolean;
  hideHeaderFooter: boolean;
}

/**
 * 派生 PDF 可见结果与历史快照；裁图始终根据原始结果，避免过滤后身份变化。
 * @param options 页结果及当前可见页状态
 * @returns 过滤后的页结果和可恢复快照
 */
export function usePdfImageParsePresentation({
  source,
  page,
  pages,
  results,
  setResults,
  valid,
  finished,
  hideHeaderFooter,
}: PdfImageParsePresentationOptions) {
  const visibleResults = useMemo(() => {
    const out: Record<number, PdfPageResult> = {};
    for (const [key, value] of Object.entries(results)) {
      const index = Number(key);
      if (!value.result) {
        out[index] = value;
        continue;
      }
      const base = stabilizeImageParseResult(value.result);
      const cached = hideHeaderFooter ? hiddenCache.get(base) : undefined;
      const visible = hideHeaderFooter ? (cached ?? hideImageParseHeaderFooter(base)) : base;
      if (hideHeaderFooter) hiddenCache.set(base, visible);
      out[index] = visible === value.result ? value : { ...value, result: visible };
    }
    return out;
  }, [results, hideHeaderFooter]);
  const onCrops = useCallback(
    (index: number, result: ImageParseSdkResult, crops: readonly string[]) => {
      setResults((previous) =>
        previous[index]?.result === result
          ? { ...previous, [index]: { ...previous[index], crops } }
          : previous,
      );
    },
    [setResults],
  );
  usePdfImageParseCrops(valid ? source : '', page, valid ? results[page] : undefined, onCrops);
  const snapshot = useMemo<PdfImageParseSnapshot | null>(() => {
    if (!valid) return null;
    if (finished) return { page, pages, results };
    const partial: Record<number, PdfPageResult> = {};
    for (const [key, value] of Object.entries(results))
      partial[Number(key)] = value.result ? { result: value.result, error: value.error } : value;
    return { page, pages, results: partial };
  }, [valid, finished, page, pages, results]);
  return { visibleResults, current: valid ? visibleResults[page] : undefined, snapshot };
}
