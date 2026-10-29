/**
 * Playground 多版本回答与反馈 hook。
 *
 * 用途：regenerate / setFeedback / setActiveVersion；维护 versions 不变式，补全触发委托 startCompletion。
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

/** useMessageVersions 入参 */
export interface UseMessageVersionsArgs {
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  loading: boolean;
  /** 来自 useChatCompletion：构造好 history 后发起补全 */
  startCompletion: (history: ChatMessage[], assistantId: string) => void;
}

/** useMessageVersions 返回 */
export interface UseMessageVersionsReturn {
  regenerate: (assistantId: string) => void;
  setFeedback: (assistantId: string, kind: MessageFeedback) => void;
  setActiveVersion: (assistantId: string, index: number) => void;
}

/**
 * 托管多版本回答与反馈态；不含网络与 JSX。
 * @param args 消息列表、loading 与 startCompletion 回调
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
