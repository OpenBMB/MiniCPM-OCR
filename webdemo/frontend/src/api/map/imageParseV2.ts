import { getToken, mapRequest } from './request';
import { CHAT_API_BASE, ChatError, createPlaygroundClientRequestID } from './chat';
import type {
  ImageParseMode,
  ImageParseSdkResult,
  ImageParseRegenerateResult,
} from './imageParseSdk';
import {
  isImageParsePipelineMode,
  sanitizeImageParseRegions,
  sanitizeImageParseRotation,
} from './imageParseSdk';
import {
  sanitizeImageParseSource,
  imageParseSourceUnavailable,
  type ImageParseSource,
} from './imageParseSource';
import type {
  ImageParseBlockKind,
  ImageParseLayoutBlock,
} from '@/pages/playground/utils/imageParseSample';
import { composeImageParseBlockMarkdown } from '@/pages/playground/utils/imageParseBlockMarkdown';
import { reconcileImageParseMarkdown } from '@/pages/playground/utils/imageParseMarkdownCompatibility';

interface OcrBlock {
  order: number;
  label: string;
  bbox: [number, number, number, number];
  content?: string;
  status: string;
  score?: number;
  rounds_used?: number;
  stop_reason?: string;
  exhausted?: boolean;
  regions?: unknown;
  tts_invalid?: unknown;
  merged_into_previous_page?: unknown;
}

interface OcrPageData {
  request_id?: string;
  /**
   * The current algorithm declares only standard / ocr_only. stp / tts are kept so historical results can still be read,
   * and new requests no longer send these two retired tiers.
   */
  mode: 'ocr_only' | 'standard' | 'stp' | 'tts' | 'seal' | 'kie';
  image_width: number;
  image_height: number;
  blocks: OcrBlock[];
  passthrough?: { passed: number; total: number; rate: number };
  input_image?: { sha256?: string };
  rotation?: unknown;
}

interface OcrResponse {
  metadata?: { page_index?: number };
  choices: { message: { content: string } }[];
  ocr?: OcrPageData;
  /** Legacy upstream field; kept for historical examples and rolling upgrades. */
  minicpm_ocr?: OcrPageData;
  map_ocr_source?: {
    request_id: string;
    model: string;
    page_index: number;
    created_at: number;
    expires_at: number;
    token: string;
  };
}

/** Public ocr field wins; historical LIS responses remain readable via the alias. */
export function imageParseOCRData(response: OcrResponse | undefined): OcrPageData | undefined {
  return response?.ocr ?? response?.minicpm_ocr;
}

/**
 * Mapping from workbench tiers to the current upstream ocr.mode.
 * The algorithm capability API currently returns only standard; scored and high-precision remain only as historical mode names
 * and both actually use the unscored standard contract.
 */
const OCR_MODE: Record<'standard' | 'scored' | 'high-precision', 'ocr_only' | 'standard'> = {
  standard: 'ocr_only',
  scored: 'standard',
  'high-precision': 'standard',
};

function blockKind(label: string): ImageParseBlockKind {
  const normalized = label.toLowerCase();
  if (normalized === 'image' || normalized.endsWith('_image')) return 'image';
  if (normalized === 'chart') return 'chart';
  if (normalized === 'seal') return 'seal';
  if (normalized.includes('table')) return 'table';
  if (normalized.includes('formula') || normalized.includes('equation')) return 'formula';
  if (normalized.includes('title') || normalized.includes('heading')) return 'heading';
  if (normalized === 'header') return 'header';
  if (normalized === 'footer' || normalized === 'number') return 'footer';
  if (normalized.includes('list')) return 'list';
  if (normalized.includes('footnote') || normalized.includes('aside')) return 'note';
  return 'text';
}

