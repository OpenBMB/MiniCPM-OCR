/**
 * Playground 会话自动保存队列。
 *
 * 用途：首次发送时立即创建会话并保存用户消息；回答结束后串行保存最终快照。
 * 同一时刻只允许一个写请求，生成期间产生的新快照只保留最新一份，避免旧请求后完成覆盖新内容。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { MapSaveConversationInput } from '@/api/map';

import type { ChatMessage } from '../types';
import { ConversationAutosaveQueue } from '../utils/conversationAutosaveQueue';
import {
  chatMessagesToSavePayload,
  messagesForAutosave,
  messagesForDraft,
} from '../utils/conversations';
import { deriveTitle } from '../utils/messages';

interface UseConversationAutosaveArgs {
  messages: ChatMessage[];
  model: string;
  ownerId?: string;
  enabled: boolean;
  activeConversationId?: string;
  createConversation: (payload: { title?: string; model?: string }) => Promise<{ id: string }>;
  saveConversation: (vars: { id: string; payload: MapSaveConversationInput }) => Promise<unknown>;
  onConversationCreated: (id: string) => void;
}

interface UseConversationAutosaveReturn {
  /** 标记服务端已持久化的历史消息，避免加载历史后立即重复保存。 */
  markPersisted: (messages: ChatMessage[]) => void;
  /** 开始新对话时废弃当前排队快照，隔离前后两段会话。 */
  reset: () => void;
}

/**
 * 串行保存当前 Playground 会话。
 * @param args 当前消息、模型、会话 ID 与 API 写入函数。
 * @returns 历史恢复标记与新会话重置函数。
 */
export function useConversationAutosave(
  args: UseConversationAutosaveArgs,
): UseConversationAutosaveReturn {
  const {
    messages,
    model,
    ownerId,
    enabled,
    activeConversationId,
    createConversation,
    saveConversation,
    onConversationCreated,
  } = args;
  const previousOwnerRef = useRef(ownerId);
  const [queue] = useState(
    () =>
      new ConversationAutosaveQueue(
        { createConversation, saveConversation, onConversationCreated },
        activeConversationId,
      ),
  );

  // mutation 与 URL 回调可能在重渲染后换引用，队列始终使用最新实现。
  useEffect(() => {
    queue.updateHandlers({ createConversation, saveConversation, onConversationCreated });
  }, [createConversation, onConversationCreated, queue, saveConversation]);

  // URL/历史选择改变活动会话时同步给队列。
  useLayoutEffect(() => {
    queue.setActiveConversationId(activeConversationId);
  }, [activeConversationId, queue]);

  // 账号切换立即废弃上一账号队列与草稿。
  useLayoutEffect(() => {
    if (previousOwnerRef.current === ownerId) return;
    queue.reset(previousOwnerRef.current);
    previousOwnerRef.current = ownerId;
    queue.setActiveConversationId(activeConversationId);
  }, [activeConversationId, ownerId, queue]);

  // 页面可见消息提交后立即刷新草稿，确保 pagehide 读取到本次提交的最后增量。
  useLayoutEffect(() => {
    if (!enabled) return;
    const draftable = messagesForDraft(messages);
    if (draftable.some((message) => message.role === 'user')) {
      const draftPayload = chatMessagesToSavePayload(
        draftable,
        deriveTitle(draftable),
        model || undefined,
      );
      if (draftPayload.messages.length > 0) {
        queue.updateDraft(
          {
            ownerId,
            signature: JSON.stringify(draftPayload.messages),
            payload: draftPayload,
          },
          draftable.some((message) => message.interrupted),
        );
      }
    }
  }, [enabled, messages, model, ownerId, queue]);

  useEffect(() => {
    if (!enabled) return;
    const persistable = messagesForAutosave(messages);
    if (!persistable.some((message) => message.role === 'user')) return;

    const payload = chatMessagesToSavePayload(
      persistable,
      deriveTitle(persistable),
      model || undefined,
    );
    if (payload.messages.length === 0) return;

    const signature = JSON.stringify(payload.messages);
    queue.enqueue({
      ownerId,
      signature,
      payload,
    });
  }, [enabled, messages, model, ownerId, queue]);

  const markPersisted = useCallback(
    (persistedMessages: ChatMessage[]) => {
      const persistable = messagesForAutosave(persistedMessages);
      const payload = chatMessagesToSavePayload(persistable, deriveTitle(persistable), undefined);
      queue.markPersisted(JSON.stringify(payload.messages), ownerId);
    },
    [ownerId, queue],
  );

  const reset = useCallback(() => {
    queue.reset(ownerId);
  }, [ownerId, queue]);

  useEffect(() => {
    queue.activate();
    const flushDraft = () => queue.flushDraft();
    window.addEventListener('pagehide', flushDraft);
    return () => {
      window.removeEventListener('pagehide', flushDraft);
      queue.dispose();
    };
  }, [queue]);

  return { markPersisted, reset };
}
