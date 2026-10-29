/**
 * Answer-process timeline.
 *
 * Purpose: restore one answer's whole process — reasoning, web search, reading pages, checking the time — as **one** interleaved timeline. The model's real execution is a single flow of "reason → call a tool → keep reasoning," so the UI gives only one disclosure: the top row reports "reasoned (N seconds)," and when expanded the reasoning segments and tool rows interleave in occurrence order on the same marker column.
 *
 * Sources are not closed out here: the source chip under the body is the single path to the source drawer, and the top row is no longer a second jump target.
 */

import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, CircleAlert, LoaderCircle } from 'lucide-react';

import { cn } from '@map/ui';

import type { Citation, SearchProgressStep, ToolEvent } from '../types';
import { useAnswerProcessDisclosure } from '../hooks/useAnswerProcessDisclosure';
import {
  WEB_TOOLS,
  buildProcessTimeline,
  citationIndex,
  isSearchTool,
  toolRowCitations,
} from '../utils/answerTimeline';
import { runningSearchQueries } from '../utils/toolEvents';
import { ProcessBullet, ProcessRailItem } from './AnswerProcessSteps';
import { ProcessDisclosure, ProcessScrollArea, ReasoningSegment } from './AnswerProcessDisclosure';
import { ProcessToolRow } from './ProcessToolRow';

interface AnswerProcessTimelineProps {
  /** Model reasoning content (already rewritten by the display layer). */
  reasoning: string;
  /** Whether the current model is allowed to show reasoning content. */
  showReasoning?: boolean;
  /** Whether the display layer rewrote the reasoning text; if it did, interleaving is impossible and reasoning falls back to one block on top. */
  reasoningRewritten?: boolean;
  /** Whether generation is still streaming. */
  streaming?: boolean;
  /** All tool-call events for this turn, in arrival order. */
  toolEvents?: ToolEvent[];
  /** Sources for the whole message, so a tool row can show site icons and page titles in place. */
  citations?: Citation[];
  /** Whether web search is on but there are still no tool events (the gap before the first frame). */
  searching?: boolean;
  /** Process phase from the backend; a failure state may arrive before tool events. */
  searchStep?: SearchProgressStep;
  /** Name of the most recently run tool, used to attribute a failure. */
  searchActiveTool?: string;
  /** Failure reason from the backend; used directly as the title in the failure state. */
  searchStatus?: string;
  /** Opens the source drawer; only when provided is the search row made clickable. */
  onOpenSources?: () => void;
  /** Whether answer body text already exists, used to draw the separator between process and answer. */
  hasAnswer?: boolean;
}

/**
 * Renders the process timeline for an answer.
 * @param props Reasoning content, tool events, sources, and streaming state
 * @returns A collapsible process timeline; renders nothing when there is no process data
 */
