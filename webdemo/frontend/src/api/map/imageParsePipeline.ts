/**
 * Frontend adapter for the algorithm image-parsing pipeline.
 *
 * The browser calls only MAP L3 same-origin APIs. The pipeline address, unauthenticated upstream APIs, and task ownership
 * are all held by the backend. Seal recognition and key information extraction do not reuse the L2 API Key path.
 */

import { BizError } from '@map/types';
import type { QueryClient } from '@tanstack/react-query';
import { adaptImageParseV2 } from './imageParseV2';
import { runImageParseJob } from './imageParseJobs';
import { validateImageParseSdkResult, type ImageParseSdkResult } from './imageParseSdk';
import { mapRequest } from './request';
import {
  imageParseKieFieldsError,
  normalizeImageParseKieFields,
} from '@/pages/playground/utils/imageParseKie';

export interface ImageParsePipelineCapabilities {
  enabled: boolean;
  modes: readonly string[];
  seal: boolean;
  kie: boolean;
  upright: boolean;
}

const EMPTY_CAPABILITIES: ImageParsePipelineCapabilities = {
  enabled: false,
  modes: [],
  seal: false,
  kie: false,
  upright: true,
};

function parseCapabilities(value: unknown): ImageParsePipelineCapabilities {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_CAPABILITIES;
  const raw = value as Record<string, unknown>;
  const modes = Array.isArray(raw.modes)
    ? raw.modes.filter((mode): mode is string => typeof mode === 'string')
    : [];
  // Compatible with the enabled/modes contract in the algorithm docs. Older MAP returns only enabled,
  // which is not enough to open the pipeline entry; a modes declaration is required.
  const enabled =
    raw.pipeline === true ||
    (raw.pipeline === undefined &&
      raw.enabled === true &&
      Array.isArray(raw.modes) &&
      modes.includes('standard'));
  return {
    enabled,
    modes: enabled ? modes : [],
    seal: enabled && raw.seal === true,
    kie: enabled && raw.kie === true,
    upright: !enabled || raw.upright !== false,
  };
}

/**
 * Probe pipeline capabilities. The caller’s TanStack Query owns caching and retries; failures are thrown upward.
 * @param signal Page or query lifecycle signal
 * @returns Normalized capabilities; an invalid response shape safely degrades to unavailable
 */
export async function loadImageParsePipelineCapabilities(
  signal?: AbortSignal,
): Promise<ImageParsePipelineCapabilities> {
  const raw = await mapRequest<unknown>('/image-parse/capabilities', { signal });
  return parseCapabilities(raw);
}

function pipelineError(error: unknown): unknown {
  if (!(error instanceof BizError)) return error;
  if (/^imageParse[A-Z]/.test(error.message)) return new Error(error.message);
  return new Error('imageParseRequestFailed');
}

export type ImageParsePipelineTask = 'standard' | 'seal' | 'kie';

interface ImageParsePipelineBaseInput {
  mode: ImageParsePipelineTask;
  model: string;
  fields?: readonly string[];
  pageIndex?: number;
  upright?: boolean;
  recognizeSeal?: boolean;
  recognizeChart?: boolean;
  signal: AbortSignal;
  queryClient?: QueryClient;
}

/**
 * The workbench sends only a file-service fileId and runs it through a MAP async job.
 * fileUrl and inline image remain only for older callers; they are not a workbench fallback path.
 */
export type ImageParsePipelineInput = ImageParsePipelineBaseInput &
  (
    | { fileId: string; fileUrl?: never; image?: never }
    | { fileUrl: string; fileId?: never; image?: never }
    | { image: string; fileId?: never; fileUrl?: never }
  );

/** A single-image fileId goes through an async job; older URL and inline calls keep the sync contract. L3 validates both. */
export async function parseImagePipeline(
  input: ImageParsePipelineInput,
): Promise<ImageParseSdkResult> {
  const model = input.model.trim();
  if (!model) throw new Error('imageParseNoModel');
  const fileId = input.fileId?.trim() ?? '';
  const fileUrl = input.fileUrl?.trim() ?? '';
  const image = input.image?.trim() ?? '';
  if ([fileId, fileUrl, image].filter(Boolean).length !== 1) {
    throw new Error('imageParseFileReferenceRequired');
  }
  const fields =
    input.mode === 'kie' ? normalizeImageParseKieFields(input.fields ?? []) : undefined;
  if (input.mode === 'kie') {
    const error = imageParseKieFieldsError(fields ?? []);
    if (error) throw new Error(error);
  }
  let raw: unknown;
  try {
    if (fileId) {
      const job = await runImageParseJob({
        task: input.mode,
        model,
        fileId,
        upright: input.upright !== false,
        recognizeSeal: true,
        ...(input.mode === 'standard' ? { recognizeChart: true } : {}),
        signal: input.signal,
        ...(fields ? { fields } : {}),
        ...(input.pageIndex !== undefined ? { pageIndex: input.pageIndex } : {}),
        ...(input.queryClient ? { queryClient: input.queryClient } : {}),
      });
      if (job.pages?.length !== 1) throw new Error('imageParseInvalidResult');
      raw = job.pages[0];
    } else
      raw = await mapRequest<unknown>('/image-parse/pipeline', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: JSON.stringify({
          model,
          task: input.mode,
          ...(fileUrl ? { file_url: fileUrl } : { image }),
          ...(input.mode === 'standard'
            ? {
                page_index: input.pageIndex ?? 0,
                upright: input.upright !== false,
                recognize_seal: true,
                recognize_chart: true,
              }
            : {}),
          ...(fields ? { fields } : {}),
        }),
        signal: input.signal,
      });
  } catch (error) {
    throw pipelineError(error);
  }
  if (!raw || typeof raw !== 'object') throw new Error('imageParseInvalidResult');
  const response = raw as Parameters<typeof adaptImageParseV2>[0];
  if (
    input.mode === 'standard' &&
    response.metadata?.page_index !== undefined &&
    response.metadata.page_index !== (input.pageIndex ?? 0)
  )
    throw new Error('imageParseInvalidResult');
  const result = adaptImageParseV2(response);
  // The algorithm pipeline does not provide recompute credentials, so an old history source must not be re-enabled by a new response.
  delete result.source;
  return validateImageParseSdkResult(result, {
    allowEmptyMarkdown: input.mode === 'seal',
  });
}
