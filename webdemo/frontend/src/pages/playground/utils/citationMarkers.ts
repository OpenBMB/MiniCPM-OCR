/**
 * Preprocess citation markers into Markdown links.
 *
 * Purpose: the model is prompted to follow a claim with a `[ref_N]` marker, but real output also mixes in bare `[N]` (a common prior of Chinese models).
 * Rewrite both kinds of marker into links to the matching source before Markdown parsing, so body rendering only has to
 * handle an `a`, with no walk of text nodes inside p/li/td children.
 *
 * Numbers are always looked up by the ref issued by the backend, not by the citations array index: the array accumulates and dedupes across turns,
 * and each turn the backend reorders results by relevance. The two line up only by chance on a single-turn search.
 */

import type { Citation } from '../types';
import { safeCitationHref } from './citations';

/**
 * Code spans: fenced code blocks and inline code.
 *
 * Fences use ```` ```…``` ```` / `~~~…~~~`, and the close may hit the end of the string — while streaming, before the fence closes,
 * the rest of the text must be treated as code so a `[1]` inside code is not rewritten into a link.
 */
const CODE_SEGMENT = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g;

/**
 * Citation markers: `[ref_N]` (the form the prompt requires) or a bare `[N]` (the fallback when the model does not follow instructions).
 *
 * One pair of brackets may hold several numbers (`[ref_3, ref_5]`): the prompt only requires "a marker right after the claim" and never says
 * a claim may cite only one source, so the model often writes several sources into one pair of brackets. Missing this form costs more than a
 * link — a leftover bare marker falls into bare-math recognition, `ref_3, ref_5` exactly matches the subscript pattern, the brackets are eaten as formula
 * delimiters, and the body is left with a run of italics (the math-side fallback is isCitationMarker in math-katex).
 *
 * The width of 3 digits matches the backend hostedRefMarkerRe; widening it does not add false hits, because a number is rewritten only when it can be
 * found in the ref table (see resolveCitation), and anything not found is left as-is.
 * A half-written `[1` naturally does not match, so streaming needs no extra defense.
 */
const CITATION_MARKER = /\[(?:ref_)?\d{1,3}(?:\s*[,，、;；]\s*(?:ref_)?\d{1,3})*\]/g;

/** Take numbers one by one from inside a marker, in the order the model wrote them. */
const MARKER_NUMBER = /(?:ref_)?(\d{1,3})/g;

/** A character immediately left of the marker means this is an index lookup (such as `arr[1]`), not a citation, and must not be rewritten. */
const IDENTIFIER_CHAR = /[A-Za-z0-9_$\]]/;

/** A same-shaped marker immediately to the left, used to treat a run such as `[1][2]` as one sequence when deciding what it belongs to. */
const TRAILING_MARKER = /\[(?:ref_)?\d{1,3}(?:\s*[,，、;；]\s*(?:ref_)?\d{1,3})*\]$/;

/**
 * Rewrite citation markers in the body into Markdown links that point at sources.
 *
 * Rewrite only when the number can be resolved to a source, so during streaming a marker whose source has not arrived yet stays as-is,
 * and becomes a link on the next render after the source arrives.
 *
 * @param markdown original Markdown from the model
 * @param citations sources already received for this answer
 * @returns text with markers replaced by Markdown links; returned as-is when there are no sources
 */
export function linkifyCitationMarkers(markdown: string, citations: Citation[]): string {
  if (!markdown || citations.length === 0) return markdown;
  if (!markdown.includes('[')) return markdown;

  const byRef = new Map<number, Citation>();
  for (const citation of citations) {
    if (citation.ref && !byRef.has(citation.ref)) byRef.set(citation.ref, citation);
  }

  // Split on code segments: when split keeps the capture group, odd indexes are the separator itself (code) and stay untouched.
  return markdown
    .split(CODE_SEGMENT)
    .map((segment, index) =>
      index % 2 === 1 ? segment : linkifySegment(segment, citations, byRef),
    )
    .join('');
}

