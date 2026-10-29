import type { ImageParseTextRange } from './imageParseBlocks';

/** Find the exact range of one replacement; source editing uses the common prefix and suffix and does not guess the position of repeated text again. */
function replacementRange(
  before: string,
  after: string,
  explicit?: ImageParseTextRange,
): ImageParseTextRange {
  if (
    explicit &&
    explicit.start >= 0 &&
    explicit.end >= explicit.start &&
    explicit.end <= before.length
  ) {
    const newEnd = explicit.end + after.length - before.length;
    if (
      newEnd >= explicit.start &&
      before.slice(0, explicit.start) === after.slice(0, explicit.start) &&
      before.slice(explicit.end) === after.slice(newEnd)
    )
      return explicit;
  }
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = before.length;
  let newEnd = after.length;
  while (end > start && newEnd > start && before[end - 1] === after[newEnd - 1]) {
    end--;
    newEnd--;
  }
  return { start, end };
}

/**
 * Update original-image block ranges from one replacement, keeping the edited block and every block after it linked.
 * An ambiguous replacement that spans several recognition blocks drops only the affected ranges and does not turn off positioning for the whole document.
 */
export function imageParseDraftRanges(
  before: string,
  after: string,
  ranges: ReadonlyMap<string, ImageParseTextRange>,
  explicit?: ImageParseTextRange,
): ReadonlyMap<string, ImageParseTextRange> {
  if (before === after) return ranges;
  const change = replacementRange(before, after, explicit);
  const delta = after.length - before.length;
  const newEnd = change.end + delta;
  const overlaps = [...ranges.values()].filter(
    (range) => range.start < change.end && range.end > change.start,
  );
  const result = new Map<string, ImageParseTextRange>();
  for (const [id, range] of ranges) {
    if (range.end <= change.start) result.set(id, range);
    else if (range.start >= change.end)
      result.set(id, { start: range.start + delta, end: range.end + delta });
    else if (range.start <= change.start && range.end >= change.end) {
      if (range.end + delta > range.start)
        result.set(id, { start: range.start, end: range.end + delta });
    } else if (overlaps.length === 1 && newEnd > change.start) {
      result.set(id, {
        start: Math.min(range.start, change.start),
        end: Math.max(range.end + delta, newEnd),
      });
    }
  }
  return result;
}
