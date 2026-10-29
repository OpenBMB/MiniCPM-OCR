/**
 * Hook that orchestrates conversation feedback in the experience center.
 *
 * Purpose: collapse "a like reports silently / a dislike opens a dialog to pick a reason and then reports / local highlight-state toggle" into one place, and feed the page.
 * Local highlight state is still held by useChat.setFeedback (immediate feedback); this hook is responsible for reporting to the backend and for dislike-dialog state.
 * No JSX. Reporting is fire-and-forget: failure only toasts, and does not roll back the local highlight (a simple ledger-style handling).
 */

import { useCallback, useState } from 'react';
import { useToast } from '@map/ui';
import { useTranslation } from 'react-i18next';
import { useSubmitFeedbackMutation } from '@/api/map';
import type { MessageFeedback, ChatMessage } from '../types';
import { findQAPair } from '../utils/messages';

interface FeedbackSnapshot {
  assistantId: string;
  conversationId?: string;
  requestId?: string;
  clientRequestId?: string;
  apiKeyId?: string;
  publicModel: string;
  question: string;
  answer: string;
}

interface Args {
  /** Current message list (used to take the question-answer snapshot) */
  messages: ChatMessage[];
  /** Current model id (= public_model) */
  model: string;
  /** Current conversation id (undefined when a new conversation has not been saved) */
  conversationId?: string;
  /** Toggle the local highlight state (like/dislike are exclusive; clicking again clears it) */
  setLocalFeedback: (assistantId: string, kind: MessageFeedback) => void;
}

interface Return {
  /** Click like or dislike: a like reports directly, and a dislike opens the dialog */
  onFeedback: (assistantId: string, kind: MessageFeedback) => void;
  /** Whether the dislike dialog is open */
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  /** Reporting in progress */
  submitting: boolean;
  /** Submit the dislike dialog (with a reason and body) */
  submitDown: (payload: { reasons: string[]; comment: string }) => void;
}

export function useMessageFeedback(args: Args): Return {
  const { messages, model, conversationId, setLocalFeedback } = args;
  const { toast } = useToast();
  const { t } = useTranslation('playground');
  const submitMut = useSubmitFeedbackMutation();
  const [dialogOpen, setDialogOpen] = useState(false);
  // Feedback snapshot of a dislike waiting to be submitted: the conversation or version may switch while the dialog is open, so submit must use the question, answer, and ownership from the moment of the click.
  const [pending, setPending] = useState<FeedbackSnapshot | null>(null);

  const makeSnapshot = useCallback(
    (assistantId: string): FeedbackSnapshot => {
      const { question, answer, requestId, clientRequestId, apiKeyId } = findQAPair(
        messages,
        assistantId,
      );
      return {
        assistantId,
        conversationId,
        requestId,
        clientRequestId,
        apiKeyId,
        publicModel: model,
        question,
        answer,
      };
    },
    [messages, model, conversationId],
  );

  const report = useCallback(
    (snapshot: FeedbackSnapshot, kind: MessageFeedback, reasons: string[], comment: string) => {
      submitMut.mutate(
        {
          conversation_id: snapshot.conversationId,
          ...(snapshot.requestId ? { request_id: snapshot.requestId } : {}),
          ...(snapshot.clientRequestId ? { client_request_id: snapshot.clientRequestId } : {}),
          ...(snapshot.apiKeyId ? { api_key_id: snapshot.apiKeyId } : {}),
          public_model: snapshot.publicModel,
          feedback_type: kind,
          reasons,
          comment: comment || undefined,
          question: snapshot.question,
          answer: snapshot.answer,
        },
        {
          onSuccess: () => toast({ title: t('thanksForFeedback') }),
          onError: () => toast({ title: t('feedbackSubmitFailed'), variant: 'error' }),
        },
      );
    },
    [submitMut, t, toast],
  );

  const changeDialogOpen = useCallback((open: boolean) => {
    setDialogOpen(open);
    if (!open) setPending(null);
  }, []);

  const isCurrentPendingTarget = useCallback(
    (snapshot: FeedbackSnapshot) =>
      snapshot.conversationId === conversationId &&
      messages.some((m) => m.id === snapshot.assistantId),
    [messages, conversationId],
  );

  const onFeedback = useCallback(
    (assistantId: string, kind: MessageFeedback) => {
      const wasActive = messages.find((m) => m.id === assistantId)?.feedback === kind;
      // Clearing the highlight (clicking the same item again): switch the local state off directly, with no report and no dialog
      if (wasActive) {
        setLocalFeedback(assistantId, kind);
        return;
      }
      if (kind === 'up') {
        // Immediate feedback for a like: switch the highlight and report silently
        setLocalFeedback(assistantId, 'up');
        report(makeSnapshot(assistantId), 'up', [], '');
      } else {
        // A dislike: freeze the question-answer snapshot first and open the dialog; the highlight lands only after a successful submit, and cancel leaves no trace.
        setPending(makeSnapshot(assistantId));
        setDialogOpen(true);
      }
    },
    [messages, setLocalFeedback, report, makeSnapshot],
  );

  const submitDown = useCallback(
    (payload: { reasons: string[]; comment: string }) => {
      if (pending) {
        // If the conversation has already switched while the dialog was open, do not change the highlight on the current page, but still report from the snapshot at the moment of the click.
        if (isCurrentPendingTarget(pending)) {
          setLocalFeedback(pending.assistantId, 'down');
        }
        report(pending, 'down', payload.reasons, payload.comment);
      }
      setDialogOpen(false);
      setPending(null);
    },
    [pending, isCurrentPendingTarget, setLocalFeedback, report],
  );

  return {
    onFeedback,
    dialogOpen,
    setDialogOpen: changeDialogOpen,
    submitting: submitMut.isPending,
    submitDown,
  };
}
