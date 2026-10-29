import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';

import { comparableImageParseFormula } from './imageParseFormulaMarkdown';
import type { ImageParseLayoutBlock } from './imageParseSample';

const IMAGE_PLACEHOLDER = '![image]()';
const PLACEHOLDER_LABELS = new Set(['image', 'header_image', 'footer_image']);
const TEXT_OR_PLACEHOLDER_LABELS = new Set(['chart']);
const HEADER_FOOTER_LABELS = new Set(['header', 'footer', 'number']);

function labelOf(block: ImageParseLayoutBlock): string {
  return (block.label ?? '').toLowerCase();
}

/**
 * 判断块是否为页眉、页脚或页码。
 * 没标 label 的旧块按 kind 判断，页码的 kind 是 footer。
 */
export function isImageParseHeaderFooterBlock(block: ImageParseLayoutBlock): boolean {
  const label = labelOf(block);
  if (label) return HEADER_FOOTER_LABELS.has(label);
  return block.kind === 'header' || block.kind === 'footer';
}

function recognized(block: ImageParseLayoutBlock): boolean {
  return block.status === undefined || block.status === 'ok';
}

/**
 * 同一公式已经有显示公式块时，不再把另一块裸 LaTeX 写进预览。
 * 显示公式块本身都保留，两块原图公式不会被合成一块。
 */
function bareFormulaDuplicate(
  block: ImageParseLayoutBlock,
  displays: ReadonlySet<string>,
): boolean {
  const label = labelOf(block);
  if (!displays.size || label === 'display_formula' || label === 'inline_formula') return false;
  const comparable = comparableImageParseFormula(block.text);
  return Boolean(comparable) && displays.has(comparable);
}

/** 将一个识别块转成预览片段；空文本、失败块和重复公式返回 null。 */
function piece(block: ImageParseLayoutBlock, displays: ReadonlySet<string>): string | null {
  const label = labelOf(block);
  const text = block.text ?? '';
  if (PLACEHOLDER_LABELS.has(label)) return IMAGE_PLACEHOLDER;
  // 印章文字不是正文内容；没有识别出文字时保留原图占位符，避免结果区出现空白。
  if (label === 'seal') return text.trim() ? text : IMAGE_PLACEHOLDER;
  if (TEXT_OR_PLACEHOLDER_LABELS.has(label)) return text.trim() ? text : IMAGE_PLACEHOLDER;
  if (!recognized(block) || !text.trim() || bareFormulaDuplicate(block, displays)) return null;
  if (label === 'doc_title') return `# ${text}`;
  if (label === 'paragraph_title') return `## ${text}`;
  if (label === 'figure_title') return `*${text}*`;
  if (label === 'display_formula') return `$$\n${text}\n$$`;
  if (label === 'inline_formula') return text.includes('$') ? text : `$${text}$`;
  return text;
}

/**
 * 按识别块的 order 生成预览正文，并记下每块在正文里的起止位置。
 * 不读取服务端聚合 Markdown；没写进正文的块保留下来，范围留空。
 * @param blocks 已完成校验的识别块
 * @param options omitHeaderFooter 为 true 时跳过页眉、页脚与页码
 * @returns 重新组合的正文与块映射
 */
export function composeImageParseBlockMarkdown(
  blocks: readonly ImageParseLayoutBlock[],
  options?: { omitHeaderFooter?: boolean },
): ImageParseSdkResult {
  const ordered = blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => (a.block.order ?? a.index) - (b.block.order ?? b.index) || a.index - b.index)
    .map(({ block }) => block);
  const displays = new Set<string>();
  for (const block of ordered) {
    if (labelOf(block) !== 'display_formula' || !recognized(block)) continue;
    const comparable = comparableImageParseFormula(block.text);
    if (comparable) displays.add(comparable);
  }
  let markdown = '';
  const next: ImageParseLayoutBlock[] = [];
  for (const block of ordered) {
    if (options?.omitHeaderFooter && isImageParseHeaderFooterBlock(block)) continue;
    const written = piece(block, displays);
    if (written == null) {
      next.push({ ...block, markdown: '', markdownStart: undefined, markdownEnd: undefined });
      continue;
    }
    if (markdown) markdown += '\n\n';
    const markdownStart = markdown.length;
    markdown += written;
    next.push({
      ...block,
      markdown: written,
      markdownStart,
      markdownEnd: markdown.length,
    });
  }
  return { markdown, blocks: next };
}

/** 跨页合并后的重写入口：表格已写回块里，正文只按块再生成一次。 */
export function composeImageParsePreview(
  _markdown: string,
  blocks: readonly ImageParseLayoutBlock[],
): ImageParseSdkResult {
  return composeImageParseBlockMarkdown(blocks);
}
