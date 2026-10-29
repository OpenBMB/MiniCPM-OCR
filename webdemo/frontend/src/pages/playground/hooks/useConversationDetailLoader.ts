/**
 * Playground history-conversation detail loader.
 *
 * Purpose: assign a sequence number to each detail request, so a late response is invalidated automatically when conversations are selected in succession or a new one is created.
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
 * Manage races among conversation-detail requests.
 * @param messages current messages, used to cancel the initial restore when the user has already sent new content.
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
