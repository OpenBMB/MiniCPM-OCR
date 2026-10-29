import {
  sanitizeImageParseRegions,
  sanitizeImageParseRotation,
  validateImageParseSdkResult,
  type ImageParseSdkResult,
} from '@/api/map/imageParseSdk';
import { sanitizeImageParseSource } from '@/api/map/imageParseSource';
import type { ImageParseLayoutBlock } from './imageParseSample';
import type { PdfImageParseSnapshot, ImageParseSnapshot } from './imageParseHistoryTypes';
import { MAX_PDF_PAGES } from './documentUpload';
import type { PdfPageResult } from './pdfImageParse';
import { reconcileImageParseMarkdown } from './imageParseMarkdownCompatibility';
import { deduplicateImageParseFormulaMarkdown } from './imageParseFormulaMarkdown';
import { isImageParseSharedExample } from './imageParseExamples';
import {
  sanitizeImageParseHistoryAttachment,
  type SanitizeImageParseSnapshotOptions,
} from './imageParseHistoryAttachment';
import { imageParseKieFieldsError, normalizeImageParseKieFields } from './imageParseKie';

const LOCAL_IMAGE = /^data:image\/(?!svg(?:\+xml)?;)[a-z0-9.+-]+;base64,[a-z\d+/=\s]+$/i;
const BLOCK_KINDS = new Set([
  'header',
  'footer',
  'heading',
  'text',
  'table',
  'formula',
  'list',
  'note',
  'image',
  'chart',
  'seal',
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type { SanitizeImageParseSnapshotOptions } from './imageParseHistoryAttachment';

function blocks(value: unknown): readonly ImageParseLayoutBlock[] | null {
  if (!Array.isArray(value)) return null;
  const output: ImageParseLayoutBlock[] = [];
  for (const block of value) {
    if (
      !record(block) ||
      typeof block.kind !== 'string' ||
      !BLOCK_KINDS.has(block.kind) ||
      ![block.x, block.y, block.w, block.h].every(
        (v) => typeof v === 'number' && Number.isFinite(v),
      ) ||
      typeof block.text !== 'string' ||
      typeof block.markdown !== 'string' ||
      (block.confidence !== null && typeof block.confidence !== 'number')
    )
      return null;
    const safe: ImageParseLayoutBlock = {
      kind: block.kind as ImageParseLayoutBlock['kind'],
      x: block.x as number,
      y: block.y as number,
      w: block.w as number,
      h: block.h as number,
      text: block.text,
      markdown: block.markdown,
      confidence: block.confidence as number | null,
    };
    const regions = block.regions === undefined ? null : sanitizeImageParseRegions(block.regions);
    if (regions) safe.regions = regions;
    if (block.ttsInvalid === true) safe.ttsInvalid = true;
    for (const key of ['id', 'label', 'status'] as const) {
      if (typeof block[key] === 'string') safe[key] = block[key];
    }
    for (const key of ['order', 'markdownStart', 'markdownEnd'] as const) {
      if (typeof block[key] === 'number' && Number.isInteger(block[key])) safe[key] = block[key];
    }
    output.push(safe);
  }
  return output;
}

function result(
  markdown: unknown,
  layout: unknown,
  source?: unknown,
  rotation?: unknown,
  allowEmptyMarkdown = false,
): ImageParseSdkResult | null {
  const safe = blocks(layout);
  if (typeof markdown !== 'string' || !safe) return null;
  try {
    let parsed = validateImageParseSdkResult({ markdown, blocks: safe }, { allowEmptyMarkdown });
    const deduplicated = deduplicateImageParseFormulaMarkdown(markdown, safe);
    if (
      deduplicated !== markdown ||
      safe.some(
        (block) =>
          !block.markdown &&
          (block.kind === 'heading' ||
            ['image', 'chart', 'seal'].includes(block.kind) ||
            (block.status === 'ok' && block.text.trim())),
      )
    ) {
      const reconciled = reconcileImageParseMarkdown(deduplicated, safe);
      // 恢复旧映射只接受正文不变的结果，不向已编辑的缓存补写识别原文。
      if (reconciled.markdown === deduplicated) {
        parsed = validateImageParseSdkResult(reconciled, { allowEmptyMarkdown });
      }
    }
    // OCR 范围签名允许随历史缓存；只保留白名单字段，不按本地时间丢弃过期原件。
    const safeSource = sanitizeImageParseSource(source);
    const safeRotation = sanitizeImageParseRotation(rotation);
    return {
      ...parsed,
      ...(safeSource ? { source: safeSource } : {}),
      ...(safeRotation ? { rotation: safeRotation } : {}),
    };
  } catch {
    return null;
  }
}

function pdfSnapshot(value: unknown): PdfImageParseSnapshot | null {
  if (
    !record(value) ||
    typeof value.pages !== 'number' ||
    !Number.isInteger(value.pages) ||
    value.pages < 0 ||
    value.pages > MAX_PDF_PAGES ||
    typeof value.page !== 'number' ||
    !Number.isInteger(value.page) ||
    value.page < 1 ||
    (value.pages > 0 && value.page > value.pages) ||
    !record(value.results)
  )
    return null;
  // 刚上传、页数还未知时先记下原件，打开后再继续解析。
  if (value.pages === 0) return { page: 1, pages: 0, results: {} };
  const results: Record<number, PdfPageResult> = {};
  for (const [index, page] of Object.entries(value.results)) {
    const number = Number(index);
    if (!Number.isInteger(number) || number < 1 || number > value.pages || !record(page)) continue;
    if (record(page.result)) {
      const safe = result(
        page.result.markdown,
        page.result.blocks,
        page.result.source,
        page.result.rotation,
      );
      if (!safe) continue;
      results[number] = { result: safe };
      if (Array.isArray(page.crops)) {
        results[number].crops = page.crops.map((crop) =>
          typeof crop === 'string' && LOCAL_IMAGE.test(crop) ? crop : '',
        );
      }
    } else if (
      typeof page.error === 'string' &&
      ['documentPdfPassword', 'imageParseRequestFailed', 'documentPdfFailed'].includes(page.error)
    ) {
      results[number] = { error: page.error };
    }
  }
  return { page: value.page, pages: value.pages, results };
}

/**
 * 校验快照并按字段白名单重建；远程原件仅允许恢复阶段的 fileId 签链及固定共享 PDF。
 * @param value hook 快照、IndexedDB 或云端接口读出的不可信数据
 * @param options local 保留原件 dataUrl；cloud 优先只保存稳定 fileId
 * @returns 可保存快照，损坏/示例数据返回 null
 */
export function sanitizeImageParseSnapshot(
  value: unknown,
  options: SanitizeImageParseSnapshotOptions = {},
): ImageParseSnapshot | null {
  if (!record(value)) return null;
  const original = sanitizeImageParseHistoryAttachment(value.attachment, options);
  if (
    !original ||
    !['standard', 'scored', 'high-precision', 'standard-pipeline', 'seal', 'kie'].includes(
      String(value.mode),
    )
  )
    return null;
  const mode = value.mode as ImageParseSnapshot['mode'];
  let fields: string[] | undefined;
  if (mode === 'kie') {
    if (!Array.isArray(value.fields) || !value.fields.every((field) => typeof field === 'string'))
      return null;
    fields = normalizeImageParseKieFields(value.fields);
    if (imageParseKieFieldsError(fields)) return null;
  } else if (value.fields !== undefined) {
    return null;
  }
  if (
    options.allowSharedImagePreview &&
    options.storage === undefined &&
    original.kind === 'image' &&
    isImageParseSharedExample(original.id) &&
    value.markdown === '' &&
    Array.isArray(value.layout) &&
    value.layout.length === 0
  ) {
    return {
      attachment: original,
      mode,
      markdown: '',
      layout: [],
      ...(fields ? { fields } : {}),
    };
  }
  if (original.kind === 'file') {
    if (mode === 'standard-pipeline' || mode === 'seal') return null;
    const pdf = pdfSnapshot(value.pdf);
    if (!pdf) return null;
    const current = pdf.results[pdf.page]?.result;
    return {
      attachment: original,
      mode,
      markdown: current?.markdown ?? '',
      layout: current?.blocks ?? [],
      ...(fields ? { fields } : {}),
      pdf,
    };
  }
  const parsed = result(value.markdown, value.layout, value.source, value.rotation, mode === 'seal');
  // 图片刚上传、识别还没结束时只保留原件，打开后继续识别。
  // 共享案例只在预览场景允许空结果；预览其他图片时不得把空正文当成识别结果。
  if (
    !parsed &&
    options.allowSharedImagePreview !== true &&
    !isImageParseSharedExample(original.id) &&
    value.markdown === '' &&
    Array.isArray(value.layout) &&
    value.layout.length === 0
  ) {
    return {
      attachment: original,
      mode,
      markdown: '',
      layout: [],
      ...(fields ? { fields } : {}),
    };
  }
  return parsed
    ? {
        attachment: original,
        mode,
        ...(fields ? { fields } : {}),
        markdown: parsed.markdown,
        layout: parsed.blocks,
        ...(parsed.source ? { source: parsed.source } : {}),
        ...(parsed.rotation ? { rotation: parsed.rotation } : {}),
      }
    : null;
}
