/**
 * Core conversation state-machine hook for the experience center (facade).
 *
 * Purpose: own the message list and send/clear; completion networking is delegated to useChatCompletion, and multi-version/feedback to useMessageVersions.
 * The external API stays the same: the page layer depends only on useChat(args) and its return value.
 */

import { useCallback, useRef, useState } from 'react';
import type { Attachment, ChatMessage, MessageFeedback, PlaygroundParams } from '../types';
import { genId, makeDivider, makeMessage } from '../utils/messages';
import { useChatCompletion } from './useChatCompletion';
import { useMessageVersions } from './useMessageVersions';

/** useChat arguments */
export interface UseChatArgs {
  /** Currently selected model id */
  model: string;
  /** Lazily read the plaintext secret (returns empty when there is no secret, and send refuses) */
  getSecret: () => string | undefined;
  /** Currently auto-selected API Key ID; web-search mode hands only this ID to the BFF */
  keyId?: string;
  /** Parameter preferences */
  params: PlaygroundParams;
  /** Optional system prompt */
  systemPrompt?: string;
  /** Context window declared in the model catalog; 0 means it is not declared. */
  contextWindow?: number;
  /** Maximum output tokens declared in the model catalog. */
  modelMaxOutputTokens?: number;
  /** Experience notice after old messages are trimmed automatically. */
  onContextTrim?: (trimmedMessageCount: number) => void;
  /** Experience notice when the current input itself exceeds the available context. */
  onContextLimit?: () => void;
  /** Refresh Playground free-trial state after a request reaches a terminal state. */
  refreshCredential?: () => void;
}

/** useChat return value */
export interface UseChatReturn {
  messages: ChatMessage[];
  loading: boolean;
  /** Send one user message (optionally with multimodal attachments) and start a completion */
  send: (text: string, attachments?: Attachment[]) => void;
  /** Regenerate one assistant message (non-destructive): keep existing versions, append a new version, and switch to the last one */
  regenerate: (assistantId: string) => void;
  /** Toggle feedback on one assistant message (like/dislike are exclusive; clicking the same one again clears it). Write the current version and mirror the top level */
  setFeedback: (assistantId: string, kind: MessageFeedback) => void;
  /** Switch the displayed version of one assistant message (‹n/N› paging), and mirror that version's fields back to the top level */
  setActiveVersion: (assistantId: string, index: number) => void;
  /** Stop the current generation (AbortController) */
  stop: () => void;
  /** Clear every message */
  clear: () => void;
  /** Clear context: insert a divider, and history above it is no longer sent as context (messages stay; this is not a new conversation) */
  clearContext: () => void;
  /** Replace the message list directly (used when switching "recent conversations") */
  setMessages: (list: ChatMessage[]) => void;
}

/**
 * Conversation state-machine facade.
 * @param args model / secret getter / parameters / system prompt
 */
export function useChat(args: UseChatArgs): UseChatReturn {
  const {
    model,
    getSecret,
    params,
    systemPrompt,
    contextWindow,
    modelMaxOutputTokens,
    onContextTrim,
    onContextLimit,
    refreshCredential,
  } = args;
  const keyId = args.keyId;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const seqRef = useRef(0);

  const { loading, stop, startCompletion } = useChatCompletion({
    setMessages,
    model,
    getSecret,
    keyId,
    params,
    systemPrompt,
    contextWindow,
    modelMaxOutputTokens,
    onContextTrim,
    onContextLimit,
    refreshCredential,
  });

  const { regenerate, setFeedback, setActiveVersion } = useMessageVersions({
    messages,
    setMessages,
    loading,
    startCompletion,
  });

  const clear = useCallback(() => {
    stop();
    setMessages([]);
  }, [stop]);

  const clearContext = useCallback(() => {
    if (loading) return;
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      if (prev[prev.length - 1]?.divider) return prev;
      return [...prev, makeDivider(genId((seqRef.current += 1)))];
    });
  }, [loading]);

  const send = useCallback(
    (text: string, attachments?: Attachment[]) => {
      const content = text.trim();
      const atts = attachments ?? [];
      if ((!content && atts.length === 0) || loading) return;

      const userId = genId((seqRef.current += 1));
      const assistantId = genId((seqRef.current += 1));

      const userMsg = makeMessage(
        userId,
        'user',
        content,
        atts.length ? { attachments: atts } : {},
      );
      const history = [...messages, userMsg];
      // When web search is on, set searching first: there is a gap between sending the request and the first tool_status event,
      // and otherwise the UI has no feedback during that time. When web search is off it stays false, and the non-search path is unchanged.
      const placeholder = makeMessage(assistantId, 'assistant', '', {
        streaming: true,
        searching: params.webSearch,
      });
      setMessages([...history, placeholder]);

      startCompletion(history, assistantId);
    },
    [loading, messages, params.webSearch, startCompletion],
  );

  return {
    messages,
    loading,
    send,
    regenerate,
    setFeedback,
    setActiveVersion,
    stop,
    clear,
    clearContext,
    setMessages,
  };
}
