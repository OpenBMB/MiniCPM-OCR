import type { ToolStatusEvent } from '@/api/map/chat';

import type { ToolEvent, ToolEventStatus } from '../types';
import { citationURLKey, safeCitationHref } from './citations';

/** Maximum number of tool events kept for one answer, so an abnormal tool loop does not inflate the message body. */
export const MAX_TOOL_EVENTS = 32;

/** Maximum number of source URLs kept on one tool event, aligned with the display cap of stacked icons on the process row. */
export const MAX_EVENT_CITATION_URLS = 8;

/** Maximum number of queries kept on one tool event; an in-progress search row is only an in-place preview, not the full list. */
export const MAX_EVENT_QUERIES = 4;

/** Maximum number of queries listed on the top row: the collapsed state has only this row, and listing all of them would push "searching" itself out of view. */
const MAX_TITLE_QUERIES = 2;

/** Character cap for one query on the top row; the model occasionally stuffs a whole sentence into query. */
const MAX_TITLE_QUERY_CHARS = 14;

/**
 * Collapse urls from the backend into source addresses that can be stored.
 *
 * Keep only http(s) addresses that can be opened safely, and normalize them to the citationURLKey form — rendering joins
 * message.citations on that key to get the title, and a mismatched key never matches.
 *
 * @param urls raw addresses on the tool event
 * @returns deduped and truncated addresses; undefined when none remain (do not return an empty array; see the merge semantics of upsertToolEvent)
 */
function normalizeEventUrls(urls?: string[]): string[] | undefined {
  if (!urls?.length) return undefined;
  const keys = new Set<string>();
  for (const url of urls) {
    if (!safeCitationHref(url)) continue;
    keys.add(citationURLKey(url));
    if (keys.size >= MAX_EVENT_CITATION_URLS) break;
  }
  return keys.size > 0 ? [...keys] : undefined;
}

/**
 * Collapse queries: trim, dedupe, and truncate.
 *
 * @param queries raw queries on the tool event
 * @returns truncated queries; undefined when none remain (an empty array would "legally overwrite" the first frame's value)
 */
function normalizeEventQueries(queries?: string[]): string[] | undefined {
  if (!queries?.length) return undefined;
  const seen = new Set<string>();
  for (const query of queries) {
    const trimmed = query.trim();
    if (!trimmed) continue;
    seen.add(trimmed);
    if (seen.size >= MAX_EVENT_QUERIES) break;
  }
  return seen.size > 0 ? [...seen] : undefined;
}

/** Normalize a backend status into a tool-event status the frontend can render. */
function normalizeToolEventStatus(status?: string): ToolEventStatus {
  if (status === 'success' || status === 'failed' || status === 'interrupted') {
    return status;
  }
  return 'running';
}

/** Build a stable compatibility key for an old SSE event that has no event_id. */
export function toolEventKey(event: Pick<ToolStatusEvent, 'event_id' | 'step' | 'tool'>): string {
  if (event.event_id) return event.event_id;
  return `legacy:${event.step ?? 0}:${event.tool ?? 'unknown'}`;
}

/**
 * Turn one backend tool-status event into a frontend summary event.
 * @param event backend tool-status event
 * @param reasoningOffset reasoning character count already produced when this tool's first frame arrived, used as the process-timeline split point
 */
export function toToolEvent(event: ToolStatusEvent, reasoningOffset?: number): ToolEvent {
  const queryCount = event.queries?.length;
  const queries = normalizeEventQueries(event.queries);
  const pageCount = event.urls?.length;
  const citationUrls = normalizeEventUrls(event.urls);
  return {
    eventId: toolEventKey(event),
    step: event.step ?? 0,
    tool: event.tool ?? 'unknown',
    status: normalizeToolEventStatus(event.status),
    ...(queryCount !== undefined ? { queryCount } : {}),
    ...(queries ? { queries } : {}),
    ...(event.result_count !== undefined ? { resultCount: event.result_count } : {}),
    ...(pageCount !== undefined ? { pageCount } : {}),
    ...(event.duration_ms !== undefined ? { durationMs: event.duration_ms } : {}),
    ...(event.message ? { message: event.message } : {}),
    ...(citationUrls ? { citationUrls } : {}),
    ...(reasoningOffset !== undefined ? { reasoningOffset } : {}),
  };
}

