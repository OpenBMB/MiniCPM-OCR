/**
 * One tool call on the process timeline.
 *
 * Purpose: turn a tool row from a "metadata list" into a "content row" — a search row reports how many pages were found and stacks site icons, a page-read row lists which pages were read in place, and while in progress it shows what is being searched in place. Per-step duration and keyword counts are never shown: they have no decision value for the user, and duration is reported once as a total at the top of the process area.
 */

import { useTranslation } from 'react-i18next';
import { BookOpen, CircleAlert, Clock, Search, Wrench } from 'lucide-react';

import { cn } from '@map/ui';

import type { Citation, ToolEvent } from '../types';
import {
  STAGGER_CLASS_NAME,
  isReaderTool,
  isSearchTool,
  staggerStyle,
} from '../utils/answerTimeline';
import { ProcessRailItem } from './AnswerProcessSteps';
import { InlineSourceLinks } from './InlineSourceLinks';
import { StackedFavicons } from './StackedFavicons';

interface ProcessToolRowProps {
  /** This tool call. */
  event: ToolEvent;
  /** Sources this row should show in place (already resolved by toolRowCitations). */
  citations: Citation[];
  /** Open the source drawer; only when provided is the search row's whole "found N pages + site icons" block made clickable. */
  onOpenSources?: () => void;
  /** Whether this is the last item on the timeline. */
  last?: boolean;
}

/**
 * Renders one tool row.
 * @param event Tool event
 * @param citations Sources for this row
 * @param onOpenSources Open the source drawer
 * @param last Whether this is the last item on the timeline
 * @returns A tool row
 */
export function ProcessToolRow({
  event,
  citations,
  onOpenSources,
  last = false,
}: ProcessToolRowProps) {
  const { t } = useTranslation('playground');
  const failed = event.status === 'failed';
  const running = event.status === 'running';
  const label = toolLabel(event, citations, t);
  // The row for a finished search: copy and icons form one entry to the source drawer
  const searchDone = isSearchTool(event.tool) && !running && !failed;

  return (
    <ProcessRailItem
      marker={<ToolMarker event={event} />}
      last={last}
      tone={failed ? 'destructive' : 'default'}
    >
      <span className="break-words">
        {searchDone ? (
          <SourcesTrigger label={label} citations={citations} onOpen={onOpenSources} />
        ) : (
          label
        )}
        {running && event.queries?.length ? <RunningQueries queries={event.queries} /> : null}
        {isReaderTool(event.tool) ? (
          <InlineSourceLinks
            citations={citations}
            linkLabel={(title) => `${title}，${t('openSource')}`}
            overflowLabel={(count) => t('moreSources', { count })}
          />
        ) : null}
      </span>
      {failed && event.message ? (
        <span className="mt-0.5 block break-words text-xs leading-5">{event.message}</span>
      ) : null}
    </ProcessRailItem>
  );
}

/**
 * Clickable region of a search row: the main copy plus the stack of site icons, as one block leading to the source drawer.
 *
 * This row is already a summary of "the pages this step touched," and clicking it to see which pages is the shortest path — otherwise the user has to ignore the stack of icons in front of them and then scroll to the end of the answer to find the chip. When there are no sources or the parent did not pass a callback, fall back to plain text, and do not make a button that does nothing when clicked.
 */
function SourcesTrigger({
  label,
  citations,
  onOpen,
}: {
  label: string;
  citations: Citation[];
  onOpen?: () => void;
}) {
  const { t } = useTranslation('playground');
  const stack = <StackedFavicons citations={citations} className="ml-2" />;
  if (!onOpen || citations.length === 0) {
    return (
      <>
        {label}
        {stack}
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      /* The icon is aria-hidden decoration; a readable name can come only from the copy, plus one phrase about where it goes */
      aria-label={`${label}，${t('openReferences')}`}
      data-testid="tool-row-sources"
      className={cn(
        '-mx-1 -my-0.5 inline-flex max-w-full items-center rounded px-1 py-0.5 text-left align-middle',
        'transition-colors duration-200',
        /*
          Hover only darkens the text and does not paint a background: this row is a stretch of inline text in the timeline, and giving it a fill would add a square from nowhere beside the marker column, reading "a line" as "a card." Raising the text from muted to foreground is enough to show it is clickable. The negative margin and px/py stay to make room for the focus ring.
        */
        'hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
    >
      <span className="truncate">{label}</span>
      {stack}
    </button>
  );
}

/** In-progress search terms: fade in one by one right after the main copy, and after completion are replaced by "found N pages." */
function RunningQueries({ queries }: { queries: string[] }) {
  return (
    <span className="text-foreground/70">
      {queries.map((query, index) => (
        <span
          key={query}
          style={staggerStyle(index)}
          className={cn(STAGGER_CLASS_NAME, 'ml-2 inline-block max-w-48 truncate align-bottom')}
        >
          {query}
        </span>
      ))}
    </span>
  );
}

/**
 * Tool-row marker: a failure alert, otherwise a fixed icon by tool meaning.
 *
 * While in progress it **does not spin**. Spinning is left to the one icon on the process-area top row: the top row is present even when collapsed, and there is still a gap between turning web search on and the first tool frame arriving when the timeline is empty, so the motion has to be carried there. Spinning in both places reports the same thing twice, and spinning independently is more confusing. The in-progress row is distinguished by copy — `search <keyword>` versus `found N pages` — so the icon stays the same from "in progress → done" and does not change shape at the moment it finishes.
 */
function ToolMarker({ event }: { event: ToolEvent }) {
  if (event.status === 'failed') {
    return <CircleAlert className="size-4 text-destructive" aria-hidden="true" />;
  }
  if (event.status === 'interrupted') {
    return <CircleAlert className="size-4 text-muted-foreground/60" aria-hidden="true" />;
  }
  // Color this in-progress row with primary, so "which step is running now" is still obvious at a glance
  const className =
    event.status === 'running' ? 'size-4 text-primary' : 'size-4 text-muted-foreground/70';
  if (isSearchTool(event.tool)) return <Search className={className} aria-hidden="true" />;
  if (isReaderTool(event.tool)) return <BookOpen className={className} aria-hidden="true" />;
  if (event.tool === 'datetime') return <Clock className={className} aria-hidden="true" />;
  return <Wrench className={className} aria-hidden="true" />;
}

/**
 * Builds the main copy of a tool row.
 *
 * The finished state prefers to report "how many results" rather than the tool name: the user cares how many were found or read, not which function was called. When the count is unavailable (old messages, the backend did not send a count), fall back to the tool name and do not invent a number.
 *
 * @param event Tool event
 * @param citations Sources for this row, used as a count fallback
 * @param t i18n translate function
 * @returns Main copy
 */
function toolLabel(
  event: ToolEvent,
  citations: Citation[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (isSearchTool(event.tool)) {
    if (event.status === 'running') return t('toolEventSearch');
    const count = event.resultCount ?? citations.length;
    return count > 0 ? t('searchedPages', { count }) : t('toolEventSearch');
  }
  if (isReaderTool(event.tool)) {
    if (event.status === 'running') return t('toolEventRead');
    const count = event.pageCount ?? citations.length;
    return count > 0 ? t('browsedPages', { count }) : t('toolEventRead');
  }
  if (event.tool === 'datetime') return t('toolEventDatetime');
  return event.tool;
}
