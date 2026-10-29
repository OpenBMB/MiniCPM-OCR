/**
 * A single conversation message bubble.
 *
 * Purpose: user messages are a right-aligned solid bubble; assistant messages are left-aligned, top to bottom: process timeline (one disclosure where reasoning and tools interleave) + markdown body + source chip + streaming cursor + usage/error marks + action bar.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage, Citation, MessageFeedback } from '../types';
import { LazyMarkdownRenderer } from './MarkdownRenderer';
import { AnswerProcessTimeline } from './AnswerProcessTimeline';
import { SourcesChip } from './SourcesChip';
import { ImageLightbox } from './ImageLightbox';
import { AttachmentPreview } from './AttachmentPreview';
import { MessageMetrics } from './MessageMetrics';
import { MessageActions } from './MessageActions';
import { normalizeAssistantReply } from '../utils/thinkSplit';

interface MessageBubbleProps {
  message: ChatMessage;
  /** Regenerate this assistant message (truncate and resend) */
  onRegenerate?: (assistantId: string) => void;
  /** Toggle this assistant message's feedback state (up/down) */
  onFeedback?: (assistantId: string, kind: MessageFeedback) => void;
  /** Switch the answer version shown for this assistant message (‹n/N› paging) */
  onSwitchVersion?: (assistantId: string, index: number) => void;
  /** Whether generation is in progress (the regenerate button is disabled while generating) */
  loading?: boolean;
  /** Whether this is the last assistant message: only this one shows "regenerate," so resending a middle turn does not delete the conversation after it */
  isLastAssistant?: boolean;
  /** Whether the current model may show reasoning (when false, do not render the reasoning disclosure, including reasoning already stored on historical sessions) */
  showReasoning?: boolean;
  /**
   * Open the layout-level citation sidebar.
   * The third argument, activeUrl, is carried by a body-badge click so the panel scrolls to that item and highlights it; "view all" omits it, meaning only open the panel.
   */
  onOpenCitations?: (messageId: string, citations: Citation[], activeUrl?: string) => void;
  /** Whether this message is currently showing the citation sidebar. */
  citationsOpen?: boolean;
}

/**
 * Renders one message.
 * @param message Message data
 * @param onRegenerate Regenerate callback
 * @param onFeedback Feedback callback
 * @param onSwitchVersion Version-switch callback
 * @param loading Whether generation is in progress
 * @param isLastAssistant Whether this is the last assistant message
 * @param showReasoning Whether reasoning may be shown
 */
