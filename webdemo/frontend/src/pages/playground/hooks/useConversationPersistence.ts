/**
 * Hook that orchestrates Playground history-conversation persistence.
 *
 * Purpose: collapse "list query + load on select + autosave + create + delete" into one place, and feed the sidebar and the page.
 * Save timing: the first send saves the user message immediately, and after the answer finishes the final snapshot is saved serially.
 * No JSX. The plaintext secret stays separate from the conversation body — this hook only stores and loads the conversation body, and does not touch secrets.
 */

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useInfiniteConversationsQuery,
  useCreateConversationMutation,
  useDeleteConversationMutation,
  useSaveConversationMutation,
} from '@/api/map';
import type { ChatMessage } from '../types';
import { storedToChatMessage } from '../utils/conversations';
import { useConversationAutosave } from './useConversationAutosave';
import { useConversationDetailLoader } from './useConversationDetailLoader';
import { useInitialConversationRestore } from './useInitialConversationRestore';

/** useConversationPersistence arguments: the minimum set forwarded from useChat */
interface Args {
  messages: ChatMessage[];
  /** Currently selected model (saved into conversation metadata) */
  model: string;
  /** Currently logged-in user ID, used to isolate same-tab drafts. */
  ownerId?: string;
  /** While user identity is still loading, pause draft restore and autosave. */
  ownerLoading: boolean;
  /** Replace the current conversation with a message list (used when loading history) */
  setMessages: (list: ChatMessage[]) => void;
  /** Clear the current conversation (used when creating a new one) */
  clear: () => void;
  /**
   * When restoring a conversation, switch back to the model that conversation used (called when switching conversations or restoring on refresh).
   * The caller checks whether the model is still selectable, so this only forwards it when the conversation actually has a model.
   */
  onModelRestore?: (model: string) => void;
}

interface Return {
  /** A "recent conversations" sidebar item (id+title) */
  sessions: { id: string; title: string }[];
  activeConversationId?: string;
  /** Whether another page can be loaded */
  hasMore: boolean;
  /** Whether the next page is loading */
  loadingMore: boolean;
  /** Load the next page (triggered by scrolling to the bottom) */
  loadMore: () => void;
  /** Select and load one history conversation */
  selectConversation: (id: string) => void;
  /** Start a new conversation (clear + leave the current conversation) */
  newChat: () => void;
  /** Delete one conversation (if it is the current conversation, clear that too) */
  removeConversation: (id: string) => void;
}

export function useConversationPersistence(args: Args): Return {
  const { messages, model, ownerId, ownerLoading, setMessages, clear, onModelRestore } = args;

  const listQuery = useInfiniteConversationsQuery();
  const createMut = useCreateConversationMutation();
  const saveMut = useSaveConversationMutation();
  const deleteMut = useDeleteConversationMutation();
  // The current conversation id follows the URL query parameter `c` — after a refresh, restore from that (so it does not return to a blank new conversation).
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeId, setActiveIdState] = useState<string | undefined>(
    () => searchParams.get('c') || undefined,
  );
  const [autosaveEnabled, setAutosaveEnabled] = useState(false);

  /**
   * Set the current conversation id and write it back to the URL (replace does not pollute browser history).
   * Passing undefined clears the parameter and returns to the "new conversation" meaning.
   */
  const setActiveId = useCallback(
    (id: string | undefined) => {
      setActiveIdState(id);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set('c', id);
          else next.delete('c');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const { hasUserActivity, loadDetail, cancelPending } = useConversationDetailLoader(messages);
  const enableAutosave = useCallback(() => setAutosaveEnabled(true), []);
  const { markPersisted, reset: resetAutosave } = useConversationAutosave({
    messages,
    model,
    ownerId,
    enabled: autosaveEnabled,
    activeConversationId: activeId,
    createConversation: createMut.mutateAsync,
    saveConversation: saveMut.mutateAsync,
    onConversationCreated: setActiveId,
  });
  useInitialConversationRestore({
    conversationId: searchParams.get('c'),
    ownerId,
    ownerLoading,
    hasUserActivity,
    loadDetail,
    setActiveId,
    setMessages,
    markPersisted,
    onReady: enableAutosave,
    onModelRestore,
  });

  // Flatten paged results into sidebar items; tolerate a backend that is not deployed or returns an abnormal shape (page.list missing), so the whole page does not crash
  const sessions = useMemo(
    () =>
      (listQuery.data?.pages ?? [])
        .flatMap((p) => (Array.isArray(p?.list) ? p.list : []))
        .filter((c) => c && c.id)
        .map((c) => ({ id: c.id, title: c.title })),
    [listQuery.data],
  );

  const loadMore = useCallback(() => {
    if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) listQuery.fetchNextPage();
  }, [listQuery]);

  const selectConversation = useCallback(
    (id: string) => {
      if (id === activeId) return;
      // Pull the detail directly (not through the query cache, avoiding a load race while switching), and load the messages back
      loadDetail(id).then((result) => {
        if (result.status === 'loaded') {
          const list = result.detail.messages.map(storedToChatMessage);
          resetAutosave();
          setMessages(list);
          setActiveId(id);
          markPersisted(list);
          // When switching conversations, switch back to the model that conversation originally used (the caller checks whether it is still selectable)
          if (result.detail.conversation.model) {
            onModelRestore?.(result.detail.conversation.model);
          }
        }
      });
    },
    [activeId, loadDetail, markPersisted, onModelRestore, resetAutosave, setMessages, setActiveId],
  );

  const newChat = useCallback(() => {
    cancelPending();
    resetAutosave();
    clear();
    setActiveId(undefined);
  }, [cancelPending, clear, resetAutosave, setActiveId]);

  const removeConversation = useCallback(
    (id: string) => {
      deleteMut.mutate(id);
      if (id === activeId) {
        cancelPending();
        resetAutosave();
        clear();
        setActiveId(undefined);
      }
    },
    [deleteMut, activeId, cancelPending, clear, resetAutosave, setActiveId],
  );

  return {
    sessions,
    activeConversationId: activeId,
    hasMore: Boolean(listQuery.hasNextPage),
    loadingMore: listQuery.isFetchingNextPage,
    loadMore,
    selectConversation,
    newChat,
    removeConversation,
  };
}
