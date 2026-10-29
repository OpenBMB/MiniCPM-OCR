import {
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import type { Attachment } from '../types';
import type { ImageParseMode } from '@/api/map/imageParseSdk';
import { isPdfAttachment } from '../utils/documentUpload';
import { parsePdfPages, type PdfPageResult } from '../utils/pdfImageParse';
import {
  completedPdfPageIndexes,
  countCompletedPdfPages,
  pdfParseErrorKey,
} from '../utils/pdfImageParseStatus';
import { samePdfScope, type PdfParseScope } from '../utils/pdfImageParseScope';
import { usePdfImageParseTableMerge } from './usePdfImageParseTableMerge';
import { usePdfImageParsePresentation } from './usePdfImageParsePresentation';
import { usePdfImageParseHistory } from './usePdfImageParseHistory';

export type { PdfTableMergeState } from './usePdfImageParseTableMerge';
const EMPTY_FIELDS: readonly string[] = [];

/** 为 PDF 维护页码和 MAP 任务生命周期；替换文件/模式/模型时中止旧任务。 */
export function usePdfImageParse(
  attachment: Attachment | undefined,
  mode: ImageParseMode,
  model: string,
  projectId: string,
  enabled = Boolean(model && projectId),
  onTrialSettled?: () => void,
  hideHeaderFooter = false,
  upright = true,
  autoParse = true,
  _recognizeSeal = true,
  fields: readonly string[] = EMPTY_FIELDS,
) {
  const queryClient = useContext(QueryClientContext);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [results, setResults] = useState<Record<number, PdfPageResult>>({});
  const [resultScope, setResultScope] = useState<PdfParseScope>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [pageRevisions, setPageRevisions] = useState<Record<number, number>>({});
  const [finished, setFinished] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const pdf = attachment && isPdfAttachment(attachment) ? attachment : undefined;
  const execution = useRef({ pdf, fields });
  useEffect(() => {
    execution.current = { pdf, fields };
  }, [pdf, fields]);
  const source = pdf?.dataUrl || '';
  const scope = useMemo(
    () => ({ id: pdf?.id, source, mode, model, projectId, upright }),
    [pdf?.id, source, mode, model, projectId, upright],
  );
  const valid = Boolean(source && samePdfScope(resultScope, scope));
  const {
    tableMerge,
    abort: abortMerge,
    reset: resetTableMerge,
  } = usePdfImageParseTableMerge({
    results,
    setResults,
    valid,
    finished,
    loading,
  });
  const abort = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    abortMerge();
  }, [abortMerge]);
  const stop = useCallback(() => {
    abort();
    setLoading(false);
    setFinished(false);
  }, [abort]);
  const start = useCallback(
    async (onlyPage?: number, kept?: Record<number, PdfPageResult>) => {
      const { source, mode, model, projectId, upright } = scope;
      if (!source || !enabled || !model.trim() || !projectId.trim()) return;
      stop();
      // 重识别会让合并结果过期：整份重来时直接丢弃，单页重试先还原成逐页结果
      resetTableMerge(onlyPage !== undefined);
      setResultScope(scope);
      const active = new AbortController();
      controller.current = active;
      setError(undefined);
      setLoading(true);
      if (onlyPage === undefined) {
        if (kept) setResults((previous) => ({ ...kept, ...previous }));
        else {
          setPageRevisions({});
          setResults({});
          setPages(0);
          setPage(1);
        }
      } else {
        setPageRevisions((previous) => ({
          ...previous,
          [onlyPage]: (previous[onlyPage] ?? 0) + 1,
        }));
        setResults((previous) => {
          const next = { ...previous };
          delete next[onlyPage];
          return next;
        });
      }
      const jobOptions =
        mode === 'kie' ? { queryClient, fields: execution.current.fields } : { queryClient };
      try {
        await parsePdfPages(
          source,
          mode,
          model,
          projectId,
          active.signal,
          (count) => {
            if (!active.signal.aborted) startTransition(() => setPages(count));
          },
          (index, result) => {
            if (!active.signal.aborted)
              setResults((previous) => ({ ...previous, [index]: result }));
          },
          onlyPage,
          () => 1,
          kept ? completedPdfPageIndexes(kept) : undefined,
          upright,
          true,
          execution.current.pdf,
          queryClient || mode === 'kie' ? jobOptions : undefined,
        );
        if (!active.signal.aborted) setFinished(true);
      } catch (failure) {
        if (!active.signal.aborted) setError(pdfParseErrorKey(failure));
      } finally {
        if (controller.current === active) {
          controller.current = null;
          setLoading(false);
        }
      }
    },
    [enabled, scope, stop, setPage, resetTableMerge, queryClient],
  );
  const history = usePdfImageParseHistory({
    scope,
    enabled,
    autoParse,
    revision,
    setRevision,
    start,
    stop,
    abort,
    resetTableMerge,
    setResultScope,
    setPage,
    setPages,
    setResults,
    setError,
    setFinished,
  });
  const { visibleResults, current, snapshot } = usePdfImageParsePresentation({
    source,
    page,
    pages,
    results,
    setResults,
    valid,
    finished,
    hideHeaderFooter,
  });
  const pageIdentity = (index: number) =>
    `${revision}:${pageRevisions[index] ?? 0}${tableMerge.pages.includes(index) ? ':merged' : ''}`;
  return {
    page: valid ? page : 1,
    pages: valid ? pages : 0,
    setPage,
    results: valid ? visibleResults : {},
    current,
    completed: valid ? countCompletedPdfPages(results) : 0,
    loading: valid && loading,
    error: valid ? error : undefined,
    snapshot,
    // 导航不增加识别代次；重试和合并只更新受影响页的草稿身份。
    resultIdentity: pageIdentity(page),
    resultIdentityForPage: pageIdentity,
    tableMerge,
    restore: history.restore,
    stop: history.stop,
    parse: history.parse,
    retryPage: (index: number) => void start(index),
  };
}
