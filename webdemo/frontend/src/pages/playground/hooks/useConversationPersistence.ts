/**
 * Playground 历史对话持久化编排 hook。
 *
 * 用途：把「列表查询 + 选中加载 + 自动保存 + 新建 + 删除」收敛为一处，喂给侧栏与页面。
 * 保存时机：首次发送立即保存用户消息，回答完成后串行保存最终快照。
 * 不含 JSX。明文密钥与对话正文分离——本 hook 只处理对话正文的存取，不碰密钥。
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

/** useConversationPersistence 入参：从 useChat 透传的最小集合 */
interface Args {
  messages: ChatMessage[];
  /** 当前选中模型（保存到会话元信息） */
  model: string;
  /** 当前登录用户 ID，用于隔离同标签页草稿。 */
  ownerId?: string;
  /** 用户身份仍在加载时暂停草稿恢复与自动保存。 */
  ownerLoading: boolean;
  /** 用消息列表替换当前对话（加载历史时用） */
  setMessages: (list: ChatMessage[]) => void;
  /** 清空当前对话（新建时用） */
  clear: () => void;
  /**
   * 恢复会话时把该会话当初使用的模型切回去（切换会话/刷新恢复时调用）。
   * 由上层校验模型是否仍可选，故此处仅在会话确有 model 时透传。
   */
  onModelRestore?: (model: string) => void;
}

interface Return {
  /** 侧栏「最近对话」列表项（id+title） */
  sessions: { id: string; title: string }[];
  activeConversationId?: string;
  /** 是否还有下一页可加载 */
  hasMore: boolean;
  /** 是否正在加载下一页 */
  loadingMore: boolean;
  /** 加载下一页（滚到底触发） */
  loadMore: () => void;
  /** 选中并加载某历史会话 */
  selectConversation: (id: string) => void;
  /** 新建对话（清空 + 脱离当前会话） */
  newChat: () => void;
  /** 删除某会话（若删的是当前会话则一并清空） */
  removeConversation: (id: string) => void;
}

export function useConversationPersistence(args: Args): Return {
  const { messages, model, ownerId, ownerLoading, setMessages, clear, onModelRestore } = args;

  const listQuery = useInfiniteConversationsQuery();
  const createMut = useCreateConversationMutation();
  const saveMut = useSaveConversationMutation();
  const deleteMut = useDeleteConversationMutation();
  // 当前会话 id 以 URL 查询参数 `c` 为准——刷新后据此恢复现场（避免回到空白新对话）。
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeId, setActiveIdState] = useState<string | undefined>(
    () => searchParams.get('c') || undefined,
  );
  const [autosaveEnabled, setAutosaveEnabled] = useState(false);

  /**
   * 设置当前会话 id 并同步写回 URL（replace 不污染浏览器历史）。
   * 传 undefined 时清除参数，回到「新对话」语义。
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

  // 扁平化分页结果为侧栏列表项；对后端未部署/异常返回（page.list 缺失）做容错，避免整页崩溃
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
      // 直接拉详情（不走 query 缓存，避免切换时的加载竞态），载回消息
      loadDetail(id).then((result) => {
        if (result.status === 'loaded') {
          const list = result.detail.messages.map(storedToChatMessage);
          resetAutosave();
          setMessages(list);
          setActiveId(id);
          markPersisted(list);
          // 切换会话时自动切回该会话当初使用的模型（上层校验其是否仍可选）
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