/**
 * Find the source for a marker number.
 *
 * Once the backend has issued a ref, numbers are resolved only against the ref table: a miss means the model invented a number that does not exist,
 * and it is better to leave the bare text than to fall back to the array index — that would point the invalid marker at an unrelated source.
 * Only when the whole batch has no ref are we talking to an old backend, and then the array index is the only usable measure.
 */
function resolveCitation(
  citations: Citation[],
  byRef: Map<number, Citation>,
  index: number,
): Citation | undefined {
  if (byRef.size > 0) return byRef.get(index);
  return citations[index - 1];
}

/** Rewrite markers in a single non-code segment. */
function linkifySegment(
  segment: string,
  citations: Citation[],
  byRef: Map<number, Citation>,
): string {
  return segment.replace(CITATION_MARKER, (match: string, offset: number) => {
    const before = chainLeadingChar(segment, offset);
    // `![1]` is image syntax
    if (before === '!') return match;
    // `arr[1]` is an index lookup. This check applies only to bare markers: the `ref_` prefix already disambiguates, and in English body text
    // "the marker follows the claim" is necessarily written as blue[ref_1]. Cutting on an identifier would swallow every marker in an English answer.
    if (!match.startsWith('[ref_') && before !== undefined && IDENTIFIER_CHAR.test(before)) {
      return match;
    }

    const after = segment.slice(offset + match.length);
    // `[1](…)` is already a link, and `[1]: …` is a link reference definition; neither can be wrapped again
    if (after.startsWith('(') || after.startsWith(':')) return match;

    return linkifyMarker(match, citations, byRef);
  });
}

/**
 * Rewrite one marker into adjacent Markdown links. A grouped form such as `[ref_3, ref_5]` expands into several.
 *
 * If any number cannot be resolved to a source, or the address cannot be embedded safely, give up the whole marker: a partial rewrite would turn `[ref_3, ref_5]` into
 * "one link + a trailing bare text fragment", and the reader could not tell whether the trailing part was not found or failed to render. Leaving the whole thing as the original is better.
 *
 * @param match the full marker text that matched
 * @param citations sources already received for this answer
 * @param byRef source index built from refs issued by the backend
 * @returns the rewritten link string; the original when any number cannot be resolved
 */
function linkifyMarker(match: string, citations: Citation[], byRef: Map<number, Citation>): string {
  const links: string[] = [];
  for (const [, digits] of match.matchAll(MARKER_NUMBER)) {
    const index = Number(digits);
    const citation = resolveCitation(citations, byRef, index);
    if (!citation) return match;
    const destination = markdownDestination(citation.url);
    if (!destination) return match;
    links.push(`[${index}](${destination})`);
  }
  return links.length > 0 ? links.join('') : match;
}

/**
 * Take the first character to the left of the "contiguous marker run" that contains this marker.
 *
 * `]` itself is in IDENTIFIER_CHAR (to block `arr[1]`). Looking at the previous character directly would misread the second marker of `[1][2]`
 * as an index chain. Peel off contiguous same-shaped markers on the left first, then use the character before the run to decide whether the whole run is a citation or an index:
 * a run preceded by a non-identifier character peels back to that character → a citation; `arr[1][2]` peels back to "r" → an index.
 *
 * @param segment the current non-code segment
 * @param offset start position of this match inside the segment
 * @returns the character to the left of the run start; undefined when the marker is at the start of the segment
 */
function chainLeadingChar(segment: string, offset: number): string | undefined {
  let start = offset;
  let trailing = TRAILING_MARKER.exec(segment.slice(0, start));
  while (trailing) {
    start -= trailing[0].length;
    trailing = TRAILING_MARKER.exec(segment.slice(0, start));
  }
  return start > 0 ? segment[start - 1] : undefined;
}

/**
 * Build a target address that can be embedded safely in a Markdown link.
 * An address that contains whitespace or brackets must be wrapped in angle brackets, or Markdown parsing truncates at the first `)`.
 */
function markdownDestination(url: string): string | undefined {
  if (!safeCitationHref(url)) return undefined;
  if (url.includes('<') || url.includes('>')) return undefined;
  return /[\s()]/.test(url) ? `<${url}>` : url;
}