/** Validate and normalize server pixel regions; the primary bbox is still kept separately as a compatibility coordinate. */
function normalizeRegions(
  value: unknown,
  width: number,
  height: number,
): ImageParseLayoutBlock['regions'] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('imageParseInvalidResult');
  return value.map((region) => {
    if (
      !Array.isArray(region) ||
      region.length !== 4 ||
      !region.every(Number.isFinite) ||
      region[0] < 0 ||
      region[1] < 0 ||
      region[2] <= region[0] ||
      region[3] <= region[1] ||
      region[2] > width ||
      region[3] > height
    )
      throw new Error('imageParseInvalidResult');
    const [x1, y1, x2, y2] = region as [number, number, number, number];
    return {
      x: x1 / width,
      y: y1 / height,
      w: (x2 - x1) / width,
      h: (y2 - y1) / height,
    };
  });
}

/** Map upstream snake_case rotation fields to workbench fields, then run the shared validation. */
function normalizeRotation(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  return sanitizeImageParseRotation({
    enabled: raw.enabled,
    applied: raw.applied,
    totalAngle: raw.total_angle,
    predictedAngle: raw.predicted_angle,
    predictedScore: raw.predicted_score,
    confirmed: raw.confirmed,
    orientationAngle: raw.orientation_angle,
    deskewAngle: raw.deskew_angle,
    skippedReason: raw.skipped_reason,
  });
}

/** Map the server pixel bbox, 0-based order, and optional score onto the workbench. */
export function adaptImageParseV2(response: OcrResponse): ImageParseSdkResult {
  const markdown = response?.choices?.[0]?.message?.content;
  const ocr = imageParseOCRData(response);
  if (
    typeof markdown !== 'string' ||
    !ocr ||
    !Array.isArray(ocr.blocks) ||
    !Number.isFinite(ocr.image_width) ||
    ocr.image_width <= 0 ||
    !Number.isFinite(ocr.image_height) ||
    ocr.image_height <= 0
  ) {
    throw new Error('imageParseInvalidResult');
  }
  const orders = new Set<number>();
  const blocks: ImageParseLayoutBlock[] = ocr.blocks.map((block) => {
    if (
      !block ||
      !Number.isSafeInteger(block.order) ||
      block.order < 0 ||
      orders.has(block.order) ||
      !Array.isArray(block.bbox) ||
      block.bbox.length !== 4 ||
      !block.bbox.every(Number.isFinite) ||
      (typeof block.content !== 'string' &&
        !(block.content === undefined && block.status !== 'ok')) ||
      typeof block.status !== 'string' ||
      typeof block.label !== 'string' ||
      (block.score !== undefined &&
        block.score !== -1 &&
        (!Number.isFinite(block.score) || block.score < 0 || block.score > 1)) ||
      // A newly merged table may carry the pre-merge score; the field itself must still be a boolean.
      (block.tts_invalid !== undefined && typeof block.tts_invalid !== 'boolean')
    ) {
      throw new Error('imageParseInvalidResult');
    }
    orders.add(block.order);
    const [x1, y1, x2, y2] = block.bbox;
    if (x1 < 0 || y1 < 0 || x2 <= x1 || y2 <= y1 || x2 > ocr.image_width || y2 > ocr.image_height) {
      throw new Error('imageParseInvalidResult');
    }
    const regions =
      block.regions === undefined
        ? undefined
        : normalizeRegions(block.regions, ocr.image_width, ocr.image_height);
    if (regions && !sanitizeImageParseRegions(regions)) throw new Error('imageParseInvalidResult');
    return {
      id: `ocr-${block.order}`,
      order: block.order,
      label: block.label,
      status: block.status,
      kind: blockKind(block.label),
      x: x1 / ocr.image_width,
      y: y1 / ocr.image_height,
      w: (x2 - x1) / ocr.image_width,
      h: (y2 - y1) / ocr.image_height,
      ...(regions ? { regions } : {}),
      text: block.content ?? '',
      markdown: '',
      // Upstream uses -1 when no confidence was given; the workbench normalizes that to null and does not invent a score.
      confidence: block.score === -1 ? null : (block.score ?? null),
      ...(block.tts_invalid === true ? { ttsInvalid: true } : {}),
      ...(block.merged_into_previous_page === true ? { mergedIntoPreviousPage: true } : {}),
    };
  });
  blocks.sort((a, b) => a.order! - b.order!);
  // The service body is the authoritative typeset result: keep heading, list, table, and formula syntax, and only fill in missing blocks.
  // Only when a pipeline response has no aggregated body is a preview built from blocks; an empty seal keeps its place with an original-image placeholder.
  let result: ImageParseSdkResult;
  if (!blocks.length) result = { markdown, blocks };
  else if (markdown.trim()) result = reconcileImageParseMarkdown(markdown, blocks);
  else result = composeImageParseBlockMarkdown(blocks);
  if (ocr.request_id && /^[a-f\d]{32}$/.test(ocr.request_id)) {
    result.requestId = ocr.request_id;
  }
  // Rotation info is for display only: hide it when fields are missing or invalid, without failing the whole-page recognition.
  const rotation = normalizeRotation(ocr.rotation);
  if (rotation) result.rotation = rotation;
  const reference = response.map_ocr_source;
  if (reference) {
    const source = sanitizeImageParseSource({
      requestId: reference.request_id,
      model: reference.model,
      pageIndex: reference.page_index,
      createdAt: reference.created_at,
      expiresAt: reference.expires_at,
      token: reference.token,
      inputImageSha256: ocr.input_image?.sha256,
    });
    // Source credentials are only for a later single-block recompute; drop them when invalid or mismatched, without affecting the recognized body or coordinates.
    if (
      source &&
      source.requestId === ocr.request_id &&
      ocr.mode !== 'ocr_only' &&
      (response.metadata?.page_index === undefined ||
        response.metadata.page_index === source.pageIndex)
    ) {
      result.source = source;
    }
  }
  return result;
}

