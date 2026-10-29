import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';

import { imageParseMarkdownCropBlocks, isImageParseDisplayTextBlock } from './imageParseCrops';
import type { ImageParseLayoutBlock } from './imageParseSample';
import { imageParseNodeText, imageParseSourceBlocks } from './imageParseEditorSource';
import {
  comparableImageParseFormula,
  deduplicateImageParseFormulaMarkdown,
} from './imageParseFormulaMarkdown';
import {
  imageParseMarkdownOverlaps,
  imageParseMarkdownReplacementRanges,
} from './imageParseMarkdownRanges';

interface SourceBlock {
  type: string;
  start: number;
  end: number;
  text: string;
  textCursor: number;
  rawCursor: number;
}

interface Match {
  start: number;
  end: number;
  nodeStart: number;
  nodeEnd: number;
  textStart?: number;
  textEnd?: number;
  fullNode?: boolean;
}

interface Insertion {
  offset: number;
  blocks: number[];
  value: string;
}

const IMAGE_KINDS = new Set(['image', 'chart', 'seal']);

/** When layout gathers an icon and text into a footer image, the server body has no matching fragment. Add one image so the box can jump there. */
function isOmittedFooterImage(block: ImageParseLayoutBlock): boolean {
  return (block.label ?? '').toLowerCase() === 'footer_image' && IMAGE_KINDS.has(block.kind);
}

/** An empty seal has no text to write back into the body; an original-image placeholder keeps its place in reading order. */
function isOmittedSealImage(block: ImageParseLayoutBlock): boolean {
  return block.kind === 'seal' && !block.text.trim();
}

function omittedImageMarkdown(block: ImageParseLayoutBlock): string {
  return isOmittedFooterImage(block) || isOmittedSealImage(block) ? '![image]()' : block.text;
}

/** Ignore only layout whitespace; text and punctuation must still match. Do not fuzzy-correct recognition results. */
function comparableText(source: string): string {
  return imageParseSourceBlocks(source)
    .map((node) => imageParseNodeText(node))
    .join('')
    .replace(/\s+/g, '');
}

/**
 * Check word boundaries only for pure numbers or pure Latin words. Chinese body text has no spaces, so adjacent list items
 * concatenated character by character must not be treated as one word; an id such as `01A` must also be allowed to hit inside concatenated text.
 */
const WORD_CHAR = /[\p{Script=Latin}\p{N}]/u;
const BOUNDED_NEEDLE = /^(?:\p{N}+|\p{Script=Latin}+)$/u;

/** Numbers and words hit only on a complete boundary, so page number 20 does not fall inside the year 2018. */
function findBounded(text: string, needle: string, from: number): number {
  if (!BOUNDED_NEEDLE.test(needle)) return text.indexOf(needle, from);
  let index = text.indexOf(needle, from);
  while (index >= 0) {
    const before = index > 0 ? text[index - 1]! : '';
    const after = text[index + needle.length] ?? '';
    const head = needle[0] ?? '';
    const tail = needle[needle.length - 1] ?? '';
    if (
      !(WORD_CHAR.test(head) && WORD_CHAR.test(before)) &&
      !(WORD_CHAR.test(tail) && WORD_CHAR.test(after))
    )
      return index;
    index = text.indexOf(needle, index + 1);
  }
  return -1;
}

/**
 * Images are recognized only as `![image]()` in the body.
 * The placeholder's alt text is image, and must not be matched against the same word in an ordinary paragraph.
 */
function findImagePlaceholder(source: string, nodes: SourceBlock[]): Match | undefined {
  const placeholder = '![image]()';
  for (const node of nodes) {
    const exact = source.indexOf(placeholder, node.rawCursor);
    if (exact < node.start || exact + placeholder.length > node.end) continue;
    node.rawCursor = exact + placeholder.length;
    for (const earlier of nodes) {
      if (earlier.start >= node.start) break;
      earlier.rawCursor = earlier.end;
    }
    return {
      start: exact,
      end: exact + placeholder.length,
      nodeStart: node.start,
      nodeEnd: node.end,
    };
  }
  return undefined;
}

