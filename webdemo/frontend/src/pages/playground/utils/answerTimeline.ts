/**
 * Pure functions that order and read the answer-process timeline.
 *
 * Purpose: turn "one streaming reasoning blob" and "tool events in arrival order" back into the model's real
 * "reason → call a tool → continue reasoning" timeline, and resolve the sources shown inline on a tool row.
 */

import type { Citation, ToolEvent } from '../types';
import { citationURLKey } from './citations';

/** Tool names that count as web-search activity. */
export const WEB_TOOLS = new Set(['web_search', 'web_extractor']);

/** Maximum site icons stacked on a tool row and a source pill; extras are not counted. The stack only suggests "these sites were touched". */
export const MAX_ROW_FAVICONS = 4;

/** Maximum page titles shown inline on a tool row; the rest use +N. */
export const MAX_ROW_TITLES = 3;

/** Per-step delay and maximum tier of the stagger entrance animation, so the last source does not wait several seconds when there are many. */
export const STAGGER_STEP_MS = 60;
export const STAGGER_MAX_STEPS = 6;

/**
 * Whether the tool is the built-in page reader (web_extractor).
 * @param tool tool name
 * @returns true when the tool reads page body text rather than search results
 */
export function isReaderTool(tool: string | undefined): boolean {
  return tool === 'web_extractor';
}

/**
 * Whether the tool is the built-in web search (web_search).
 * @param tool tool name
 * @returns true when the tool produces a search-result list
 */
export function isSearchTool(tool: string | undefined): boolean {
  return tool === 'web_search';
}

/** One timeline item: a reasoning segment, or one tool call. */
export type ProcessTimelineItem =
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'tool'; id: string; event: ToolEvent };

/** Timeline ordering result. */
export interface ProcessTimeline {
  items: ProcessTimelineItem[];
  /**
   * Whether interleaving actually happened. false means it fell back to "the whole reasoning block on top + tool rows underneath" —
   * still one line, but it no longer shows where in the reasoning each tool was inserted.
   */
  interleaved: boolean;
}

/**
 * Split reasoning text at tool-event split points and interleave it with tool rows into one timeline.
 *
 * The split point is `ToolEvent.reasoningOffset` (the character count accumulated in the SSE callback while streaming).
 * The `reasoning` passed in must be the **untrimmed original**: offsets are accumulated against that text. Trimming first and then
 * splitting by offset shifts everything (models often leave a newline before a tool call, so the trimmed display length is shorter than the offset).
 * Leading and trailing whitespace inside each segment is cleaned up by a per-segment trim.
 *
 * Interleaving is impossible in these two cases, which fall back to putting the whole reasoning block on top:
 * - `reasoningRewritten`: the display layer's normalizeAssistantReply rewrote the reasoning text (cleared it, or prepended a leftover think
 *   segment from the body), so every offset is misaligned;
 * - any event lacks `reasoningOffset`: a non-streaming answer arrives as one full text, as do history messages stored before this change.
 *
 * @param input original reasoning, tool events in arrival order, whether the display layer rewrote it, and whether to hold back tool rows not yet played
 * @returns timeline items and whether they are truly interleaved
 */
