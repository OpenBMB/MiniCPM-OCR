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
 * Whether a block is a header, footer, or page number.
 * Old blocks with no label are judged by kind; a page number's kind is footer.
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
 * When the same formula already has a display-formula block, do not write another block's bare LaTeX into the preview.
 * Display-formula blocks themselves are all kept; two original-image formulas are not merged into one block.
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

/** Turn one recognition block into a preview fragment; empty text, failed blocks, and duplicate formulas return null. */
function piece(block: ImageParseLayoutBlock, displays: ReadonlySet<string>): string | null {
  const label = labelOf(block);
  const text = block.text ?? '';
  if (PLACEHOLDER_LABELS.has(label)) return IMAGE_PLACEHOLDER;
  // Seal text is not body content; when no text was recognized, keep the original-image placeholder so the result area is not blank.
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
 * Build preview body text from recognition blocks' order, and record each block's start and end in the body.
 * Do not read the server's aggregated Markdown; a block that was not written into the body is kept, with an empty range.
 * @param blocks recognition blocks that have finished validation
 * @param options when omitHeaderFooter is true, skip header, footer, and page number
 * @returns the recomposed body and the block map
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

/** Rewrite entry after a cross-page merge: the table has been written back into the block, and the body is generated from blocks once more. */
export function composeImageParsePreview(
  _markdown: string,
  blocks: readonly ImageParseLayoutBlock[],
): ImageParseSdkResult {
  return composeImageParseBlockMarkdown(blocks);
}
