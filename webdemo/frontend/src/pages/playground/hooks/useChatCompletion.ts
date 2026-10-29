/**
 * 体验中心「一次补全」生命周期 hook。
 *
 * 用途：校验 key → AbortController → 构造请求 → 流式/非流式合并增量 → finish/fail/abort 收尾。
 * send 与 regenerate 在 useChat 中构造 history 后调用 startCompletion。
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

/** useChatCompletion 入参 */
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
  /** 请求终态后刷新 Playground 免费体验状态。 */
  refreshCredential?: () => void;
}

/** useChatCompletion 返回 */
export interface UseChatCompletionReturn {
  loading: boolean;
  stop: () => void;
  /** 发起一次补全；调用前须已入列 assistant 占位，history 不含该占位 */
  startCompletion: (history: ChatMessage[], assistantId: string) => void;
}

/**
 * 托管单次补全的网络生命周期与 loading/abort 状态。
 * @param args setMessages、模型、密钥与参数偏好
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
    // 中断前请求可能已被 L2 消耗免费额度；终态同样刷新，避免 UI 停留在旧剩余次数。
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
      // MiniCPM-OCR-Jev 仅验证过完整响应协议；即使用户打开流式开关，也必须走非流式请求。
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
      // 所有 Playground 调用都生成浏览器关联 ID。直连 L2 用它回查调用日志；
      // 联网搜索由 L3 在最终 L2 调用完成时持久化映射，覆盖 SSE 最后一帧意外丢失。
      const clientRequestID = createPlaygroundClientRequestID();
      setMessages((prev) =>
        appendToMessage(prev, assistantId, { clientRequestId: clientRequestID, apiKeyId: keyId }),
      );

      // 请求消息在 begin 内按"刷新后的附件链接"重建，这里只准备运行时上下文。
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
        // 直连/联网请求都会消耗体验额度；终态后刷新，让 UI 及时回退用户自有 Key。
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