export function MessageBubble({
  message,
  onRegenerate,
  onFeedback,
  onSwitchVersion,
  loading,
  isLastAssistant,
  showReasoning = true,
  onOpenCitations,
  citationsOpen = false,
}: MessageBubbleProps) {
  const { t } = useTranslation('playground');
  // Image opened in the enlarge preview (inside a user message)
  const [preview, setPreview] = useState<string | null>(null);

  // Display-layer fallback: strip leftover inline think tags from the body and merge them into the reasoning disclosure
  const display = useMemo(
    () => normalizeAssistantReply(message.content, message.reasoning),
    [message.content, message.reasoning],
  );
  // Rewritten reasoning does not match the character offsets recorded on tool events, so the timeline falls back to "reasoning as one block on top"
  const reasoningRewritten = display.reasoning !== (message.reasoning ?? '');

  // Must be useCallback: this callback enters MarkdownRenderer's memo comparison and the components useMemo dependencies,
  // and a new one on every render re-parses the whole Markdown on every streaming frame.
  const activateCitation = useCallback(
    (citation: Citation) => {
      onOpenCitations?.(message.id, message.citations ?? [], citation.url);
    },
    [message.citations, message.id, onOpenCitations],
  );

  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {message.attachments && message.attachments.length > 0 && (
          <div className="max-w-[80%]">
            <AttachmentPreview
              attachments={message.attachments}
              align="end"
              onImageClick={setPreview}
            />
          </div>
        )}
        {message.content && (
          <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2.5 text-[14px] leading-6 text-primary-foreground">
            {message.content}
          </div>
        )}
        <ImageLightbox src={preview} onClose={() => setPreview(null)} />
      </div>
    );
  }

  // Waiting for the first increment: when a process area already exists (a web-search block or a reasoning block), it carries the status feedback, so a floating waiting dot is not repeated under it.
  const showCursor = message.streaming && !display.content && !display.reasoning;
  // Stay consistent with AnswerProcessTimeline's render condition: when the process area is present, it carries the waiting feedback
  const hasAnswerProcess = Boolean(
    (showReasoning && display.reasoning.trim()) ||
    message.toolEvents?.length ||
    (message.searching && message.streaming) ||
    message.searchStep === 'failed',
  );
  const citations = message.citations ?? [];

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[88%]">
        <AnswerProcessTimeline
          reasoning={display.reasoning}
          showReasoning={showReasoning}
          reasoningRewritten={reasoningRewritten}
          streaming={message.streaming}
          toolEvents={message.toolEvents}
          citations={message.citations}
          searching={message.searching}
          searchStep={message.searchStep}
          searchActiveTool={message.searchActiveTool}
          searchStatus={message.searchStatus}
          /* The search row in the process and the chip at the end of the answer lead to the same drawer; omitting activeUrl means only open the panel */
          onOpenSources={onOpenCitations ? () => onOpenCitations(message.id, citations) : undefined}
          hasAnswer={Boolean(display.content)}
        />

        {display.content && (
          <LazyMarkdownRenderer
            content={display.content}
            streaming={message.streaming}
            citations={message.citations}
            onCitationActivate={onOpenCitations ? activateCitation : undefined}
          />
        )}
        {!display.content && !hasAnswerProcess && showCursor && <ThinkingDots />}

        {/* Source chip: appear only after the body has landed, so streaming does not reflow repeatedly */}
        {!message.streaming && (
          <SourcesChip
            citations={citations}
            onOpen={onOpenCitations ? () => onOpenCitations(message.id, citations) : undefined}
            panelOpen={citationsOpen}
          />
        )}

        {message.errorCode === 'content_policy_violation' && (
          <LazyMarkdownRenderer content={message.error ?? ''} streaming={false} />
        )}

        {message.error && message.errorCode !== 'content_policy_violation' && (
          <div className="mt-2 max-w-full whitespace-pre-wrap break-words rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            {message.error}
          </div>
        )}

        {message.interrupted && (
          <div className="mt-2 text-xs text-muted-foreground">{t('answerInterrupted')}</div>
        )}

        {(message.usage || message.metrics) && !message.streaming && (
          <MessageMetrics metrics={message.metrics} usage={message.usage} />
        )}

        {/* Action bar: shown for a completed assistant message. On failure (error only, no body) keep only "regenerate."
            MessageActions decides from whether content is empty whether to render copy / thumbs-up / thumbs-down; multi-version messages show ‹n/N›. */}
        {!message.streaming &&
          !message.contextExcluded &&
          (display.content || message.error || message.interrupted) &&
          onRegenerate &&
          onFeedback && (
            <MessageActions
              content={display.content}
              feedback={message.feedback}
              showRegenerate={isLastAssistant}
              disableRegenerate={loading}
              onRegenerate={() => onRegenerate(message.id)}
              onFeedback={(kind) => onFeedback(message.id, kind)}
              versionCount={message.versions?.length}
              activeVersion={message.activeVersion}
              onSwitchVersion={onSwitchVersion ? (i) => onSwitchVersion(message.id, i) : undefined}
            />
          )}
      </div>
    </div>
  );
}

/** "Generating" animation while waiting for the first increment */
function ThinkingDots() {
  const { t } = useTranslation('playground');
  return (
    <div className="flex items-center gap-1 py-2" aria-label={t('generating')}>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}