/** Consume each match position, so repeated text in different recognition blocks does not share one occurrence. */
function findMatch(source: string, text: string, nodes: SourceBlock[]): Match | undefined {
  const comparable = comparableText(text);
  if (!comparable) return undefined;
  for (const node of nodes) {
    const exact = findBounded(source, text, node.rawCursor);
    if (exact >= node.start && exact < node.end && exact + text.length > node.end) {
      const last = nodes.find((item) => item.end >= exact + text.length);
      if (!last) continue;
      // One service block may cover several paragraphs; keep the full original range instead of concatenating it again.
      for (const covered of nodes) {
        if (covered.start > last.start) break;
        covered.rawCursor = Math.min(covered.end, exact + text.length);
        covered.textCursor = comparableText(source.slice(covered.start, covered.rawCursor)).length;
      }
      return { start: exact, end: exact + text.length, nodeStart: node.start, nodeEnd: last.end };
    }
    const index = findBounded(node.text, comparable, node.textCursor);
    // Skipping a short number in the middle of a node would take page number 20 for a volume/issue in the references, and insert the earlier paragraph a second time.
    if (index < 0 || (index !== node.textCursor && node.text !== comparable)) continue;
    node.textCursor = index + comparable.length;
    const rawMatch = exact >= node.start && exact + text.length <= node.end;
    node.rawCursor = rawMatch ? exact + text.length : node.end;
    // A semantic block already passed is no longer matched, so the order stays consistent with the service reading order.
    for (const earlier of nodes) {
      if (earlier.start >= node.start) break;
      earlier.textCursor = earlier.text.length;
    }
    return {
      start: rawMatch ? exact : node.start,
      end: rawMatch ? exact + text.length : node.end,
      nodeStart: node.start,
      nodeEnd: node.end,
      textStart: index,
      textEnd: index + comparable.length,
    };
  }
  return undefined;
}

/** Bind a structured formula block to a complete display-math node in the body, so bare LaTeX is not written in as an ordinary paragraph. */
function findFormulaMatch(text: string, nodes: SourceBlock[]): Match | undefined {
  const comparable = comparableImageParseFormula(text);
  if (!comparable) return undefined;
  for (const node of nodes) {
    if (node.type !== 'math' || node.start < node.rawCursor) continue;
    if (comparableImageParseFormula(node.text) !== comparable) continue;
    node.rawCursor = node.end;
    node.textCursor = node.text.length;
    for (const earlier of nodes) {
      if (earlier.start >= node.start) break;
      earlier.textCursor = earlier.text.length;
    }
    return {
      start: node.start,
      end: node.end,
      nodeStart: node.start,
      nodeEnd: node.end,
      fullNode: true,
    };
  }
  return undefined;
}

/**
 * Keep the service Markdown, and insert blocks that were recognized successfully but omitted from the aggregated body between complete semantic blocks.
 * Matching ignores Markdown layout and whitespace differences; image placeholders, failed blocks, and existing tables stay as-is.
 * @param source aggregated service body
 * @param blocks recognition blocks already in service reading order and validated
 * @returns the compatible body and exact positioning ranges, shared by preview, edit, copy, and download
 */
/** A relative illustration path the browser cannot open is turned back into an empty placeholder, and the preview crops it from the original image. */
function browserImagePlaceholders(source: string): string {
  return source.replace(
    /!\[image\]\((?:<([^>\r\n]+)>|([^)\s]+))\)/g,
    (full, angled: string | undefined, plain: string | undefined) => {
      const target = (angled ?? plain ?? '').trim();
      if (!target || /^(?:https?:|data:)/i.test(target)) return full;
      return '![image]()';
    },
  );
}

