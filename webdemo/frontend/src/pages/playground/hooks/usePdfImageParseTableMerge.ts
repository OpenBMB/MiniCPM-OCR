import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED } from '../utils/imageParseFeatureFlags';
import { mergeImageParseTables } from '../utils/imageParseTableMerge';
import type { PdfPageResult } from '../utils/pdfImageParse';

/** 跨页表格合并状态及受影响的页码。 */
export interface PdfTableMergeState {
  status: 'idle' | 'merging' | 'merged';
  pages: readonly number[];
}

const MERGE_IDLE: PdfTableMergeState = { status: 'idle', pages: [] };

interface PdfImageParseTableMergeOptions {
  results: Record<number, PdfPageResult>;
  setResults: Dispatch<SetStateAction<Record<number, PdfPageResult>>>;
  valid: boolean;
  finished: boolean;
  loading: boolean;
}

/**
 * 在逐页识别完成后拼接跨页表格，支持撤销且不覆盖用户的撤销选择。
 * @param options 当前页结果、写入入口与任务状态
 * @returns 合并操作、取消入口及重新识别时的重置入口
 */
export function usePdfImageParseTableMerge({
  results,
  setResults,
  valid,
  finished,
  loading,
}: PdfImageParseTableMergeOptions) {
  const [state, setState] = useState<PdfTableMergeState>(MERGE_IDLE);
  const controller = useRef<AbortController | null>(null);
  const originals = useRef<Record<number, PdfPageResult> | null>(null);
  const autoKey = useRef('');
  const suppressed = useRef(false);
  const abort = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);
  const reset = useCallback(
    (restoreOriginals: boolean) => {
      abort();
      const kept = originals.current;
      originals.current = null;
      if (restoreOriginals && kept) setResults((previous) => ({ ...previous, ...kept }));
      setState(MERGE_IDLE);
      autoKey.current = '';
      suppressed.current = false;
    },
    [abort, setResults],
  );
  const pages = useMemo(
    () =>
      Object.entries(results)
        .filter(([, value]) => value.result)
        .map(([key, value]) => ({
          page: Number(key),
          requestId: value.result!.requestId,
          result: value.result!,
        }))
        .sort((a, b) => a.page - b.page),
    [results],
  );
  const merge = useCallback(async (): Promise<number> => {
    if (pages.length < 2) return 0;
    abort();
    const active = new AbortController();
    controller.current = active;
    setState({ status: 'merging', pages: [] });
    try {
      const merged = mergeImageParseTables(pages);
      if (active.signal.aborted) return 0;
      const kept: Record<number, PdfPageResult> = {};
      for (const index of merged.keys()) {
        if (results[index + 1]) kept[index + 1] = results[index + 1]!;
      }
      const changed = Object.keys(kept).map(Number);
      setResults((previous) => {
        const next = { ...previous };
        for (const index of changed)
          next[index] = { ...previous[index], result: merged.get(index - 1)! };
        return next;
      });
      originals.current = changed.length ? kept : null;
      setState(changed.length ? { status: 'merged', pages: changed } : MERGE_IDLE);
      return [...merged.values()].reduce(
        (sum, result) => sum + result.blocks.filter((block) => block.mergedIntoPreviousPage).length,
        0,
      );
    } catch (failure) {
      if (active.signal.aborted) return 0;
      setState(MERGE_IDLE);
      throw failure;
    } finally {
      if (controller.current === active) controller.current = null;
    }
  }, [abort, pages, results, setResults]);
  const signature = pages.map((item) => `${item.page}:${item.requestId ?? ''}`).join('|');
  useEffect(() => {
    if (
      !IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED ||
      !valid ||
      !finished ||
      loading ||
      suppressed.current ||
      !signature ||
      autoKey.current === signature
    )
      return;
    autoKey.current = signature;
    void merge().catch(() => undefined);
  }, [finished, loading, merge, signature, valid]);
  const unmerge = useCallback(() => {
    reset(true);
    suppressed.current = true;
  }, [reset]);
  return {
    abort,
    reset,
    tableMerge: {
      ...(valid ? state : MERGE_IDLE),
      enabled: IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED,
      available:
        IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED && valid && finished && !loading && pages.length > 1,
      merge,
      unmerge,
    },
  };
}
