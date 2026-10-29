import { QueryObserver, type QueryClient } from '@tanstack/react-query';

import { createQueryClient } from '@/providers/QueryProvider';
import {
  imageParseKieFieldsError,
  normalizeImageParseKieFields,
} from '@/pages/playground/utils/imageParseKie';
import type { adaptImageParseV2 } from './imageParseV2';
import { mapRequest } from './request';

export type ImageParseJobTask = 'standard' | 'seal' | 'kie';
export type ImageParseJobStatus = 'Running' | 'Success' | 'Failed' | 'Cancelled';
export type ImageParseJobPage = Parameters<typeof adaptImageParseV2>[0];

/** Async OCR job owned by MAP; while running, pages is the prefix of pages already finished. */
export interface ImageParseJob {
  id: string;
  status: ImageParseJobStatus;
  pages_done: number;
  pages_total: number;
  pages?: ImageParseJobPage[];
  markdown?: string;
  error?: string | { message?: string; code?: string };
}

/** File-service reference to the original file; pageIndex is used only to retry one page of the original PDF. */
export interface ImageParseJobInput {
  task: ImageParseJobTask;
  model: string;
  fileId: string;
  upright?: boolean;
  recognizeSeal?: boolean;
  recognizeChart?: boolean;
  fields?: readonly string[];
  pageIndex?: number;
  signal: AbortSignal;
  queryClient?: QueryClient;
  onProgress?: (job: ImageParseJob) => void;
}

function stableError(error: unknown): Error {
  if (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  )
    return error;
  const message = error instanceof Error ? error.message : undefined;
  return new Error(
    message && /^imageParse[A-Z]/.test(message) ? message : 'imageParseRequestFailed',
  );
}

function parseJob(value: unknown, expectedId?: string): ImageParseJob {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('imageParseInvalidResult');
  const job = value as ImageParseJob;
  if (
    typeof job.id !== 'string' ||
    !job.id.trim() ||
    (expectedId !== undefined && job.id !== expectedId) ||
    !['Running', 'Success', 'Failed', 'Cancelled'].includes(job.status) ||
    !Number.isSafeInteger(job.pages_done) ||
    job.pages_done < 0 ||
    !Number.isSafeInteger(job.pages_total) ||
    job.pages_total < job.pages_done ||
    (job.pages !== undefined && !Array.isArray(job.pages))
  )
    throw new Error('imageParseInvalidResult');
  return job;
}

function jobResult(job: ImageParseJob): ImageParseJob {
  if (job.status === 'Cancelled') throw new Error('imageParseStopped');
  if (job.status === 'Failed') {
    const message = typeof job.error === 'string' ? job.error : job.error?.message;
    throw stableError(new Error(message));
  }
  return job;
}

function requestBody(input: ImageParseJobInput): string {
  const model = input.model.trim();
  const fileId = input.fileId.trim();
  if (!model) throw new Error('imageParseNoModel');
  if (!fileId) throw new Error('imageParseFileReferenceRequired');
  if (
    input.pageIndex !== undefined &&
    (!Number.isSafeInteger(input.pageIndex) || input.pageIndex < 0)
  )
    throw new Error('imageParseInvalidRequest');
  const fields =
    input.task === 'kie' ? normalizeImageParseKieFields(input.fields ?? []) : undefined;
  if (fields) {
    const error = imageParseKieFieldsError(fields);
    if (error) throw new Error(error);
  }
  return JSON.stringify({
    model,
    task: input.task,
    file_id: fileId,
    upright: input.upright !== false,
    recognize_seal: true,
    ...(input.task === 'standard' ? { recognize_chart: true } : {}),
    ...(fields ? { fields } : {}),
    ...(input.pageIndex !== undefined ? { page_index: input.pageIndex } : {}),
  });
}

async function observeJob(
  initial: ImageParseJob,
  input: ImageParseJobInput,
  onProgress: (job: ImageParseJob) => void,
): Promise<ImageParseJob> {
  const client = input.queryClient ?? createQueryClient();
  const queryKey = ['map', 'image-parse', 'jobs', initial.id] as const;
  const observer = new QueryObserver(client, {
    queryKey,
    initialData: initial,
    queryFn: async ({ signal }) =>
      parseJob(
        await mapRequest<unknown>(`/image-parse/jobs/${encodeURIComponent(initial.id)}`, {
          signal,
        }),
        initial.id,
      ),
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchIntervalInBackground: true,
    refetchInterval: (query) =>
      query.state.error || query.state.data?.status !== 'Running' ? false : 1000,
    retry: false,
    gcTime: 0,
  });
  let abort = () => {};
  try {
    return await new Promise<ImageParseJob>((resolve, reject) => {
      let last = initial;
      let settled = false;
      abort = () => {
        settled = true;
        reject(input.signal.reason);
      };
      input.signal.addEventListener('abort', abort, { once: true });
      if (input.signal.aborted) return abort();
      observer.subscribe((result) => {
        if (settled) return;
        if (result.isError) {
          settled = true;
          reject(result.error);
        } else if (result.data && result.data !== last) {
          last = result.data;
          try {
            onProgress(last);
            if (last.status !== 'Running') {
              settled = true;
              resolve(last);
            }
          } catch (error) {
            settled = true;
            reject(error);
          }
        }
      });
    });
  } finally {
    input.signal.removeEventListener('abort', abort);
    observer.destroy();
    client.removeQueries({ queryKey, exact: true });
  }
}

/**
 * Create a MAP OCR job and watch progress once a second with TanStack Query; stop and clear the query at a terminal state.
 * @param input Original-file fileId, execution options, QueryClient, and cancel/progress callbacks
 * @returns The successful job; failure uses a stable copy key, and cancel DELETEs the job that was created
 */
export async function runImageParseJob(input: ImageParseJobInput): Promise<ImageParseJob> {
  input.signal.throwIfAborted();
  const body = requestBody(input);
  let id: string | undefined;
  let job: ImageParseJob | undefined;
  const onProgress = (next: ImageParseJob) => {
    input.signal.throwIfAborted();
    job = next;
    input.onProgress?.(next);
    input.signal.throwIfAborted();
  };
  try {
    // Create must not bind the page abort: the job ID has to be obtained first so a job created during create can be cancelled reliably.
    const raw = await mapRequest<unknown>('/image-parse/jobs', {
      method: 'POST',
      body,
      headers: { Accept: 'application/json' },
    });
    if (
      raw &&
      typeof raw === 'object' &&
      'id' in raw &&
      typeof raw.id === 'string' &&
      raw.id.trim()
    )
      id = raw.id;
    input.signal.throwIfAborted();
    job = parseJob(raw);
    onProgress(job);
    if (job.status === 'Running') job = await observeJob(job, input, onProgress);
    return jobResult(job);
  } catch (error) {
    if (id && (input.signal.aborted || !job || job.status === 'Running')) {
      // Cleanup must use a separate request; a failed cancel must not overwrite the original error or start a new recognition.
      await mapRequest(`/image-parse/jobs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
    input.signal.throwIfAborted();
    throw stableError(error);
  }
}
