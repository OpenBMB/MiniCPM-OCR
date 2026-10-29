import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { ImageParseMode } from '@/api/map/imageParseSdk';
import type { ImageParseSource } from '@/api/map/imageParseSource';

import type { Attachment } from '../types';
import type { ImageParseLayoutBlock } from '../utils/imageParseSample';
import type { ImageParseRotationInfo } from '../utils/imageParseSample';
import type { ImageParseSnapshot, PdfImageParseSnapshot } from '../utils/imageParseHistory';
import { isImageParseSharedExample } from '../utils/imageParseExamples';
import { imageParseKieFieldsError } from '../utils/imageParseKie';

interface ImageParseHistoryLifecycleOptions {
  scope: string;
  mode: ImageParseMode;
  attachment?: Attachment;
  loading: boolean;
  cancel: () => void;
  setImage: (attachment?: Attachment) => void;
  parse: () => Promise<void>;
  pendingAuto: MutableRefObject<boolean>;
}

/**
 * 在范围/模式变化时取消旧任务；缓存恢复可同步更新有效范围而不重新识别。
 * @param options 当前任务范围、状态与取消/识别入口
 * @returns 快照有效标识与恢复边界的更新函数
 */
export function useImageParseHistoryLifecycle({
  scope,
  mode,
  attachment,
  loading,
  cancel,
  setImage,
  parse,
  pendingAuto,
}: ImageParseHistoryLifecycleOptions) {
  const previousRef = useRef({ scope, mode });
  const [boundary, setBoundary] = useState({ scope, mode });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const old = previousRef.current;
    previousRef.current = { scope, mode };
    const changed = old.scope !== scope;
    if (!changed && old.mode === mode) return;
    cancel();
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      setImage(changed ? undefined : attachment);
      setBoundary({ scope, mode });
      if (!changed) setRevision((value) => value + 1);
    });
    return () => {
      disposed = true;
    };
  }, [attachment, cancel, mode, scope, setImage]);
  useEffect(() => {
    if (!pendingAuto.current || loading || !attachment) return;
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed && pendingAuto.current) void parse();
    });
    return () => {
      disposed = true;
    };
  }, [attachment, revision, loading, parse, pendingAuto]);
  useEffect(() => () => cancel(), [cancel]);
  const restoreBoundary = useCallback(
    (mode: ImageParseMode) => {
      previousRef.current = { scope, mode };
      setBoundary({ scope, mode });
    },
    [scope],
  );
  return { valid: boundary.scope === scope && boundary.mode === mode, restoreBoundary };
}

interface ImageParseHistorySnapshotOptions {
  attachment?: Attachment;
  mode: ImageParseMode;
  fields?: readonly string[];
  markdown: string;
  layout: readonly ImageParseLayoutBlock[];
  source?: ImageParseSource;
  rotation?: ImageParseRotationInfo;
  finished: boolean;
  loading: boolean;
  error?: string;
  valid: boolean;
  pdfActive: boolean;
  pdf: PdfImageParseSnapshot | null;
}

const EMPTY_LAYOUT: readonly ImageParseLayoutBlock[] = [];

/**
 * 上传后立即派生可保存快照；未完成时只保留原件，重新打开后继续识别。
 * @param options 识别结果及当前任务的有效状态
 * @returns 可保存的图片/PDF 快照；共享案例或范围失效时返回 null
 */
export function useImageParseHistorySnapshot({
  attachment,
  mode,
  fields,
  markdown,
  layout,
  source,
  rotation,
  finished,
  loading,
  error,
  valid,
  pdfActive,
  pdf,
}: ImageParseHistorySnapshotOptions): ImageParseSnapshot | null {
  return useMemo(() => {
    if (!attachment || !valid || isImageParseSharedExample(attachment.id)) return null;
    if (pdfActive && mode === 'seal') return null;
    // 后端要求 kie 快照携带合法字段；字段尚未填好时不要创建或覆盖历史。
    if (mode === 'kie' && imageParseKieFieldsError(fields ?? [])) return null;
    if (pdfActive) {
      if (!pdf) return null;
      const current = pdf.results[pdf.page]?.result;
      return {
        attachment,
        mode,
        markdown: current?.markdown ?? '',
        layout: current?.blocks ?? [],
        rotation: current?.rotation,
        ...(mode === 'kie' && fields?.length ? { fields: [...fields] } : {}),
        pdf,
      };
    }
    return finished && !loading && !error
      ? {
          attachment,
          mode,
          markdown,
          layout,
          ...(mode === 'kie' && fields?.length ? { fields: [...fields] } : {}),
          ...(source ? { source } : {}),
          ...(rotation ? { rotation } : {}),
        }
      : {
          attachment,
          mode,
          markdown: '',
          layout: EMPTY_LAYOUT,
          ...(mode === 'kie' && fields?.length ? { fields: [...fields] } : {}),
        };
  }, [
    attachment,
    mode,
    fields,
    markdown,
    layout,
    source,
    rotation,
    finished,
    loading,
    error,
    valid,
    pdfActive,
    pdf,
  ]);
}
