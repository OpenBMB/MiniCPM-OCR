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

/** 版面把图标和文字收成页脚图时，服务端正文里没有对应片段。补一张图，框才能跳过去。 */
function isOmittedFooterImage(block: ImageParseLayoutBlock): boolean {
  return (block.label ?? '').toLowerCase() === 'footer_image' && IMAGE_KINDS.has(block.kind);
}

/** 空印章没有可写回正文的文字，用原图占位符保留它在阅读顺序中的位置。 */
function isOmittedSealImage(block: ImageParseLayoutBlock): boolean {
  return block.kind === 'seal' && !block.text.trim();
}

function omittedImageMarkdown(block: ImageParseLayoutBlock): string {
  return isOmittedFooterImage(block) || isOmittedSealImage(block) ? '![image]()' : block.text;
}

/** 只忽略排版空白；文字与标点仍必须一致，不对识别结果做模糊纠错。 */
function comparableText(source: string): string {
  return imageParseSourceBlocks(source)
    .map((node) => imageParseNodeText(node))
    .join('')
    .replace(/\s+/g, '');
}

/**
 * 只对纯数字或纯拉丁单词检查词边界。中文正文没有空格，按字符拼在一起的
 * 相邻列表项不能被当作一个单词；`01A` 这类编号也要允许在拼接文本中命中。
 */
const WORD_CHAR = /[\p{Script=Latin}\p{N}]/u;
const BOUNDED_NEEDLE = /^(?:\p{N}+|\p{Script=Latin}+)$/u;

/** 数字和单词只在完整边界上命中，避免页码 20 落进年份 2018。 */
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
 * 图片只认正文里的 `![image]()`。
 * 占位符的说明文字是 image，不能拿它去对普通段落里的同一个词。
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

/** 消耗每次匹配的位置，使不同识别块中的重复文字不会共用同一次出现。 */
function findMatch(source: string, text: string, nodes: SourceBlock[]): Match | undefined {
  const comparable = comparableText(text);
  if (!comparable) return undefined;
  for (const node of nodes) {
    const exact = findBounded(source, text, node.rawCursor);
    if (exact >= node.start && exact < node.end && exact + text.length > node.end) {
      const last = nodes.find((item) => item.end >= exact + text.length);
      if (!last) continue;
      // 一个服务块可能覆盖多个段落，直接保留完整原文范围而不是重复拼接。
      for (const covered of nodes) {
        if (covered.start > last.start) break;
        covered.rawCursor = Math.min(covered.end, exact + text.length);
        covered.textCursor = comparableText(source.slice(covered.start, covered.rawCursor)).length;
      }
      return { start: exact, end: exact + text.length, nodeStart: node.start, nodeEnd: last.end };
    }
    const index = findBounded(node.text, comparable, node.textCursor);
    // 跳过节点中间的短数字会把页码 20 认成参考文献里的卷期，并让前面的段落被再插入一次。
    if (index < 0 || (index !== node.textCursor && node.text !== comparable)) continue;
    node.textCursor = index + comparable.length;
    const rawMatch = exact >= node.start && exact + text.length <= node.end;
    node.rawCursor = rawMatch ? exact + text.length : node.end;
    // 已越过的语义块不再参与匹配，保证与服务阅读顺序一致。
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

/** 将结构化公式块绑定到正文中的完整 display-math 节点，避免按普通段落补写裸 LaTeX。 */
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
 * 保留服务 Markdown，将成功识别但聚合正文遗漏的块补入完整语义块之间。
 * 匹配忽略 Markdown 排版与空白差异；图片占位符、失败块和原有表格保持原样。
 * @param source 服务聚合正文
 * @param blocks 已按服务阅读顺序排列、完成校验的识别块
 * @returns 兼容后的正文及精确定位范围，供预览、编辑、复制和下载共用
 */
/** 浏览器打不开的相对插图路径改回空占位符，预览再按原图裁出来。 */
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
  // 图片与正文可能采用不同的阅读顺序，分别消耗匹配游标，避免相互跳过已有内容。
  const imageNodes = nodes.map((node) => ({ ...node }));
  // 服务明确标为标题的编号属于正文，不能被 Markdown 当作有序列表标记剥掉。
  // 仅为匹配补充标题语义，不改写服务原文或最终 Markdown。
  const texts = blocks.map((block) =>
    block.kind === 'heading' && /^\s*\d+[.)]\s/.test(block.text)
      ? `# ${block.text.trimStart()}`
      : block.text,
  );
  const matches = blocks.map((block, index) => {
    if (block.kind === 'formula')
      return findFormulaMatch(block.text, nodes) ?? findMatch(source, block.text, nodes);
    // 有文字的印章和图表绑定正文，不占用图片占位符或其它插图的映射位置。
    if (!IMAGE_KINDS.has(block.kind) || isImageParseDisplayTextBlock(block))
      return findMatch(source, texts[index], nodes);
    // 数量一致时才将图片占位符作为锚点，与裁图规则一样避免猜测图片对应关系。
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
    // 同一段落/列表内无法安全插入时，放在完整块之后，避免破坏表格或标题语法。
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
