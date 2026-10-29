import { readPreviewAttachment } from './attachments';
import { IMAGE_PARSE_SHARED_EXAMPLES, type ImageParseExampleType } from './imageParseExamples';
import type { ImageParseSnapshot } from './imageParseHistoryTypes';

/** An image group is kept only in the current workspace and does not extend the persistence contract of personal history. */
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
 * Read only the example's static original; examples are not pre-recognized and do not request a server example result.
 * @param type shared example type
 * @param signal cancellation signal when switching example, account, or project
 * @returns a preview snapshot containing the original and an empty result
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
