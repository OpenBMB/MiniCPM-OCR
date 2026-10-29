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
   * 当前算法只声明 standard / ocr_only。保留 stp / tts 以读取历史结果，
   * 新请求不再发送这两个已下线的档位。
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
 * 工作台档位到当前上游 ocr.mode 的映射。
 * 算法能力接口当前只返回 standard；scored 与 high-precision 仅作为历史模式名
 * 保留，实际都使用不带评分的 standard 契约。
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

/** 校验并归一化服务端像素区域；主 bbox 仍单独保留作为兼容坐标。 */
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

/** 将上游 snake_case 旋转字段映射为工作台字段后再做统一校验。 */
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

/** 将服务端像素 bbox、0 起始 order 与可选 score 映射到工作台。 */
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
      // 新版合并表格可能携带合并前分数；字段本身仍必须是布尔值。
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
      // 上游会用 -1 表示未给出置信度；工作台统一归一为 null，不伪造分数。
      confidence: block.score === -1 ? null : (block.score ?? null),
      ...(block.tts_invalid === true ? { ttsInvalid: true } : {}),
      ...(block.merged_into_previous_page === true ? { mergedIntoPreviousPage: true } : {}),
    };
  });
  blocks.sort((a, b) => a.order! - b.order!);
  // 服务正文是排版后的权威结果：保留标题、列表、表格和公式语法，只补回遗漏的块。
  // 个别流水线响应没有聚合正文时，才按块生成预览；空印章用原图占位符保留位置。
  let result: ImageParseSdkResult;
  if (!blocks.length) result = { markdown, blocks };
  else if (markdown.trim()) result = reconcileImageParseMarkdown(markdown, blocks);
  else result = composeImageParseBlockMarkdown(blocks);
  if (ocr.request_id && /^[a-f\d]{32}$/.test(ocr.request_id)) {
    result.requestId = ocr.request_id;
  }
  // 旋转信息只用于展示：字段缺失或不合法时不显示，不让整页识别失败。
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
    // 来源凭据只用于后续单块重算；无效或不匹配时丢弃即可，不影响已识别的正文与坐标。
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

/** 从 L2 错误体提取平台错误码；非 JSON 或非预期结构时返回 undefined。 */
function extractImageParseErrorCode(raw: string): string | undefined {
  if (!raw) return undefined;
  try {
    const body = JSON.parse(raw) as { error?: { code?: string } };
    return body.error?.code;
  } catch {
    return undefined;
  }
}

/** 将 L2 状态码映射为工作台稳定错误键，不透出上游原文。 */
function imageParseL2ErrorKey(status: number, errorCode?: string): string {
  // 文件引用错误由 L2 以稳定错误键返回，直接交给界面本地化。
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

/** 以 API Key 直连 L2；明文密钥仅内存传递，并同时携带 Portal 身份用于调用记录归属。 */
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

/** L2 单图输入三选一：OBS file_id、平台签名资产链接或内联 data URI。 */
export interface ImageParseV2Input {
  fileId?: string;
  fileUrl?: string;
  image?: string;
}

/** 单张图通过 L2 API Key 链路调用 OCR，保证 request_logs 与 usage_records 真实落账。 */
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
  // 上游可能附带自身模型的来源字段；模型不匹配时禁用重算，但保留本次识别结果。
  if (result.source && result.source.model !== selectedModel) delete result.source;
  return result;
}

/** 跨页表格合并请求里的一页：本页识别的 request_id 与页码（0 起始）。 */
export interface ImageParseMergePage {
  requestId: string;
  pageIndex: number;
}

/**
 * LIS 是否支持经 L3 合并跨页表格。
 * 能力探测失败时返回 false，由调用方回退到本地合并。
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
 * 一份 PDF 的各页都识别完后，请求 L3 通过 LIS 做跨页表格合并。
 * 只返回有变化的页（页码 → 合并后的整页结果），响应与整页识别同构，走同一套校验。
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

/** 一次 L2 请求完成服务端块优化；原图与永久服务 Key 均不进入浏览器请求。 */
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
