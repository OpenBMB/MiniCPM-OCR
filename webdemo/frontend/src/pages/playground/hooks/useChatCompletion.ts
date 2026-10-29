/**
 * Experience-center hook for the lifecycle of "one completion".
 *
 * Purpose: check the key → AbortController → build the request → merge streaming or non-streaming increments → finish/fail/abort.
 * send and regenerate in useChat call startCompletion after they have built history.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@map/store';
import {
  streamChat,
  requestChat,
  streamPlaygroundWebSearch,
  ChatError,
  createPlaygroundClientRequestID,
} from '@/api/map/chat';
import type { ChatMessage, PlaygroundParams } from '../types';
import {
  authErrorForCompletion,
  finalizeAbortedMessages,
  finalizeCompletedMessages,
  finalizeFailedMessages,
  markConversationTurnContextExcluded,
} from '../utils/chatCompletion';
import { createStreamCallbacks } from '../utils/chatStreamCallbacks';
import { appendToMessage, toRequestMessages } from '../utils/messages';
import { buildContextWindowPlan, CONTEXT_WINDOW_MANAGEMENT_ENABLED } from '../utils/contextBudget';
import { buildChatParams, requiresNonStreaming } from '../utils/params';
import { refreshAttachmentLinks } from '../utils/refreshAttachmentLinks';
import { collectPlaygroundRuntimeContext } from '../utils/runtimeContext';

/** useChatCompletion arguments */
export interface UseChatCompletionArgs {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  model: string;
  getSecret: () => string | undefined;
  keyId?: string;
  params: PlaygroundParams;
  systemPrompt?: string;
  contextWindow?: number;
  modelMaxOutputTokens?: number;
  onContextTrim?: (trimmedMessageCount: number) => void;
  onContextLimit?: () => void;
  /** Refresh Playground free-trial state after a request reaches a terminal state. */
  refreshCredential?: () => void;
}

/** useChatCompletion return value */
export interface UseChatCompletionReturn {
  loading: boolean;
  stop: () => void;
  /** Start one completion; the assistant placeholder must already be enqueued, and history must not include that placeholder */
  startCompletion: (history: ChatMessage[], assistantId: string) => void;
}

/**
 * Own the network lifecycle and loading/abort state of a single completion.
 * @param args setMessages, model, secret, and parameter preferences
 */