/**
 * Append or merge a tool status into the event list.
 * @param events current event list
 * @param incoming backend tool-status event
 * @param reasoningOffset reasoning split point, used only the first time this event appears
 * @returns an event list that stays within the cap and keeps time order
 */
export function upsertToolEvent(
  events: ToolEvent[],
  incoming: ToolStatusEvent,
  reasoningOffset?: number,
): ToolEvent[] {
  const nextEvent = toToolEvent(incoming, reasoningOffset);
  const index = events.findIndex((event) => event.eventId === nextEvent.eventId);
  if (index < 0) {
    return [...events, nextEvent].slice(-MAX_TOOL_EVENTS);
  }

  const current = events[index];
  const merged: ToolEvent = {
    ...current,
    ...nextEvent,
    queryCount: nextEvent.queryCount ?? current.queryCount,
    queries: nextEvent.queries ?? current.queries,
    resultCount: nextEvent.resultCount ?? current.resultCount,
    pageCount: nextEvent.pageCount ?? current.pageCount,
    durationMs: nextEvent.durationMs ?? current.durationMs,
    message: nextEvent.message ?? current.message,
    // Addresses use "overwrite when present, keep when absent": both the running and success frames of web_extractor carry urls,
    // and normalizeEventUrls returns undefined when none remain, so it does not wipe the first frame's result with an empty value.
    citationUrls: nextEvent.citationUrls ?? current.citationUrls,
    // The split point must be anchored at the moment the tool "starts", so current wins: the success frame arrives seconds after the running frame,
    // and recomputing from it would place the reasoning that streamed in during that gap before the tool row.
    reasoningOffset: current.reasoningOffset ?? nextEvent.reasoningOffset,
  };
  const result = [...events];
  result[index] = merged;
  return result;
}

/**
 * Take the search queries currently in progress, for a live summary on the top row of the process area.
 *
 * The top row is the only progress channel present in the collapsed state, and one search takes several seconds to start. If it stayed a static "Searching" the whole time,
 * the user could not tell whether it was really running or stuck — the expanded tool row has long shown queries one by one (see RunningQueries
 * in ProcessToolRow), but while collapsed that information disappears entirely and only a spinner remains.
 *
 * Do not filter by tool name: only search tools carry queries (web_extractor's running frame carries urls),
 * so checking whether the field is present is enough, and this module does not have to depend back on answerTimeline's WEB_TOOLS.
 *
 * @param events current tool-event list
 * @returns queries with surrounding whitespace removed and truncated by length; an empty array when no search is in progress
 */
export function runningSearchQueries(events: ToolEvent[]): string[] {
  const queries: string[] = [];
  for (const event of events) {
    if (event.status !== 'running') continue;
    for (const query of event.queries ?? []) {
      const trimmed = query.trim();
      if (!trimmed) continue;
      queries.push(
        trimmed.length > MAX_TITLE_QUERY_CHARS
          ? `${trimmed.slice(0, MAX_TITLE_QUERY_CHARS)}…`
          : trimmed,
      );
      if (queries.length >= MAX_TITLE_QUERIES) return queries;
    }
  }
  return queries;
}

/** Settle events that are still running when the lifecycle ends to the given terminal state. */
export function finalizeToolEvents(
  events: ToolEvent[],
  status: Extract<ToolEventStatus, 'failed' | 'interrupted'>,
): ToolEvent[] {
  return events.map((event) => (event.status === 'running' ? { ...event, status } : event));
}
