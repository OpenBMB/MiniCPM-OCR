/**
 * Playground 历史会话详情加载器。
 *
 * 用途：给每次详情请求分配序号，连续选择或新建会话时让迟到响应自动失效。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { mapResourcesApi, type MapConversationDetail } from '@/api/map';

import type { ChatMessage } from '../types';

export type ConversationDetailResult =
  | { status: 'loaded'; detail: MapConversationDetail }
  | { status: 'failed' }
  | { status: 'stale' };

interface UseConversationDetailLoaderReturn {
  hasUserActivity: boolean;
  loadDetail: (id: string) => Promise<ConversationDetailResult>;
  cancelPending: () => void;
}

/**
 * 管理会话详情请求的竞态。
 * @param messages 当前消息，用于在用户已发送新内容时取消初始恢复。
 */
export function useConversationDetailLoader(
  messages: ChatMessage[],
): UseConversationDetailLoaderReturn {
  const requestRef = useRef(0);
  const pendingRef = useRef(false);
  const previousMessagesRef = useRef(messages);
  const hasUserActivity = useMemo(
    () => messages.some((message) => message.role === 'user'),
    [messages],
  );

  const cancelPending = useCallback(() => {
    requestRef.current += 1;
    pendingRef.current = false;
  }, []);

  const loadDetail = useCallback(async (id: string): Promise<ConversationDetailResult> => {
    const request = ++requestRef.current;
    pendingRef.current = true;
    try {
      const detail = await mapResourcesApi.getConversation(id);
      if (request !== requestRef.current) return { status: 'stale' };
      pendingRef.current = false;
      return { status: 'loaded', detail };
    } catch {
      if (request !== requestRef.current) return { status: 'stale' };
      pendingRef.current = false;
      return { status: 'failed' };
    }
  }, []);

  useEffect(() => {
    if (messages === previousMessagesRef.current) return;
    previousMessagesRef.current = messages;
    if (hasUserActivity && pendingRef.current) cancelPending();
  }, [cancelPending, hasUserActivity, messages]);

  return { hasUserActivity, loadDetail, cancelPending };
}