export function AnswerProcessTimeline({
  reasoning,
  showReasoning = true,
  reasoningRewritten = false,
  streaming = false,
  toolEvents = [],
  citations = [],
  searching = false,
  searchStep,
  searchActiveTool,
  searchStatus,
  onOpenSources,
  hasAnswer = false,
}: AnswerProcessTimelineProps) {
  const { t } = useTranslation('playground');
  const panelId = useId();

  /*
    What is handed to the timeline is the **untrimmed original**: a tool event's reasoningOffset is accumulated in original characters, and trimming before cutting by offset shifts everything — the model usually leaves a newline before calling a tool, and after trim the displayed length is shorter than the offset, so the "wait until playback reaches it before showing the row" check never arrives. Whitespace inside a segment is cleaned up segment by segment in buildProcessTimeline.
  */
  const rawReasoning = showReasoning ? reasoning : '';
  const hasReasoning = Boolean(rawReasoning.trim());
  const failedEvents = toolEvents.filter((event) => event.status === 'failed');
  /*
    Only a web-search tool failure turns the whole row red and replaces the title with the failure reason. A tool such as datetime failing is just one sub-step inside reasoning that did not succeed; the answer itself is still generated — marking the whole thing red makes users think the entire answer is untrustworthy.

    searchStep / searchActiveTool are fields shared by every tool. A failure frame may arrive before tool events (and when web search fails the moment it is turned on there are no tool events at all, so it still has to count toward hasProcess). Attribute the failure to the most recent tool; otherwise "time lookup failed" is reported as "web search failed."
  */
  const stepFailedIsWeb =
    searchStep === 'failed' && (!searchActiveTool || WEB_TOOLS.has(searchActiveTool));
  const webFailed = stepFailedIsWeb || failedEvents.some((event) => WEB_TOOLS.has(event.tool));
  const anyFailed = webFailed || failedEvents.length > 0;
  const interrupted = toolEvents.some((event) => event.status === 'interrupted');
  // Once a failure is reported, stop spinning: after the failure frame arrives, searching is often still set, and the icon would spin forever
  const running =
    !webFailed &&
    (toolEvents.some((event) => event.status === 'running') || (searching && streaming));
  const webRunning =
    toolEvents.some((event) => event.status === 'running' && WEB_TOOLS.has(event.tool)) ||
    (searching && streaming && !toolEvents.some((event) => event.status === 'running'));
  /*
    Whether this turn actually retrieved evidence from the web. The criterion is "a successful web-search tool call," not "the web-search switch is on": the switch only means the user allowed web search. The model may decide it is unnecessary and never call it. That answer is no different from reasoning alone, yet it would be labeled "searched the web" — worse than no label, because users would think the answer has external evidence.
  */
  const webSearched = toolEvents.some(
    (event) => WEB_TOOLS.has(event.tool) && event.status === 'success',
  );
  const webSearchCount = toolEvents.filter(
    (event) => isSearchTool(event.tool) && event.status === 'success',
  ).length;
  const hasProcess = hasReasoning || toolEvents.length > 0 || (searching && streaming) || webFailed;

  const timeline = useMemo(
    () =>
      buildProcessTimeline({
        reasoning: rawReasoning,
        toolEvents,
        reasoningRewritten,
        holdUnplayed: streaming,
      }),
    [rawReasoning, toolEvents, reasoningRewritten, streaming],
  );
  const index = useMemo(() => citationIndex(citations), [citations]);
  /*
    Do not draw a bullet when the whole process is a single reasoning segment and no other row will grow. The marker column exists to align multiple rows into a line; with one row left it degrades into a "bullet for a single element" — nothing below to align to, no connector to hang, only a dot pointing at empty space.

    The criterion includes toolEvents / searching: during streaming a tool row may be held by the playback queue (see holdUnplayed in buildProcessTimeline). items has only one entry at that moment, but the row is about to appear — deciding by the current count makes the dot pop in once from nowhere.

    Keep the column width (pass null for the marker, rather than bypassing ProcessRailItem): the body must stay left-aligned with the top-row title. Removing the column shifts the whole block left into the icon column, so it reads as a peer of the top row rather than content the top row expanded.
  */
  const soleReasoning =
    timeline.items.length === 1 &&
    timeline.items[0]?.kind === 'reasoning' &&
    toolEvents.length === 0 &&
    !(searching && streaming);

  const disclosure = useAnswerProcessDisclosure({
    streaming,
    hasProcess,
    failed: anyFailed || interrupted,
  });

  if (!hasProcess) return null;

  const title = timelineTitle({
    t,
    webFailed,
    searchStatus,
    running,
    webRunning,
    streaming,
    hasReasoning,
    webSearched,
    toolCount: toolEvents.length,
    webSearchCount,
    searchQueries: runningSearchQueries(toolEvents),
  });

  return (
    <section
      className={cn('relative mb-2', hasAnswer && 'pb-0.5')}
      aria-label={title}
      aria-live={streaming || anyFailed ? 'polite' : undefined}
      aria-busy={streaming || undefined}
    >
      <ProcessDisclosure
        id={panelId}
        expanded={disclosure.expanded}
        title={title}
        icon={
          <TimelineIcon
            running={running || streaming}
            failed={anyFailed}
            tone={webFailed ? 'destructive' : 'muted'}
          />
        }
        failed={webFailed}
        onToggle={disclosure.toggle}
      >
        <ProcessScrollArea
          expanded={disclosure.expanded}
          streaming={streaming}
          watch={`${rawReasoning.length}:${timeline.items.length}`}
          follow={disclosure.follow}
        >
          <ol>
            {timeline.items.map((item, itemIndex) => {
              const last = itemIndex === timeline.items.length - 1;
              if (item.kind === 'reasoning') {
                return (
                  <ProcessRailItem
                    key={item.id}
                    marker={soleReasoning ? null : <ProcessBullet />}
                    last={last}
                  >
                    <ReasoningSegment
                      reasoning={item.text}
                      streaming={streaming}
                      citations={citations}
                    />
                  </ProcessRailItem>
                );
              }
              return (
                <ProcessToolRow
                  key={item.id}
                  event={item.event}
                  citations={toolRowCitations(item.event, index, citations)}
                  onOpenSources={onOpenSources}
                  last={last}
                />
              );
            })}
          </ol>
        </ProcessScrollArea>
      </ProcessDisclosure>
    </section>
  );
}

