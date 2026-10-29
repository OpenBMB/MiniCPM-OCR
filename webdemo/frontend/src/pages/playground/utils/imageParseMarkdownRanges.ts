import type { ImageParseTextRange } from './imageParseBlocks';
import { imageParseNodeText, imageParseSourceBlocks } from './imageParseEditorSource';

interface MatchedText extends ImageParseTextRange {
  nodeStart: number;
  nodeEnd: number;
  textStart?: number;
  textEnd?: number;
}

type SourceNode = ReturnType<typeof imageParseSourceBlocks>[number];

function nodeRange(node: SourceNode): ImageParseTextRange | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start !== undefined && end !== undefined ? { start, end } : undefined;
}

function plainText(text: string): string {
  return imageParseSourceBlocks(text)
    .map((node) => imageParseNodeText(node))
    .join('')
    .replace(/\s+/g, '');
}

function completeRanges(nodes: SourceNode[], target: string): ImageParseTextRange[] {
  const ranges: ImageParseTextRange[] = [];
  const items = nodes.map((node) => ({
    range: nodeRange(node),
    text: imageParseNodeText(node).replace(/\s+/g, ''),
  }));
  items.forEach((first, index) => {
    const start = first.range?.start;
    if (start === undefined) return;
    let text = '';
    for (let next = index; next < items.length; next++) {
      text += items[next].text;
      if (!target.startsWith(text)) break;
      const end = items[next].range?.end;
      if (text === target && end !== undefined) ranges.push({ start, end });
    }
  });
  return ranges;
}

function possibleRanges(nodes: SourceNode[], target: string): ImageParseTextRange[] {
  if (!target) return [];
  const candidates = completeRanges(nodes, target);
  for (const node of nodes) {
    if (node.type === 'list') candidates.push(...completeRanges(node.children ?? [], target));
  }
  return [...new Map(candidates.map((range) => [`${range.start}:${range.end}`, range])).values()];
}

/**
 * 检测服务块候选范围的实际交集，避免把已属于另一块的正文再次补入。
 * @param source 原始 Markdown
 * @param texts 识别块文字
 * @param matches 消耗阅读位置后的匹配结果
 * @param replacements 已确认的完整替换范围，避免用整个列表的定位锚点误判相邻条目
 * @returns 存在范围冲突的块序号，禁止补齐或覆盖这些块
 */
export function imageParseMarkdownOverlaps(
  source: string,
  texts: readonly string[],
  matches: readonly (MatchedText | undefined)[],
  replacements: readonly (ImageParseTextRange | undefined)[],
): ReadonlySet<number> {
  const nodes = imageParseSourceBlocks(source);
  const normalized = texts.map(plainText);
  const overlaps = new Set<number>();
  normalized.forEach((text, index) => {
    if (!text) return;
    const candidates = possibleRanges(nodes, text);
    matches.forEach((match, other) => {
      const occupied = replacements[other] ?? match;
      const current = replacements[index] ?? matches[index];
      if (
        index !== other &&
        occupied &&
        normalized[other] !== text &&
        (!current || (current.start < occupied.end && current.end > occupied.start)) &&
        candidates.some((range) => range.start < occupied.end && range.end > occupied.start)
      ) {
        overlaps.add(index);
        overlaps.add(other);
      }
    });
  });
  return overlaps;
}

function listRange(node: SourceNode, match: MatchedText): ImageParseTextRange | undefined {
  if (match.textStart === undefined || match.textEnd === undefined) return undefined;
  let cursor = 0;
  let start: number | undefined;
  for (const item of node.children ?? []) {
    const range = nodeRange(item);
    if (!range || item.type !== 'listItem') return undefined;
    // 只在完整条目的语义边界处替换；不能把同列表的其它条目包含进来。
    if (cursor === match.textStart) start = range.start;
    cursor += imageParseNodeText(item).replace(/\s+/g, '').length;
    if (start !== undefined && cursor === match.textEnd) return { start, end: range.end };
    if (cursor > match.textEnd) return undefined;
  }
  return undefined;
}

/**
 * 将文字匹配提升为完整 Markdown 语义范围，包含标题、列表和加粗等原有标记。
 * @param source 原始整页 Markdown
 * @param texts 按阅读顺序返回的识别文字
 * @param matches 已消耗重复文字位置的匹配结果
 * @returns 唯一且完整的替换范围；段落内的局部文字仍作定位锚点，但不允许重算覆盖
 */
export function imageParseMarkdownReplacementRanges(
  source: string,
  texts: readonly string[],
  matches: readonly (MatchedText | undefined)[],
): readonly (ImageParseTextRange | undefined)[] {
  const nodes = imageParseSourceBlocks(source);
  const normalized = texts.map(plainText);
  const counts = new Map<string, number>();
  normalized.forEach((text) => counts.set(text, (counts.get(text) ?? 0) + 1));
  const candidates = new Map([...counts.keys()].map((text) => [text, possibleRanges(nodes, text)]));
  const ambiguous = normalized.map(
    (text) => (candidates.get(text)?.length ?? 0) > (counts.get(text) ?? 0),
  );
  const matchedRanges = matches.map((match, index) => {
    if (!match) return undefined;
    const covered = nodes.filter((node) => {
      const range = nodeRange(node);
      return range && range.start >= match.nodeStart && range.end <= match.nodeEnd;
    });
    const first = covered[0];
    const last = covered[covered.length - 1];
    const start = first && nodeRange(first)?.start;
    const end = last && nodeRange(last)?.end;
    if (start !== match.nodeStart || end !== match.nodeEnd) return undefined;
    const target = normalized[index];
    if (!target) return undefined;
    const complete = covered
      .map((node) => imageParseNodeText(node))
      .join('')
      .replace(/\s+/g, '');
    if (
      complete === target &&
      (match.textStart === undefined || match.textStart === 0) &&
      (match.textEnd === undefined || match.textEnd === complete.length)
    )
      return { start, end };
    if (covered.length === 1 && first.type === 'list') return listRange(first, match);
    return undefined;
  });
  const anchors = matchedRanges.map((range, index) => (ambiguous[index] ? undefined : range));
  return matchedRanges.map((range, index) => {
    if (!range || !ambiguous[index]) return range;
    // 漏检一个重复编号不应禁用其它章节；只接受前后完整块之间唯一且已匹配的候选。
    const previous = anchors
      .slice(0, index)
      .reverse()
      .find((anchor) => anchor !== undefined);
    const next = anchors.slice(index + 1).find((anchor) => anchor !== undefined);
    const scoped = candidates
      .get(normalized[index])
      ?.filter(
        (candidate) =>
          candidate.start >= (previous?.end ?? 0) &&
          candidate.end <= (next?.start ?? source.length),
      );
    return scoped?.length === 1 && scoped[0].start === range.start && scoped[0].end === range.end
      ? range
      : undefined;
  });
}
