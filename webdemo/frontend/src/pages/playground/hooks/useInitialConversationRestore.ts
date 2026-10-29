/**
 * Playground 首次刷新恢复。
 *
 * 用途：身份确认后优先恢复同用户草稿，否则按 URL 会话 ID 拉取服务端详情。
 */

import { useEffect, useRef } from 'react';

import type { ChatMessage } from '../types';
import { clearConversationDraft, readConversationDraft } from '../utils/conversationDraft';
import { savePayloadToChatMessages, storedToChatMessage } from '../utils/conversations';
import type { ConversationDetailResult } from './useConversationDetailLoader';

interface UseInitialConversationRestoreArgs {
  conversationId: string | null;
  ownerId?: string;
  ownerLoading: boolean;
  hasUserActivity: boolean;
  loadDetail: (id: string) => Promise<ConversationDetailResult>;
  setActiveId: (id: string | undefined) => void;
  setMessages: (list: ChatMessage[]) => void;
  markPersisted: (messages: ChatMessage[]) => void;
  onReady: () => void;
  onModelRestore?: (model: string) => void;
}

/**
 * 恢复刷新前的当前会话。
 * @returns 无返回值。
 */
export function useInitialConversationRestore(args: UseInitialConversationRestoreArgs): void {
  const {
    conversationId,
    ownerId,
    ownerLoading,
    hasUserActivity,
    loadDetail,
    setActiveId,
    setMessages,
    markPersisted,
    onReady,
    onModelRestore,
  } = args;
  const completedRef = useRef(false);
  const runRef = useRef(0);

  useEffect(() => {
    if (ownerLoading || completedRef.current) return;
    const run = ++runRef.current;

    function finish(): void {
      if (run !== runRef.current || completedRef.current) return;
      completedRef.current = true;
      onReady();
    }

    async function restore(): Promise<void> {
      // 本地草稿分支也异步执行，避免 effect 内同步触发多次级联 state 更新。
      await Promise.resolve();
      if (run !== runRef.current) return;
      if (hasUserActivity) {
        // URL 详情未恢复前用户已发送，必须脱离旧会话，避免用不完整快照覆盖服务端历史。
        if (conversationId) setActiveId(undefined);
        finish();
        return;
      }

      const draft = ownerId ? readConversationDraft(ownerId) : undefined;
      if (draft && (!conversationId || draft.conversationId === conversationId)) {
        const list = savePayloadToChatMessages(draft.payload);
        if (draft.interrupted && !list.some((message) => message.interrupted)) {
          let lastAssistant = -1;
          for (let index = list.length - 1; index >= 0; index -= 1) {
            if (list[index]?.role !== 'assistant') continue;
            lastAssistant = index;
            break;
          }
          if (lastAssistant >= 0 && list[lastAssistant]) {
            list[lastAssistant] = { ...list[lastAssistant], interrupted: true };
          }
        }
        setMessages(list);
        if (draft.conversationId && draft.conversationId !== conversationId) {
          setActiveId(draft.conversationId);
        }
        if (draft.payload.model) onModelRestore?.(draft.payload.model);
        finish();
        return;
      }
      if (draft && ownerId) clearConversationDraft(ownerId);
      if (!conversationId) {
        finish();
        return;
      }

      const result = await loadDetail(conversationId);
      if (run !== runRef.current || result.status === 'stale') return;
      if (result.status === 'failed') {
        setActiveId(undefined);
        finish();
        return;
      }
      const list = result.detail.messages.map(storedToChatMessage);
      setMessages(list);
      markPersisted(list);
      if (result.detail.conversation.model) {
        onModelRestore?.(result.detail.conversation.model);
      }
      finish();
    }

    void restore();
    return () => {
      if (run === runRef.current) runRef.current += 1;
    };
  }, [
    conversationId,
    hasUserActivity,
    loadDetail,
    markPersisted,
    onReady,
    onModelRestore,
    ownerId,
    ownerLoading,
    setActiveId,
    setMessages,
  ]);
}
