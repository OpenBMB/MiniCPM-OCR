import { readPreviewAttachment } from './attachments';
import { IMAGE_PARSE_SHARED_EXAMPLES, type ImageParseExampleType } from './imageParseExamples';
import type { ImageParseSnapshot } from './imageParseHistoryTypes';

/** 图片组只在当前工作台保留，不扩展个人历史的持久化契约。 */
export interface ImageParseExampleSnapshot extends ImageParseSnapshot {
  imagePages?: readonly ImageParseSnapshot[];
}

async function warmPdfPreview(source: string, signal: AbortSignal) {
  const { loadPdfPreview } = await import('./pdfPreview');
  signal.throwIfAborted();
  const task = loadPdfPreview(source);
  const release = () => void task.destroy();
  signal.addEventListener('abort', release, { once: true });
  try {
    await task.promise;
  } finally {
    signal.removeEventListener('abort', release);
    release();
  }
}

async function previewFromUrl(
  example: { url: string; filename: string; format: 'PDF' | 'PNG'; sizeBytes?: number },
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (example.format === 'PDF') {
    if (!example.sizeBytes) throw new Error('imageParseExampleLoadFailed');
    return {
      id: example.url,
      kind: 'file' as const,
      name: example.filename,
      mime: 'application/pdf',
      size: example.sizeBytes,
      dataUrl: example.url,
    };
  }
  const response = await fetch(example.url, { signal });
  if (!response.ok) throw new Error('imageParseExampleLoadFailed');
  const blob = await response.blob();
  signal.throwIfAborted();
  const preview = await readPreviewAttachment(
    new File([blob], example.filename, { type: 'image/png' }),
    signal,
  );
  signal.throwIfAborted();
  if (!preview.ok || !preview.attachment) throw new Error('imageParseExampleLoadFailed');
  return preview.attachment;
}

/**
 * 只读取案例静态原件；案例暂不预识别，也不请求服务端案例结果。
 * @param type 共享案例类型
 * @param signal 切换案例、账号或项目时的取消信号
 * @returns 包含原件和空结果的预览快照
 */
export async function loadImageParseExampleSnapshot(
  type: ImageParseExampleType,
  signal: AbortSignal,
): Promise<ImageParseExampleSnapshot> {
  const example = IMAGE_PARSE_SHARED_EXAMPLES.find((item) => item.type === type);
  if (!example?.url) throw new Error('imageParseExampleLoadFailed');
  if (example.format === 'PDF') void warmPdfPreview(example.url, signal).catch(() => undefined);
  const attachment = await previewFromUrl(
    { ...example, format: example.format },
    signal,
  );
  signal.throwIfAborted();
  return {
    attachment: { ...attachment, id: example.id },
    mode: 'standard',
    markdown: '',
    layout: [],
    ...(example.format === 'PDF'
      ? {
          pdf: {
            page: 1,
            pages: example.pageCount ?? 1,
            results: {},
          },
        }
      : {}),
  };
}