/**
 * Top-row icon.
 *
 * It is colored separately from the title: the title is a muted status note, and the icon uses primary to mark "a process happened here" — if the whole row goes gray, the process area disappears from view while collapsed.
 *
 * Only this one spins: the top row is present even when collapsed, and there is a gap between "web search turned on" and "the first tool frame arrives" when the timeline is empty, so the motion has to be carried here. Tool rows therefore do not spin (see ProcessToolRow.ToolMarker). Spinning in both places reports the same thing twice, and spinning independently is more confusing.
 *
 * The finished state does not swap the icon based on "whether web search happened": a different icon on every top row in a column of answers turns the stack into colored noise and is harder to scan. Whether web search happened is distinguished by the title text (see timelineTitle), which is content on that same row that has to be read anyway, so it does not need another visual channel.
 */
function TimelineIcon({
  running,
  failed,
  tone,
}: {
  running: boolean;
  failed: boolean;
  tone: 'destructive' | 'muted';
}) {
  if (failed) {
    return (
      <CircleAlert
        className={cn(
          'size-4 shrink-0',
          tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
        )}
        aria-hidden="true"
      />
    );
  }
  if (running) {
    return (
      <LoaderCircle
        className="size-4 shrink-0 text-primary motion-safe:animate-spin"
        aria-hidden="true"
      />
    );
  }
  return <Brain className="size-4 shrink-0 text-primary" aria-hidden="true" />;
}

/**
 * Builds the top-row title.
 *
 * The finished state only reports "what was done," without duration: total duration already appears in the metrics row under the body (see utils/metrics.ts). Reporting it again on the top row puts the same number in two places, and it is the only text on that row that changes, so the eye reads the number first and covers "what was done." The total tool count is omitted for the same reason; but when successful searches exceed one, report the search count so the user can tell how many rounds of evidence the model took without expanding. A single search does not need a redundant "1 time."
 *
 * In-progress web search is the opposite: the top row should carry the current query. In this phase it is the only text that changes, and that is what is needed — a search round starts at several seconds, and while collapsed there is no progress channel besides the top row. Static copy sitting there cannot be told apart from a hang. The finished state avoids "the only number that changes" because there is no progress left then; the two do not conflict.
 *
 * Web search and reasoning-only must be reported separately. This is not a wording preference: reasoning-only means the model answered from knowledge in its weights, while web search means it actually fetched external evidence. Their sources of trust differ. Writing both as "reasoned" leaves the user unable to judge whether to check the answer again — which is exactly why they look at the process area.
 *
 * @param searchQueries In-progress search queries (already truncated); an empty array means they have not arrived yet
 * @returns Top-row title copy
 */
function timelineTitle({
  t,
  webFailed,
  searchStatus,
  running,
  webRunning,
  streaming,
  hasReasoning,
  webSearched,
  webSearchCount,
  toolCount,
  searchQueries,
}: {
  t: (key: string, options?: Record<string, unknown>) => string;
  webFailed: boolean;
  searchStatus?: string;
  running: boolean;
  webRunning: boolean;
  streaming: boolean;
  hasReasoning: boolean;
  webSearched: boolean;
  webSearchCount: number;
  toolCount: number;
  searchQueries: string[];
}): string {
  if (webFailed) return searchStatus || t('searchStepFailed');
  if (running) {
    if (!webRunning) return t('toolsInProgress');
    // The query arrives with the running frame only after the model finishes generating tool_call arguments; before that, only static copy can be shown.
    if (searchQueries.length === 0) return t('searchingPages');
    return t('searchingPagesQuery', { query: searchQueries.join(t('queryJoiner')) });
  }
  if (streaming) return t('reasoningInProgress');
  if (webSearched) {
    // Report the count for multi-round search; keep the original copy for a single round so the collapsed state is not taken up by an uninformative "1 time."
    if (webSearchCount > 1) {
      return t(hasReasoning ? 'searchedAndReasonedCount' : 'searchedCompleteCount', {
        count: webSearchCount,
      });
    }
    // If web search ran but there was no reasoning (reasoning depth off), still report web search: the evidence source is more worth keeping in the collapsed state than "reasoned."
    return t(hasReasoning ? 'searchedAndReasoned' : 'searchedComplete');
  }
  if (hasReasoning) return t('reasoningComplete');
  return t('processUsingTools', { count: toolCount });
}
