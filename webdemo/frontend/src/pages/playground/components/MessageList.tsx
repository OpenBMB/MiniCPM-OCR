/**
 * Message-stream container.
 *
 * Purpose: render the message-bubble list and stick to the bottom (scroll to the bottom on streaming increments; stop sticking when the user scrolls up to read). Use a native scroll container (rather than OverlayScrollArea) so useAutoScroll can control scrollTop directly.
 */

import { useAutoScroll } from '../hooks/useAutoScroll';
import { useTranslation } from 'react-i18next';
import type { ChatMessage, Citation, MessageFeedback } from '../types';
import { MessageBubble } from './MessageBubble';

interface MessageListProps {
  messages: ChatMessage[];
  /** Regenerate an assistant message */
  onRegenerate?: (assistantId: string) => void;
  /** Toggle an assistant message's feedback state */
  onFeedback?: (assistantId: string, kind: MessageFeedback) => void;
  /** Switch the answer version shown for an assistant message */
  onSwitchVersion?: (assistantId: string, index: number) => void;
  /** Whether generation is in progress (passed through to the action bar to disable regenerate) */
  loading?: boolean;
  /** Whether the current model may show reasoning (when false, do not render any message's reasoning area, including historical sessions) */
  showReasoning?: boolean;
  /** Open the layout-level citation sidebar. */
  onOpenCitations?: (messageId: string, citations: Citation[], activeUrl?: string) => void;
  /** ID of the message currently showing the citation sidebar. */
  openCitationsMessageId?: string;
}

/**
 * Scrolling message stream.
 * @param messages Message list
 * @param onRegenerate Regenerate callback
 * @param onFeedback Feedback callback
 * @param onSwitchVersion Version-switch callback
 * @param loading Whether generation is in progress
 * @param showReasoning Whether reasoning may be shown
 */
export function MessageList({
  messages,
  onRegenerate,
  onFeedback,
  onSwitchVersion,
  loading,
  showReasoning = true,
  onOpenCitations,
  openCitationsMessageId,
}: MessageListProps) {
  const { t } = useTranslation('playground');
  // Tool status and citations also change message height; the content container's ResizeObserver covers async layout changes.
  const last = messages[messages.length - 1];
  const updateKey = [
    messages.length,
    last?.content.length ?? 0,
    last?.reasoning?.length ?? 0,
    last?.searchStep ?? '',
    last?.searchResultCount ?? '',
    last?.searchActiveTool ?? '',
    last?.searchBrowseCount ?? '',
    last?.searchQueries?.join('|') ?? '',
    last?.searchTools?.join('|') ?? '',
    last?.searchStatus ?? '',
    last?.citations?.length ?? 0,
    last?.error?.length ?? 0,
    last?.streaming ? 'streaming' : 'idle',
  ].join(':');

  // The last assistant message is for the action bar; the last user message is the "new turn" marker that resets scrolling.
  let lastAssistantId: string | undefined;
  let lastUserId: string | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!lastAssistantId && messages[i].role === 'assistant' && !messages[i].divider) {
      lastAssistantId = messages[i].id;
    }
    if (!lastUserId && messages[i].role === 'user' && !messages[i].divider) {
      lastUserId = messages[i].id;
    }
    if (lastAssistantId && lastUserId) break;
  }
  const { scrollRef, contentRef, onScroll, onWheel, onTouchMove, onKeyDown, onPointerDown } =
    useAutoScroll(updateKey, lastUserId ?? last?.id ?? 'empty');

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      onWheel={onWheel}
      onTouchMove={onTouchMove}
      onKeyDown={onKeyDown}
      /* Height changes caused by clicks (expanding reasoning, switching versions) do not stick to the bottom; see the note in useAutoScroll */
      onPointerDown={onPointerDown}
      className="h-full overflow-y-auto"
    >
      <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        {messages.map((m) =>
          m.divider ? (
            <ContextDivider key={m.id} label={t('contextCleared')} />
          ) : (
            <MessageBubble
              key={m.id}
              message={m}
              onRegenerate={onRegenerate}
              onFeedback={onFeedback}
              onSwitchVersion={onSwitchVersion}
              loading={loading}
              isLastAssistant={m.id === lastAssistantId}
              showReasoning={showReasoning}
              onOpenCitations={onOpenCitations}
              citationsOpen={m.id === openCitationsMessageId}
            />
          ),
        )}
      </div>
    </div>
  );
}

/** Context divider: a horizontal rule with centered "context cleared" copy, marking that conversation after this no longer carries the history above it */
function ContextDivider({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-3 py-1 text-[11px] text-muted-foreground/60"
      role="separator"
    >
      <span className="h-px flex-1 bg-border" />
      <span className="shrink-0">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