export function reconcileImageParseMarkdown(
  source: string,
  blocks: readonly ImageParseLayoutBlock[],
): ImageParseSdkResult {
  source = browserImagePlaceholders(source);
  source = deduplicateImageParseFormulaMarkdown(source, blocks);
  const nodes: SourceBlock[] = imageParseSourceBlocks(source).flatMap((node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined || node.type === 'definition') return [];
    return [
      {
        type: node.type,
        start,
        end,
        text: imageParseNodeText(node).replace(/\s+/g, ''),
        textCursor: 0,
        rawCursor: start,
      },
    ];
  });
  const placeholderCount = [...source.matchAll(/!\[image\]\(\)/g)].length;
  const cropBlocks = imageParseMarkdownCropBlocks(blocks, placeholderCount);
  // Images and body text may use different reading orders; consume their match cursors separately so they do not skip existing content past each other.
  const imageNodes = nodes.map((node) => ({ ...node }));
  // A number the service explicitly marked as a heading belongs to the body and must not be stripped by Markdown as an ordered-list marker.
  // Heading semantics are added only for matching, and do not rewrite the service original or the final Markdown.
  const texts = blocks.map((block) =>
    block.kind === 'heading' && /^\s*\d+[.)]\s/.test(block.text)
      ? `# ${block.text.trimStart()}`
      : block.text,
  );
  const matches = blocks.map((block, index) => {
    if (block.kind === 'formula')
      return findFormulaMatch(block.text, nodes) ?? findMatch(source, block.text, nodes);
    // Seals and charts that have text bind to the body, and do not take an image-placeholder or other illustration mapping slot.
    if (!IMAGE_KINDS.has(block.kind) || isImageParseDisplayTextBlock(block))
      return findMatch(source, texts[index], nodes);
    // Use image placeholders as anchors only when the counts match, the same way crop rules avoid guessing which image is which.
    return cropBlocks.includes(block) ? findImagePlaceholder(source, imageNodes) : undefined;
  });
  const replacements = imageParseMarkdownReplacementRanges(source, texts, matches);
  const overlaps = imageParseMarkdownOverlaps(source, texts, matches, replacements);
  const insertions: Insertion[] = [];
  blocks.forEach((block, index) => {
    const omittedFooterImage = isOmittedFooterImage(block);
    const omittedSealImage = isOmittedSealImage(block);
    if (
      matches[index] ||
      overlaps.has(index) ||
      (!omittedFooterImage &&
        !omittedSealImage &&
        (block.status !== 'ok' || !block.text.trim() || IMAGE_KINDS.has(block.kind)))
    )
      return;
    const previous = matches
      .slice(0, index)
      .reverse()
      .find((match) => match !== undefined);
    const next = matches.slice(index + 1).find((match) => match !== undefined);
    // When it cannot be inserted safely inside the same paragraph or list, place it after the complete block, so table or heading syntax is not broken.
    const offset = next ? Math.max(next.nodeStart, previous?.nodeEnd ?? 0) : source.length;
    const group = insertions.find((insertion) => insertion.offset === offset);
    if (group) group.blocks.push(index);
    else insertions.push({ offset, blocks: [index], value: '' });
  });
  insertions.sort((a, b) => a.offset - b.offset);
  const insertedRanges = new Map<number, { start: number; end: number }>();
  let markdown = '';
  let cursor = 0;
  for (const insertion of insertions) {
    markdown += source.slice(cursor, insertion.offset);
    const prefix = markdown && !/\n\s*\n$/.test(markdown) ? '\n\n' : '';
    let value = prefix;
    for (const index of insertion.blocks) {
      if (value !== prefix) value += '\n\n';
      const start = markdown.length + value.length;
      value += omittedImageMarkdown(blocks[index]!);
      insertedRanges.set(index, { start, end: markdown.length + value.length });
    }
    const remaining = source.slice(insertion.offset);
    if (remaining && !/^\s*\n\s*\n/.test(remaining)) value += '\n\n';
    insertion.value = value;
    markdown += value;
    cursor = insertion.offset;
  }
  markdown += source.slice(cursor);
  const mappedBlocks = blocks.map((block, index) => {
    const inserted = insertedRanges.get(index);
    const match = matches[index];
    if (overlaps.has(index))
      return { ...block, markdown: '', markdownStart: undefined, markdownEnd: undefined };
    if (!inserted && !match) return block;
    const replacement = cropBlocks.includes(block) || match?.fullNode ? match : replacements[index];
    if (!inserted && !replacement)
      return { ...block, markdown: '', markdownStart: undefined, markdownEnd: undefined };
    const start =
      inserted?.start ??
      replacement!.start +
        insertions
          .filter(({ offset }) => offset <= replacement!.start)
          .reduce((sum, { value }) => sum + value.length, 0);
    const end =
      inserted?.end ??
      replacement!.end +
        insertions
          .filter(({ offset }) => offset < replacement!.end)
          .reduce((sum, { value }) => sum + value.length, 0);
    return {
      ...block,
      markdown: markdown.slice(start, end),
      markdownStart: start,
      markdownEnd: end,
    };
  });
  return { markdown, blocks: mappedBlocks };
}
