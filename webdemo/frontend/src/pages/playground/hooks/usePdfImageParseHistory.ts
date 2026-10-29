import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import type { ImageParseMode } from '@/api/map/imageParseSdk';
import type { Attachment } from '../types';
import type { PdfImageParseSnapshot } from '../utils/imageParseHistoryTypes';
import { samePdfScope, type PdfParseScope } from '../utils/pdfImageParseScope';
import type { PdfPageResult } from '../utils/pdfImageParse';

export interface PdfImageParseRestoreOptions {
  resumeIncomplete?: boolean;
}

interface PdfImageParseHistoryOptions {
  scope: PdfParseScope;
  enabled: boolean;
  autoParse: boolean;
  revision: number;
  setRevision: Dispatch<SetStateAction<number>>;
  start: (page?: number, kept?: Record<number, PdfPageResult>) => Promise<void>;
  stop: () => void;
  abort: () => void;
  resetTableMerge: (restoreOriginals: boolean) => void;
  setResultScope: Dispatch<SetStateAction<PdfParseScope | undefined>>;
  setPage: (page: number) => void;
  setPages: Dispatch<SetStateAction<number>>;
  setResults: Dispatch<SetStateAction<Record<number, PdfPageResult>>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setFinished: Dispatch<SetStateAction<boolean>>;
}

/**
 * 管理 PDF 缓存恢复与启动意图；手动模式恢复历史时不自动续跑。
 * @param options 执行上下文、状态写入器和取消入口
 * @returns 历史恢复与显式执行入口
 */
export function usePdfImageParseHistory({
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
}: PdfImageParseHistoryOptions) {
  const restored = useRef<PdfParseScope | undefined>(undefined);
  const pendingResume = useRef<
    {
      scope: PdfParseScope;
      results: Record<number, PdfPageResult>;
      resumeIncomplete: boolean;
    } | undefined
  >(undefined);
  const manualRequest = useRef(false);
  const cancel = useCallback(() => {
    pendingResume.current = undefined;
    manualRequest.current = false;
    stop();
  }, [stop]);
  useEffect(() => {
    let disposed = false;
    if (!scope.source || !enabled || !scope.model.trim() || !scope.projectId.trim()) {
      restored.current = undefined;
    } else if (
      pendingResume.current &&
      samePdfScope(pendingResume.current.scope, scope) &&
      (autoParse || manualRequest.current || pendingResume.current.resumeIncomplete)
    ) {
      queueMicrotask(() => {
        if (disposed || !pendingResume.current) return;
        const kept = pendingResume.current.results;
        pendingResume.current = undefined;
        manualRequest.current = false;
        void start(undefined, kept);
      });
    } else if (!samePdfScope(restored.current, scope)) {
      restored.current = undefined;
      queueMicrotask(() => {
        if (
          !disposed &&
          !samePdfScope(restored.current, scope) &&
          (autoParse || manualRequest.current)
        ) {
          manualRequest.current = false;
          void start();
        }
      });
    }
    return () => {
      disposed = true;
      abort();
    };
  }, [abort, autoParse, enabled, scope, revision, start]);
  const restore = useCallback(
    (
      file: Attachment,
      mode: ImageParseMode,
      snapshot: PdfImageParseSnapshot,
      options: PdfImageParseRestoreOptions = {},
    ) => {
      cancel();
      const key = { ...scope, id: file.id, source: file.dataUrl, mode };
      restored.current = key;
      resetTableMerge(false);
      setResultScope(key);
      setPage(snapshot.page);
      setPages(snapshot.pages);
      setResults(snapshot.results);
      setError(undefined);
      const complete =
        snapshot.pages > 0 &&
        Array.from({ length: snapshot.pages }, (_, index) => index + 1).every(
          (page) => snapshot.results[page]?.result,
        );
      pendingResume.current = complete
        ? undefined
        : {
            scope: key,
            results: snapshot.results,
            resumeIncomplete: options.resumeIncomplete === true,
          };
      setFinished(complete);
    },
    [
      cancel,
      resetTableMerge,
      scope,
      setError,
      setFinished,
      setPage,
      setPages,
      setResultScope,
      setResults,
    ],
  );
  const parse = () => {
    const resume = pendingResume.current;
    cancel();
    manualRequest.current = true;
    restored.current = undefined;
    pendingResume.current = resume;
    setRevision((value) => value + 1);
  };
  return { restore, parse, stop: cancel };
}
