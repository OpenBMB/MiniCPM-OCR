/**
 * Playground streaming SSE callback set.
 *
 * Purpose: fold the six incremental streams content/reasoning/citations/usage/tool_status/done into patches on
 * `setMessages`, and hold the streaming-local state for one completion (playback queue, whether a tool is running,
 * reasoning split cursor). Kept apart from the pure list transforms in chatCompletion.ts: that side is stateless finalization,
 * this side is a factory with a lifecycle. Putting them together would push the util file past the 300-line cap.
 */

import type { Dispatch, SetStateAction } from 'react';
import type { Citation, StreamCallbacks, TokenUsage, ToolStatusEvent } from '@/api/map/chat';
import type { ChatMessage, Translate } from '../types';
import { isReaderTool } from './answerTimeline';
import { appendToMessage } from './messages';
import { toolStatusStep, toolStatusText } from './chatStatus';
import { createStreamTextQueue, type StreamTextKind } from './streamTextQueue';
import { upsertToolEvent } from './toolEvents';

/** Arguments to createStreamCallbacks */
export interface StreamCallbackContext {
  assistantId: string;
  /** Whether this is a web-search stream; an ordinary streaming answer must not show the search process bar. */
  webSearch: boolean;
  /** i18n translate function (playground namespace), used for tool progress copy. */
  t: Translate;
  isActive: () => boolean;
  markFirstToken: () => void;
  onDone: () => void;
  onRequestId: (requestId: string) => void;
  onModerationAnswer?: () => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}

export type StreamCallbacksController = StreamCallbacks & {
  cancel: () => void;
};

/**
 * Build the streaming SSE callback set (content/reasoning/citations/usage/tool_status/done).
 * @param ctx assistantId, first-token metric, completion callback, and setMessages
 */
export function createStreamCallbacks(ctx: StreamCallbackContext): StreamCallbacksController {
  const {
    assistantId,
    webSearch,
    t,
    isActive,
    markFirstToken,
    onDone,
    onRequestId,
    onModerationAnswer,
    setMessages,
  } = ctx;
  // Track whether a tool is still running (running status). Content deltas must not clear searching while it is running,
  // or the queue's text flush would wrongly collapse the open panel when a content delta arrives.
  let toolRunningRef = false;
  /*
    Reasoning split cursor: when the first tool frame arrives, anchor it on the event. The process timeline uses it to cut the reasoning blob into
    one interleaved line of reasoning → tool → reasoning.

    It must be accumulated inside the onReasoning callback, not by reading prev.reasoning?.length: reasoning increments pass through
    createStreamTextQueue's 16ms throttle, while onToolStatus calls setMessages immediately. Reading prev would see a length that lags
    the real progress, and split points would systematically sit too early. What is accumulated here is the "total already enqueued", strictly in SSE arrival
    order, unaffected by the playback queue.

    The render side absorbs this running ahead: onToolStatus does not go through the playback queue, so a tool event arrives a few hundred milliseconds before the reasoning above it
    finishes "playing"; buildProcessTimeline's holdUnplayed therefore holds back tool rows whose split point has not been played yet.
    Do not also enqueue tool events on that same queue — that would delay status feedback such as searching as a whole.
  */
  let enqueuedReasoningChars = 0;
  const queue = createStreamTextQueue((kind: StreamTextKind, delta: string) => {
    if (!isActive()) return;
    markFirstToken();
    const deltaPatch = kind === 'content' ? { contentDelta: delta } : { reasoningDelta: delta };
    // Only let the text flush clear searching once the tool has finished (not running);
    // while a tool is running, searching is owned entirely by onToolStatus.
    // Do not also require "there was tool activity": if web search is on but the model never calls a tool, searching must be cleared as soon as the body starts,
    // or the progress card keeps spinning until the stream ends.
    const progressPatch = webSearch && !toolRunningRef ? { searching: false } : {};
    setMessages((prev) => appendToMessage(prev, assistantId, { ...deltaPatch, ...progressPatch }));
  });

  return {
    onContent: (delta: string) => {
      if (!isActive()) return;
      queue.enqueue('content', delta);
    },
    onReasoning: (delta: string) => {
      if (!isActive()) return;
      enqueuedReasoningChars += delta.length;
      queue.enqueue('reasoning', delta);
    },
    onCitations: (citations: Citation[]) => {
      if (!isActive()) return;
      setMessages((prev) => appendToMessage(prev, assistantId, { citationsDelta: citations }));
    },
    onUsage: (usage: TokenUsage) => {
      if (!isActive()) return;
      setMessages((prev) => appendToMessage(prev, assistantId, { usage }));
    },
    onToolStatus: (status: ToolStatusEvent) => {
      if (!isActive()) return;
      toolRunningRef = status.status === 'running';
      // Treat "reading a page" by tool name only: counting any tool that carries urls as a page read would misreport any future tool that happens to include an address.
      const readingPages = isReaderTool(status.tool);
      const resultCount =
        status.result_count !== undefined ? status.result_count : status.urls?.length;
      setMessages((prev) =>
        appendToMessage(prev, assistantId, {
          searching: status.status === 'running',
          searchStep: toolStatusStep(status),
          searchStatus: toolStatusText(status, t),
          ...(status.tool ? { searchActiveTool: status.tool } : {}),
          ...(status.queries?.length ? { searchQueriesDelta: status.queries } : {}),
          ...(status.tool ? { searchToolsDelta: [status.tool] } : {}),
          toolEvents: upsertToolEvent(
            prevToolEvents(prev, assistantId) ?? [],
            status,
            enqueuedReasoningChars,
          ),
          ...(readingPages && resultCount !== undefined ? { searchBrowseCount: resultCount } : {}),
          ...(!readingPages && status.result_count !== undefined
            ? { searchResultCount: status.result_count }
            : {}),
        }),
      );
    },
    onRequestId: (requestId: string) => {
      if (!isActive()) return;
      onRequestId(requestId);
    },
    onModerationAnswer: () => {
      if (!isActive()) return;
      onModerationAnswer?.();
    },
    onDone: () => {
      if (!isActive()) return;
      queue.finish(onDone);
    },
    cancel: () => queue.cancel(),
  };
}

/** Read the current tool events for a given assistant, reused by functional state updates. */
function prevToolEvents(list: ChatMessage[], assistantId: string): ChatMessage['toolEvents'] {
  return list.find((message) => message.id === assistantId)?.toolEvents;
}