/** Extract the platform error code from an L2 error body; return undefined when it is not JSON or not the expected shape. */
function extractImageParseErrorCode(raw: string): string | undefined {
  if (!raw) return undefined;
  try {
    const body = JSON.parse(raw) as { error?: { code?: string } };
    return body.error?.code;
  } catch {
    return undefined;
  }
}

/** Map an L2 status code to a stable workbench error key, without passing through the upstream text. */
function imageParseL2ErrorKey(status: number, errorCode?: string): string {
  // File-reference errors are returned by L2 as stable error keys and handed to the UI for localization.
  if (errorCode && /^imageParse[A-Z]/.test(errorCode)) return errorCode;
  if (
    status === 402 &&
    (errorCode === 'playground_trial_exhausted' || errorCode === 'playground_trial_not_eligible')
  ) {
    return 'imageParseTrialExhausted';
  }
  if (status === 401 || status === 403) return 'imageParseAuthFailed';
  if (status === 404) return 'imageParseModelUnavailable';
  if (status === 413) return 'imageParseUploadRequired';
  if (status >= 500) return 'imageParseServiceUnavailable';
  return 'imageParseRequestFailed';
}

/** Call L2 directly with an API Key; the plaintext secret stays in memory only, and the Portal identity is sent along so call records can be attributed. */
async function requestImageParseL2(
  body: unknown,
  secret: string,
  signal: AbortSignal,
): Promise<unknown> {
  if (!secret.trim()) throw new Error('imageParseAuthFailed');
  const portalToken = getToken();
  const configured = import.meta.env.VITE_OCR_API_BASE?.trim();
  const apiBase = configured ? configured.replace(/\/$/, '') : CHAT_API_BASE;
  const res = await fetch(`${apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(portalToken ? { 'X-Map-Portal-Token': `Bearer ${portalToken}` } : {}),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Map-Playground-Experience': 'image-parse',
      'X-Request-Id': createPlaygroundClientRequestID(),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new ChatError(
      res.status,
      imageParseL2ErrorKey(res.status, extractImageParseErrorCode(raw)),
    );
  }
  return res.json();
}

/** L2 single-image input is one of three: an OBS file_id, a platform-signed asset URL, or an inline data URI. */
export interface ImageParseV2Input {
  fileId?: string;
  fileUrl?: string;
  image?: string;
}

/** A single image calls OCR through the L2 API Key path so request_logs and usage_records are actually recorded. */
export async function parseImageV2(
  input: string | ImageParseV2Input,
  mode: ImageParseMode,
  signal: AbortSignal,
  pageIndex = 0,
  model: string,
  secret: string,
): Promise<ImageParseSdkResult> {
  if (isImageParsePipelineMode(mode)) throw new Error('imageParseInvalidRequest');
  const selectedModel = model?.trim() ?? '';
  if (!selectedModel) throw new Error('imageParseNoModel');
  const normalized = typeof input === 'string' ? { image: input } : input;
  const image = normalized.image?.trim() ?? '';
  const fileId = normalized.fileId?.trim() ?? '';
  const fileUrl = normalized.fileUrl?.trim() ?? '';
  const references = [image, fileId, fileUrl].filter(Boolean).length;
  if (references !== 1) throw new Error('imageParseInvalidRequest');
  const raw = (await requestImageParseL2(
    {
      model: selectedModel,
      messages:
        fileId || fileUrl
          ? []
          : [
              {
                role: 'user',
                content: [{ type: 'image_url', image_url: { url: image } }],
              },
            ],
      stream: false,
      ocr: { mode: OCR_MODE[mode] },
      page_index: pageIndex,
      ...(fileId ? { file_id: fileId } : {}),
      ...(fileUrl ? { file_url: fileUrl } : {}),
    },
    secret,
    signal,
  )) as OcrResponse;
  if (raw.metadata?.page_index !== undefined && raw.metadata.page_index !== pageIndex)
    throw new Error('imageParseInvalidResult');
  const result = adaptImageParseV2(raw);
  // Upstream may attach its own model source fields; when the model does not match, disable recompute but keep this recognition result.
  if (result.source && result.source.model !== selectedModel) delete result.source;
  return result;
}

/** One page in a cross-page table merge request: the request_id of this page’s recognition and the page index (0-based). */
export interface ImageParseMergePage {
  requestId: string;
  pageIndex: number;
}

/**
 * Whether LIS supports cross-page table merge through L3.
 * Return false when capability probing fails, and let the caller fall back to a local merge.
 */
export async function crossPageMergeAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const raw = await mapRequest<{ cross_page_merge?: boolean }>('/image-parse/capabilities', {
      signal,
    });
    return raw?.cross_page_merge === true;
  } catch {
    return false;
  }
}

/**
 * After every page of a PDF has been recognized, ask L3 to merge cross-page tables through LIS.
 * Return only pages that changed (page index to the merged full-page result). The response matches full-page recognition and uses the same validation.
 */
export async function mergeImageParseCrossPage(
  pages: readonly ImageParseMergePage[],
  model: string,
  signal: AbortSignal,
): Promise<Map<number, ImageParseSdkResult>> {
  const selectedModel = model?.trim() ?? '';
  if (!selectedModel || pages.length === 0 || pages.length > 500)
    throw new Error('imageParseInvalidResult');
  const pageIndexes = new Set<number>();
  const requestIds = new Set<string>();
  for (const page of pages) {
    if (
      !Number.isSafeInteger(page.pageIndex) ||
      page.pageIndex < 0 ||
      page.pageIndex >= 500 ||
      !/^[a-f\d]{32}$/.test(page.requestId) ||
      pageIndexes.has(page.pageIndex) ||
      requestIds.has(page.requestId)
    )
      throw new Error('imageParseInvalidResult');
    pageIndexes.add(page.pageIndex);
    requestIds.add(page.requestId);
  }
  const raw = await mapRequest<{ pages?: OcrResponse[] }>('/image-parse/merge', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: JSON.stringify({
      model: selectedModel,
      pages: pages.map((page) => ({ request_id: page.requestId, page_index: page.pageIndex })),
    }),
    signal,
  });
  const requested = new Set(pages.map((page) => page.pageIndex));
  const merged = new Map<number, ImageParseSdkResult>();
  const seen = new Set<number>();
  for (const page of raw?.pages ?? []) {
    const pageIndex = page?.metadata?.page_index;
    if (pageIndex === undefined || !requested.has(pageIndex) || seen.has(pageIndex))
      throw new Error('imageParseInvalidResult');
    seen.add(pageIndex);
    merged.set(pageIndex, adaptImageParseV2(page));
  }
  return merged;
}

interface OcrBlockData {
  request_id: string;
  source_request_id: string;
  mode: string;
  order: number;
  prior_score: number;
  block_count: number;
  blocks: OcrBlock[];
}

interface OcrBlockResponse {
  metadata?: { page_index?: number };
  choices: { message: { content: string } }[];
  ocr?: OcrBlockData;
  /** Legacy upstream field; kept for rolling upgrades. */
  minicpm_ocr?: OcrBlockData;
}

/** One L2 request finishes server-side block optimization; neither the original image nor a permanent service key enters the browser request. */
export async function regenerateImageParseV4(
  source: ImageParseSource,
  original: ImageParseLayoutBlock,
  signal: AbortSignal,
  model: string,
  secret: string,
): Promise<ImageParseRegenerateResult> {
  const unavailable = imageParseSourceUnavailable(source);
  if (unavailable) throw new Error(unavailable);
  if (
    original.status !== 'ok' ||
    original.confidence === null ||
    !Number.isSafeInteger(original.order) ||
    ['image', 'chart', 'seal'].includes(original.kind)
  )
    throw new Error('imageParseRegenerateUnsupported');
  const raw = (await requestImageParseL2(
    {
      model,
      messages: [],
      stream: false,
      ocr: {
        mode: 'tts_block',
        source_token: source.requestId,
        order: original.order,
      },
      map_ocr_source: source.token,
      page_index: source.pageIndex,
    },
    secret,
    signal,
  )) as OcrBlockResponse;
  const ocr = raw?.ocr ?? raw?.minicpm_ocr;
  const block = ocr?.blocks?.[0];
  const markdown = raw?.choices?.[0]?.message?.content;
  if (
    !ocr ||
    ocr.mode !== 'tts_block' ||
    !/^[a-f\d]{32}$/.test(ocr.request_id) ||
    ocr.source_request_id !== source.requestId ||
    ocr.order !== original.order ||
    ocr.block_count !== 1 ||
    !Array.isArray(ocr.blocks) ||
    ocr.blocks.length !== 1 ||
    !block ||
    block.order !== original.order ||
    block.status !== 'ok' ||
    typeof markdown !== 'string' ||
    !markdown.trim() ||
    typeof block.content !== 'string' ||
    !Number.isFinite(ocr.prior_score) ||
    ocr.prior_score < 0 ||
    ocr.prior_score > 1 ||
    block.score === undefined ||
    !Number.isFinite(block.score) ||
    block.score > 1 ||
    block.score < Math.max(ocr.prior_score, original.confidence) ||
    !Number.isSafeInteger(block.rounds_used) ||
    block.rounds_used! < 0 ||
    block.rounds_used! > 5 ||
    typeof block.stop_reason !== 'string' ||
    typeof block.exhausted !== 'boolean' ||
    (raw.metadata?.page_index !== undefined && raw.metadata.page_index !== source.pageIndex)
  )
    throw new Error('imageParseInvalidResult');
  return {
    markdown,
    text: block.content,
    confidence: block.score,
    roundsUsed: block.rounds_used,
    stopReason: block.stop_reason,
    exhausted: block.exhausted,
    requestId: ocr.request_id,
    sourceRequestId: ocr.source_request_id,
    priorScore: ocr.prior_score,
  };
}
