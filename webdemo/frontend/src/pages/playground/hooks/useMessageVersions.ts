/**
 * Playground hook for multi-version answers and feedback.
 *
 * Purpose: regenerate / setFeedback / setActiveVersion; keep the versions invariant, and delegate the completion trigger to startCompletion.
 */

import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { ChatMessage, MessageFeedback } from '../types';
import {
  applyActiveVersionSwitch,
  applyFeedbackToggle,
  applyRegeneratePrep,
  findRegenerateContext,
  prepareRegenerateMessage,
} from '../utils/messageVersions';

/** useMessageVersions arguments */
export interface UseMessageVersionsArgs {
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  loading: boolean;
  /** From useChatCompletion: start a completion after history has been built */
  startCompletion: (history: ChatMessage[], assistantId: string) => void;
}

/** useMessageVersions return value */
export interface UseMessageVersionsReturn {
  regenerate: (assistantId: string) => void;
  setFeedback: (assistantId: string, kind: MessageFeedback) => void;
  setActiveVersion: (assistantId: string, index: number) => void;
}

/**
 * Own multi-version answers and feedback state; no network and no JSX.
 * @param args message list, loading, and the startCompletion callback
 */
export function useMessageVersions(args: UseMessageVersionsArgs): UseMessageVersionsReturn {
  const { messages, setMessages, loading, startCompletion } = args;

  const regenerate = useCallback(
    (assistantId: string) => {
      if (loading) return;
      const ctx = findRegenerateContext(messages, assistantId);
      if (!ctx) return;

      const prepared = prepareRegenerateMessage(ctx.target);
      setMessages((prev) => applyRegeneratePrep(prev, assistantId, prepared));
      startCompletion(ctx.base, assistantId);
    },
    [loading, messages, setMessages, startCompletion],
  );

  const setFeedback = useCallback(
    (assistantId: string, kind: MessageFeedback) => {
      setMessages((prev) => applyFeedbackToggle(prev, assistantId, kind));
    },
    [setMessages],
  );

  const setActiveVersion = useCallback(
    (assistantId: string, index: number) => {
      setMessages((prev) => applyActiveVersionSwitch(prev, assistantId, index));
    },
    [setMessages],
  );

  return { regenerate, setFeedback, setActiveVersion };
}
