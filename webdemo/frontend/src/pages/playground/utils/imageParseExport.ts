import type { ImageParseTextRange } from './imageParseBlocks';
import { imageParseBlockId } from './imageParseBlocks';
import type { ImageParseLayoutBlock } from './imageParseSample';
import type { ImageParseRotationInfo } from './imageParseSample';

/** OCR 当前结果支持的下载格式。 */
export type ImageParseDownloadFormat = 'markdown' | 'json' | 'word';

/** 下载快照不接收来源 token、API Key 或原始请求，避免凭据进入导出文件。 */
export interface ImageParseExportInput {
  markdown: string;
  blocks: readonly ImageParseLayoutBlock[];
  rotation?: ImageParseRotationInfo;
  ranges?: ReadonlyMap<string, ImageParseTextRange>;
  edited?: boolean;
}

const EXTENSIONS: Record<ImageParseDownloadFormat, string> = {
  markdown: 'md',
  json: 'json',
  word: 'docx',
};

/**
 * 根据原始文档命名当前结果；PDF 明确标记当前页，避免误以为导出全部页。
 * @param name 原始文件名
 * @param format 下载格式
 * @param page 可选 PDF 页码，从 1 开始
 * @returns 带正确扩展名的下载文件名
 */
export function imageParseExportFileName(
  name: string | undefined,
  format: ImageParseDownloadFormat,
  page?: number,
): string {
  const base = name?.replace(/\.[^.]+$/, '').trim() || 'image-parse';
  return `${base}${page ? `-page-${page}` : ''}.${EXTENSIONS[format]}`;
}

/**
 * 创建下载内容；Word 按需加载，JSON 只重建允许导出的版面字段。
 * @param format 用户选择的格式
 * @param input 当前可编辑正文与识别块快照
 * @returns 文件 Blob，不修改草稿或服务返回值
 */
export async function createImageParseExport(
  format: ImageParseDownloadFormat,
  input: ImageParseExportInput,
): Promise<Blob> {
  if (format === 'word') {
    const { createImageParseWordBlob } = await import('./imageParseWord');
    return createImageParseWordBlob(input.markdown);
  }
  if (format === 'markdown')
    return new Blob([input.markdown], { type: 'text/markdown;charset=utf-8' });

  const blocks = input.blocks.map((block, index) => {
    const range = input.ranges?.get(imageParseBlockId(block, index));
    return {
      id: block.id,
      order: block.order,
      label: block.label,
      status: block.status,
      kind: block.kind,
      x: block.x,
      y: block.y,
      w: block.w,
      h: block.h,
      regions: block.regions,
      ttsInvalid: block.ttsInvalid,
      // text 与 confidence 是原始识别证据；只有可定位的 Markdown 随人工编辑更新。
      text: block.text,
      markdown: range ? input.markdown.slice(range.start, range.end) : block.markdown,
      confidence: block.confidence,
      markdownStart: range?.start,
      markdownEnd: range?.end,
    };
  });
  const json = JSON.stringify(
    {
      markdown: input.markdown,
      blocks,
      rotation: input.rotation,
      edited: Boolean(input.edited),
    },
    null,
    2,
  );
  return new Blob([json], { type: 'application/json;charset=utf-8' });
}

/**
 * 启动本地下载并延迟释放对象 URL，给浏览器留出消费文件的时间。
 * @param blob 文件内容
 * @param fileName 下载文件名
 */
export function saveImageParseExport(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