export function useChatCompletion(args: UseChatCompletionArgs): UseChatCompletionReturn {
  const { t } = useTranslation('playground');
  const locale = useAppStore((state) => state.locale);
  const {
    setMessages,
    model,
    getSecret,
    keyId,
    params,
    systemPrompt,
    contextWindow = 0,
    modelMaxOutputTokens = 0,
    onContextTrim,
    onContextLimit,
    refreshCredential,
  } = args;
  const forceNonStreaming = requiresNonStreaming(model);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const activeCompletionRef = useRef<{
    controller: AbortController;
    assistantId: string;
    startedAt: number;
  } | null>(null);
  const activeStreamRef = useRef<{
    controller: AbortController;
    callbacks: ReturnType<typeof createStreamCallbacks>;
  } | null>(null);

  const stop = useCallback(() => {
    const activeCompletion = activeCompletionRef.current;
    if (!activeCompletion) return;
    // The request may already have consumed free quota at L2 before it was aborted; a terminal state refreshes too, so the UI does not stay on the old remaining count.
    refreshCredential?.();
    activeCompletion.controller.abort();
    if (activeStreamRef.current?.controller === activeCompletion.controller) {
      activeStreamRef.current.callbacks.cancel();
    }
    activeStreamRef.current = null;
    abortRef.current = null;
    activeCompletionRef.current = null;
    setLoading(false);
    setMessages((prev) =>
      finalizeAbortedMessages(prev, activeCompletion.assistantId, activeCompletion.startedAt),
    );
  }, [refreshCredential, setMessages]);

  useEffect(
    () => () => {
      activeCompletionRef.current?.controller.abort();
      activeStreamRef.current?.callbacks.cancel();
      abortRef.current = null;
      activeStreamRef.current = null;
      activeCompletionRef.current = null;
    },
    [],
  );

  const startCompletion = useCallback(
    (history: ChatMessage[], assistantId: string) => {
      // MiniCPM-OCR-Jev has only been verified against the full-response protocol; even if the user turns streaming on, the request must be non-streaming.
      const useStreaming = !forceNonStreaming && (params.stream || params.webSearch);
      const hostedWebSearch = !forceNonStreaming && params.webSearch;
      const secret = hostedWebSearch ? undefined : getSecret();
      const authError = authErrorForCompletion(hostedWebSearch, keyId, secret);
      if (authError) {
        setMessages((prev) =>
          appendToMessage(prev, assistantId, {
            streaming: false,
            searching: false,
            error: authError,
          }),
        );
        return;
      }

      const contextPlan = CONTEXT_WINDOW_MANAGEMENT_ENABLED
        ? buildContextWindowPlan(history, {
            contextWindow,
            modelMaxOutputTokens,
            requestedMaxOutputTokens: params.maxTokens,
            systemPrompt,
          })
        : undefined;
      if (contextPlan?.isOverBudget) {
        onContextLimit?.();
        setMessages((prev) =>
          appendToMessage(prev, assistantId, {
            streaming: false,
            searching: false,
            error: t('inputOverContext'),
          }),
        );
        return;
      }
      if (contextPlan && contextPlan.trimmedMessageCount > 0) {
        onContextTrim?.(contextPlan.trimmedMessageCount);
      }

      const controller = new AbortController();
      setLoading(true);
      // Every Playground call generates a browser correlation ID. A direct L2 call uses it to look the call log back up;
      // web search has L3 persist the mapping when the final L2 call finishes, covering an SSE last frame that was lost unexpectedly.
      const clientRequestID = createPlaygroundClientRequestID();
      setMessages((prev) =>
        appendToMessage(prev, assistantId, { clientRequestId: clientRequestID, apiKeyId: keyId }),
      );

      // Request messages are rebuilt inside begin from "refreshed attachment links"; here only the runtime context is prepared.
      const runtimeContext = collectPlaygroundRuntimeContext(locale, params.userLocation);

      const startedAt = performance.now();
      const activeCompletion = { controller, assistantId, startedAt };
      activeCompletionRef.current = activeCompletion;
      abortRef.current = controller;
      let firstTokenAt = 0;
      const markFirstToken = () => {
        if (activeCompletionRef.current !== activeCompletion) return;
        if (firstTokenAt) return;
        firstTokenAt = performance.now();
        setMessages((prev) =>
          appendToMessage(prev, assistantId, {
            metrics: { firstTokenMs: Math.round(firstTokenAt - startedAt) },
          }),
        );
      };
      const isCurrentCompletion = () => activeCompletionRef.current === activeCompletion;

      const finish = () => {
        if (!isCurrentCompletion()) return;
        // Both a direct call and a web-search request consume trial quota; refresh after the terminal state so the UI falls back to the user's own key in time.
        refreshCredential?.();
        setLoading(false);
        abortRef.current = null;
        activeStreamRef.current = null;
        activeCompletionRef.current = null;
        setMessages((prev) => finalizeCompletedMessages(prev, assistantId, startedAt));
      };

      const fail = (err: unknown) => {
        if (!isCurrentCompletion()) return;
        refreshCredential?.();
        if (err instanceof DOMException && err.name === 'AbortError') {
          setLoading(false);
          abortRef.current = null;
          activeStreamRef.current = null;
          activeCompletionRef.current = null;
          setMessages((prev) => finalizeAbortedMessages(prev, assistantId, startedAt));
          return;
        }
        const message = err instanceof ChatError ? err.message : t('conversationRequestFailed');
        const errorCode = err instanceof ChatError ? err.code : undefined;
        setLoading(false);
        abortRef.current = null;
        activeStreamRef.current = null;
        activeCompletionRef.current = null;
        setMessages((prev) => finalizeFailedMessages(prev, assistantId, message, errorCode));
      };

      const begin = async () => {
        let refreshed: ChatMessage[];
        try {
          refreshed = await refreshAttachmentLinks(history);
        } catch {
          throw new ChatError(503, '文件读取链接签发失败，请重试');
        }
        if (controller.signal.aborted) return;
        const refreshedPlan = CONTEXT_WINDOW_MANAGEMENT_ENABLED
          ? buildContextWindowPlan(refreshed, {
              contextWindow,
              modelMaxOutputTokens,
              requestedMaxOutputTokens: params.maxTokens,
              systemPrompt,
            })
          : undefined;
        const requestMessages = refreshedPlan
          ? refreshedPlan.requestMessages
          : toRequestMessages(refreshed, systemPrompt);
        const chatParams = buildChatParams(model, requestMessages, params);

        if (useStreaming) {
          const callbacks = createStreamCallbacks({
            assistantId,
            webSearch: params.webSearch,
            t,
            isActive: isCurrentCompletion,
            markFirstToken,
            onDone: finish,
            onRequestId: (requestId) => {
              if (!isCurrentCompletion()) return;
              setMessages((prev) => appendToMessage(prev, assistantId, { requestId }));
            },
            onModerationAnswer: () =>
              isCurrentCompletion() &&
              setMessages((prev) => markConversationTurnContextExcluded(prev, assistantId)),
            setMessages,
          });
          activeStreamRef.current = { controller, callbacks };
          const task = params.webSearch
            ? streamPlaygroundWebSearch(
                chatParams,
                keyId,
                callbacks,
                controller.signal,
                clientRequestID,
                { ...runtimeContext, location: params.userLocation },
                params.enabledTools,
              )
            : streamChat(
                chatParams,
                secret ?? '',
                callbacks,
                controller.signal,
                clientRequestID,
                runtimeContext,
              );
          task.catch((error) => {
            callbacks.cancel();
            fail(error);
          });
        } else {
          requestChat(chatParams, secret ?? '', controller.signal, clientRequestID, runtimeContext)
            .then((result) => {
              if (!isCurrentCompletion()) return;
              setMessages((prev) => {
                const next = appendToMessage(prev, assistantId, {
                  contentDelta: result.content,
                  reasoningDelta: result.reasoning || undefined,
                  citationsDelta: result.citations,
                  usage: result.usage,
                  requestId: result.requestId,
                });
                return result.moderationAnswer
                  ? markConversationTurnContextExcluded(next, assistantId)
                  : next;
              });
              finish();
            })
            .catch(fail);
        }
      };
      void begin().catch(fail);
    },
    [
      contextWindow,
      getSecret,
      keyId,
      locale,
      model,
      forceNonStreaming,
      modelMaxOutputTokens,
      refreshCredential,
      onContextLimit,
      onContextTrim,
      params,
      setMessages,
      systemPrompt,
      t,
    ],
  );

  return { loading, stop, startCompletion };
}