export function buildProcessTimeline(input: {
  reasoning: string;
  toolEvents: ToolEvent[];
  reasoningRewritten?: boolean;
  /** Pass true while streaming: tool rows whose split point the playback queue has not reached yet stay hidden. See the comment inside the loop. */
  holdUnplayed?: boolean;
}): ProcessTimeline {
  const { reasoning, toolEvents, reasoningRewritten = false, holdUnplayed = false } = input;
  const canInterleave =
    !reasoningRewritten &&
    toolEvents.length > 0 &&
    toolEvents.every((event) => event.reasoningOffset !== undefined);

  if (!canInterleave) {
    const items: ProcessTimelineItem[] = [];
    pushReasoning(items, reasoning, 0);
    for (const event of toolEvents) {
      items.push({ kind: 'tool', id: event.eventId, event });
    }
    return { items, interleaved: false };
  }

  const items: ProcessTimelineItem[] = [];
  // A single cursor is enough: the backend emit never sets event_id, so toolEventKey falls back to legacy:step:tool,
  // and the array order of toolEvents is the arrival order. There is no need to group by step again.
  // The lower bound is the cursor, which keeps it monotonic (several tools in the same step share one split point and must not move backward).
  let cursor = 0;
  for (const event of toolEvents) {
    const target = event.reasoningOffset ?? 0;
    /*
      While streaming, tool rows that have not been played yet are held back. The offset records how many characters had **already been enqueued**
      when the SSE event arrived, while reasoning here is the text **already displayed** after the 16ms playback queue, so the two differ by the whole backlog.
      Without holding them back, the clamp below pulls the split point forward to the displayed length, and the tool row pops out before the reasoning above it finishes playing —
      it reads as a row jumping out before the sentence is finished. Hold until playback catches up, and the order matches what the model actually did.

      Tool events are monotonic in arrival order, so the first one not yet played can break out of the rest.
    */
    if (holdUnplayed && target > reasoning.length) break;
    const offset = clamp(target, cursor, reasoning.length);
    if (offset > cursor) {
      pushReasoning(items, reasoning.slice(cursor, offset), cursor);
      cursor = offset;
    }
    items.push({ kind: 'tool', id: event.eventId, event });
  }
  if (cursor < reasoning.length) {
    pushReasoning(items, reasoning.slice(cursor), cursor);
  }
  return { items, interleaved: true };
}

/**
 * Append a reasoning segment.
 *
 * Pure whitespace does not become its own segment (that would leave an empty item on the timeline), and leading and trailing whitespace
 * inside the segment is removed too: a split segment often starts with a newline, and a 4-space indent on the first line would be treated as a code block by markdown.
 */
function pushReasoning(items: ProcessTimelineItem[], text: string, offset: number): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  items.push({ kind: 'reasoning', id: `reasoning:${offset}`, text: trimmed });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Build an index of sources by normalized URL, so a tool row can look up titles from citationUrls.
 * @param citations sources of the whole message
 * @returns normalized URL → source
 */
export function citationIndex(citations: Citation[]): Map<string, Citation> {
  return new Map(citations.map((citation) => [citationURLKey(citation.url), citation]));
}

/**
 * Take the sources to show on one tool row.
 *
 * A web_extractor event carries its own urls, so it can match exactly which pages it read; a web_search event gets no url from the backend
 * (only queries and result_count), so it falls back to the whole message's sources — they are equivalent for a single search,
 * and on several searches each row shows the same batch of icons, which is a known and acceptable approximation.
 *
 * @param event tool event
 * @param index index built by citationIndex
 * @param allCitations sources of the whole message, the fallback for web_search
 * @returns sources for this row; when no title matches, at least keep the address for the favicon
 */
export function toolRowCitations(
  event: ToolEvent,
  index: Map<string, Citation>,
  allCitations: Citation[],
): Citation[] {
  if (event.citationUrls?.length) {
    return event.citationUrls.map((url) => index.get(url) ?? { url });
  }
  return isSearchTool(event.tool) ? allCitations : [];
}

/**
 * Give an increasing entrance delay by index, and stop increasing once the tier cap is passed.
 * @param index element index
 * @returns an animationDelay that can be used directly in style
 */
export function staggerStyle(index: number): { animationDelay: string } {
  return { animationDelay: `${Math.min(index, STAGGER_MAX_STEPS) * STAGGER_STEP_MS}ms` };
}

/**
 * Class for the stagger entrance animation.
 * fill-mode-both must be included: otherwise the element shows its end state during the delay, then jumps back to the start when the animation actually begins,
 * and the "appearing one by one" look becomes "everything appears first, then flashes".
 */
export const STAGGER_CLASS_NAME =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-both';
