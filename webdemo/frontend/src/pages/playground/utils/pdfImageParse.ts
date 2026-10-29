/** A raw PDF submits only one MAP task; local rendering is only for preview and on-demand crops. */
import type { QueryClient } from '@tanstack/react-query';

import { runImageParseJob, type ImageParseJob } from '@/api/map/imageParseJobs';
import { adaptImageParseV2 } from '@/api/map/imageParseV2';
import {
  validateImageParseSdkResult,
  type ImageParseMode,
  type ImageParseSdkResult,
} from '@/api/map/imageParseSdk';

import type { Attachment } from '../types';
import { ensureImageParseFileReference } from './imageParseFileReference';
import { MAX_PDF_PAGES } from './documentUpload';
import { pdfParseErrorKey } from './pdfImageParseStatus';

export interface PdfPageResult {
  result?: ImageParseSdkResult;
  crops?: readonly string[];
  error?: string;
}

/** PDF execution context; queries reuse the portal QueryClient, and KIE fields are handed to the task client for validation as-is. */
export interface PdfImageParseJobOptions {
  queryClient?: QueryClient;
  fields?: readonly string[];
}

/**
 * Create one task for the whole document from the original PDF fileId; incremental results are filed by zero-based metadata.page_index.
 * @param source local PDF preview URL, used to re-upload only when the original lacks a fileId
 * @param mode recognition task; a historical tier maps to standard; seal does not support PDF
 * @param model OCR model currently available
 * @param projectId project required to re-upload the original
 * @param signal task lifecycle; cancellation is a DELETE by the task client
 * @param onOpen page count of the whole document; do not overwrite the original page count with the task page count from a single-page retry
 * @param onPage a one-based page result; crops are generated on demand by the existing hooks
 * @param onlyPage optional one-based original page to retry
 * @param _getPriorityPage compatible with the old call signature; page scheduling is owned by MAP
 * @param skipPages pages already finished locally; skip display only, and do not change the backend original task
 * @param upright rotation-adaptation switch
 * @param _recognizeSeal compatible with old callers; the backend always turns seal recognition on
 * @param attachment original PDF attachment; prefer an already uploaded fileId
 * @param options query client and optional KIE fields
 */
export async function parsePdfPages(
  source: string,
  mode: ImageParseMode,
  model: string,
  projectId: string,
  signal: AbortSignal,
  onOpen: (pages: number) => void,
  onPage: (index: number, page: PdfPageResult) => void,
  onlyPage?: number,
  _getPriorityPage?: () => number,
  skipPages?: ReadonlySet<number>,
  upright = true,
  _recognizeSeal = true,
  attachment?: Attachment,
  options?: PdfImageParseJobOptions,
): Promise<void> {
  signal.throwIfAborted();
  if (!model?.trim()) throw new Error('imageParseNoModel');
  if (mode === 'seal') throw new Error('imageParsePipelinePdfUnsupported');
  if (onlyPage !== undefined && (!Number.isSafeInteger(onlyPage) || onlyPage < 1))
    throw new Error('documentPdfFailed');
  const reference = await ensureImageParseFileReference({
    attachment: attachment ?? {
      id: 'pdf-original',
      kind: 'file',
      mime: 'application/pdf',
      name: 'document.pdf',
      size: 0,
      dataUrl: source,
    },
    projectId,
    signal,
  });
  signal.throwIfAborted();
  let total = 0;
  const published = new Set<number>();
  const publish = (job: ImageParseJob) => {
    signal.throwIfAborted();
    if (job.pages_total > MAX_PDF_PAGES) throw new Error('imageParsePdfTooManyPages');
    if (onlyPage === undefined && job.pages_total > 0 && total !== job.pages_total) {
      total = job.pages_total;
      onOpen(total);
    }
    for (const page of job.pages ?? []) {
      const index = page?.metadata?.page_index;
      if (
        index === undefined ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= MAX_PDF_PAGES ||
        (onlyPage !== undefined ? index !== onlyPage - 1 : index >= total)
      )
        throw new Error('imageParseInvalidResult');
      const number = index + 1;
      if (skipPages?.has(number) || published.has(number)) continue;
      signal.throwIfAborted();
      let value: PdfPageResult;
      try {
        const result = adaptImageParseV2(page);
        delete result.source;
        value = { result: validateImageParseSdkResult(result) };
      } catch (failure) {
        value = { error: pdfParseErrorKey(failure) };
      }
      published.add(number);
      onPage(number, value);
    }
  };
  try {
    const job = await runImageParseJob({
      task: mode === 'kie' ? 'kie' : 'standard',
      model,
      fileId: reference.fileId,
      upright,
      recognizeSeal: true,
      signal,
      onProgress: publish,
      ...(onlyPage !== undefined ? { pageIndex: onlyPage - 1 } : {}),
      ...(options?.queryClient ? { queryClient: options.queryClient } : {}),
      ...(mode === 'kie' ? { fields: options?.fields } : {}),
    });
    publish(job);
    if (
      job.status === 'Success' &&
      (onlyPage !== undefined
        ? [onlyPage]
        : Array.from({ length: total }, (_, index) => index + 1)
      ).some(
        (index) => !skipPages?.has(index) && !published.has(index),
      )
    ) {
      throw new Error('imageParseInvalidResult');
    }
  } catch (failure) {
    signal.throwIfAborted();
    const error = pdfParseErrorKey(failure);
    const remaining =
      onlyPage === undefined ? Array.from({ length: total }, (_, index) => index + 1) : [onlyPage];
    for (const index of remaining)
      if (!published.has(index) && !skipPages?.has(index)) onPage(index, { error });
    throw failure;
  }
}
