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
 * Detect the real overlap of candidate ranges of service blocks, so body text that already belongs to another block is not inserted again.
 * @param source original Markdown
 * @param texts recognition-block text
 * @param matches match results after reading positions have been consumed
 * @param replacements confirmed complete replacement ranges, so a positioning anchor of the whole list is not used to misjudge a neighboring item
 * @returns indexes of blocks whose ranges conflict; those blocks must not be filled in or overwritten
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
    // Replace only at the semantic boundary of a complete item; do not include other items of the same list.
    if (cursor === match.textStart) start = range.start;
    cursor += imageParseNodeText(item).replace(/\s+/g, '').length;
    if (start !== undefined && cursor === match.textEnd) return { start, end: range.end };
    if (cursor > match.textEnd) return undefined;
  }
  return undefined;
}

/**
 * Promote a text match to a complete Markdown semantic range, including existing markers such as headings, lists, and bold.
 * @param source original whole-page Markdown
 * @param texts recognition text returned in reading order
 * @param matches match results that have already consumed repeated-text positions
 * @returns unique and complete replacement ranges; partial text inside a paragraph remains a positioning anchor, but must not be recomputed over
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
    // Missing one repeated number must not disable other sections; accept only a unique already-matched candidate between complete blocks before and after.
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
