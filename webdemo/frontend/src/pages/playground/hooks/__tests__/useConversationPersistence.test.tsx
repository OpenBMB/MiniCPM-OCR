import { useState, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '../../types';
import { useConversationPersistence } from '../useConversationPersistence';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  getConversation: vi.fn(),
}));

vi.mock('@/api/map', () => ({
  mapResourcesApi: {
    getConversation: mocks.getConversation,
  },
  useInfiniteConversationsQuery: () => ({
    data: { pages: [] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useCreateConversationMutation: () => ({ mutateAsync: mocks.create }),
  useSaveConversationMutation: () => ({ mutateAsync: mocks.save }),
  useDeleteConversationMutation: () => ({ mutate: mocks.remove }),
}));

function user(content: string): ChatMessage {
  return { id: 'user-1', role: 'user', content, streaming: false };
}

function assistant(content: string, streaming: boolean): ChatMessage {
  return { id: 'assistant-1', role: 'assistant', content, streaming };
}

function createWrapper(locationRef: { current: string }, initialEntry = '/playground') {
  function LocationObserver({ children }: { children: ReactNode }) {
    locationRef.current = useLocation().search;
    return children;
  }

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationObserver>{children}</LocationObserver>
      </MemoryRouter>
    );
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe('useConversationPersistence', () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.save.mockReset();
    mocks.remove.mockReset();
    mocks.getConversation.mockReset();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('首次消息生成中即创建会话并保存用户消息', async () => {
    mocks.create.mockResolvedValue({ id: 'conv-1', title: '新问题' });
    mocks.save.mockResolvedValue({ status: 'saved' });
    const locationRef = { current: '' };

    const { result } = renderHook(
      () =>
        useConversationPersistence({
          messages: [user('新问题'), assistant('', true)],
          model: 'model-1',
          ownerId: 'user-1',
          ownerLoading: false,
          setMessages: vi.fn(),
          clear: vi.fn(),
        }),
      { wrapper: createWrapper(locationRef) },
    );

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));

    expect(mocks.save).toHaveBeenCalledWith({
      id: 'conv-1',
      payload: {
        title: '新问题',
        model: 'model-1',
        messages: [{ role: 'user', content: '新问题' }],
      },
    });
    expect(result.current.activeConversationId).toBe('conv-1');
    expect(locationRef.current).toBe('?c=conv-1');
  });

  it('首次保存未完成时排队保存最终回答', async () => {
    const firstSave = deferred<{ status: string }>();
    mocks.create.mockResolvedValue({ id: 'conv-1', title: '新问题' });
    mocks.save
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValueOnce({ status: 'saved' });
    const locationRef = { current: '' };

    const { rerender } = renderHook(
      ({ messages }) =>
        useConversationPersistence({
          messages,
          model: 'model-1',
          ownerId: 'user-1',
          ownerLoading: false,
          setMessages: vi.fn(),
          clear: vi.fn(),
        }),
      {
        initialProps: {
          messages: [user('新问题'), assistant('', true)],
        },
        wrapper: createWrapper(locationRef),
      },
    );

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));

    rerender({
      messages: [user('新问题'), assistant('完整回答', false)],
    });

    expect(mocks.save).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstSave.resolve({ status: 'saved' });
      await firstSave.promise;
    });

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1]?.[0]).toEqual({
      id: 'conv-1',
      payload: {
        title: '新问题',
        model: 'model-1',
        messages: [
          { role: 'user', content: '新问题' },
          { role: 'assistant', content: '完整回答' },
        ],
      },
    });
  });

  it('流式回答已有内容时写入中断草稿但不逐 token 保存服务端', async () => {
    const firstSave = deferred<{ status: string }>();
    mocks.create.mockResolvedValue({ id: 'conv-1', title: '问题' });
    mocks.save.mockReturnValue(firstSave.promise);
    const locationRef = { current: '' };

    const { rerender } = renderHook(
      ({ messages }) =>
        useConversationPersistence({
          messages,
          model: 'model-1',
          ownerId: 'user-1',
          ownerLoading: false,
          setMessages: vi.fn(),
          clear: vi.fn(),
        }),
      {
        initialProps: {
          messages: [user('问题'), assistant('', true)],
        },
        wrapper: createWrapper(locationRef),
      },
    );

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    rerender({
      messages: [user('问题'), assistant('已经生成的部分回答', true)],
    });

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await waitFor(() => {
      const raw = sessionStorage.getItem('map-playground-conversation-draft-v2:user-1');
      expect(raw).not.toBeNull();
      const draft = JSON.parse(raw ?? '{}');
      expect(draft.interrupted).toBe(true);
      expect(draft.payload.messages).toEqual([
        { role: 'user', content: '问题' },
        {
          role: 'assistant',
          content: '已经生成的部分回答',
          alt_versions: [{ content: '已经生成的部分回答', interrupted: true }],
          active_version: 0,
        },
      ]);
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstSave.resolve({ status: 'saved' });
      await firstSave.promise;
    });
    expect(sessionStorage.getItem('map-playground-conversation-draft-v2:user-1')).not.toBeNull();
  });

  it('流式状态提交后立即 pagehide 时刷新草稿包含最新增量', async () => {
    mocks.create.mockResolvedValue({ id: 'conv-1', title: '问题' });
    mocks.save.mockResolvedValue({ status: 'saved' });
    const locationRef = { current: '' };

    const { rerender } = renderHook(
      ({ messages }) =>
        useConversationPersistence({
          messages,
          model: 'model-1',
          ownerId: 'user-1',
          ownerLoading: false,
          setMessages: vi.fn(),
          clear: vi.fn(),
        }),
      {
        initialProps: {
          messages: [user('问题'), assistant('', true)],
        },
        wrapper: createWrapper(locationRef),
      },
    );

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));

    rerender({
      messages: [user('问题'), assistant('最后一个可见增量', true)],
    });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    const raw = sessionStorage.getItem('map-playground-conversation-draft-v2:user-1');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? '{}').payload.messages[1]).toMatchObject({
      role: 'assistant',
      content: '最后一个可见增量',
      alt_versions: [{ content: '最后一个可见增量', interrupted: true }],
    });
  });

  it('重新生成部分回答刷新后恢复当前中断版本并保留旧版本', async () => {
    const firstSave = deferred<{ status: string }>();
    mocks.create.mockResolvedValue({ id: 'conv-existing', title: '问题' });
    mocks.save.mockReturnValue(firstSave.promise);
    const locationRef = { current: '' };

    const { rerender } = renderHook(
      ({ messages }) =>
        useConversationPersistence({
          messages,
          model: 'model-1',
          ownerId: 'user-1',
          ownerLoading: false,
          setMessages: vi.fn(),
          clear: vi.fn(),
        }),
      {
        initialProps: {
          messages: [
            user('问题'),
            {
              ...assistant('旧完整回答', false),
              versions: [{ content: '旧完整回答' }],
              activeVersion: 0,
            },
          ],
        },
        wrapper: createWrapper(locationRef),
      },
    );

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    rerender({
      messages: [
        user('问题'),
        {
          ...assistant('新回答的部分内容', true),
          reasoning: '部分思考',
          versions: [{ content: '旧完整回答' }],
          activeVersion: 0,
        },
      ],
    });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    const raw = sessionStorage.getItem('map-playground-conversation-draft-v2:user-1');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? '{}').payload.messages[1]).toMatchObject({
      role: 'assistant',
      content: '新回答的部分内容',
      alt_versions: [
        { content: '旧完整回答' },
        {
          content: '新回答的部分内容',
          reasoning: '部分思考',
          interrupted: true,
        },
      ],
      active_version: 1,
    });
  });

  it('旧会话保存中开启新对话后继续保存新消息', async () => {
    const oldSave = deferred<{ status: string }>();
    mocks.create
      .mockResolvedValueOnce({ id: 'conv-old', title: '旧问题' })
      .mockResolvedValueOnce({ id: 'conv-new', title: '新问题' });
    mocks.save
      .mockImplementationOnce(() => oldSave.promise)
      .mockResolvedValueOnce({ status: 'saved' });
    const clear = vi.fn();
    const locationRef = { current: '' };

    const { result, rerender } = renderHook(
      ({ messages }) =>
        useConversationPersistence({
          messages,
          model: 'model-1',
          ownerId: 'user-1',
          ownerLoading: false,
          setMessages: vi.fn(),
          clear,
        }),
      {
        initialProps: {
          messages: [user('旧问题'), assistant('', true)],
        },
        wrapper: createWrapper(locationRef),
      },
    );

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.newChat();
    });
    rerender({
      messages: [user('新问题'), assistant('', true)],
    });

    await act(async () => {
      oldSave.resolve({ status: 'saved' });
      await oldSave.promise;
    });

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1]?.[0]).toEqual({
      id: 'conv-new',
      payload: {
        title: '新问题',
        model: 'model-1',
        messages: [{ role: 'user', content: '新问题' }],
      },
    });
  });

  it('旧会话保存失败后仍继续保存已排队的新会话', async () => {
    const oldSave = deferred<{ status: string }>();
    mocks.create
      .mockResolvedValueOnce({ id: 'conv-old', title: '旧问题' })
      .mockResolvedValueOnce({ id: 'conv-new', title: '新问题' });
    mocks.save
      .mockImplementationOnce(() => oldSave.promise)
      .mockResolvedValueOnce({ status: 'saved' });
    const locationRef = { current: '' };

    const { result, rerender } = renderHook(
      ({ messages }) =>
        useConversationPersistence({
          messages,
          model: 'model-1',
          ownerId: 'user-1',
          ownerLoading: false,
          setMessages: vi.fn(),
          clear: vi.fn(),
        }),
      {
        initialProps: {
          messages: [user('旧问题'), assistant('', true)],
        },
        wrapper: createWrapper(locationRef),
      },
    );

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    act(() => result.current.newChat());
    rerender({
      messages: [user('新问题'), assistant('', true)],
    });

    await act(async () => {
      oldSave.reject(new Error('旧保存失败'));
      await oldSave.promise.catch(() => undefined);
    });

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1]?.[0]).toMatchObject({
      id: 'conv-new',
      payload: { messages: [{ role: 'user', content: '新问题' }] },
    });
  });

  it('重新生成流式进行中不删除已持久化的旧回答', async () => {
    mocks.getConversation.mockResolvedValue({
      conversation: { id: 'conv-existing', title: '问题', model: 'model-1' },
      messages: [
        { id: 'stored-user', role: 'user', content: '问题' },
        { id: 'stored-assistant', role: 'assistant', content: '旧回答' },
      ],
    });
    mocks.save.mockResolvedValue({ status: 'saved' });
    const locationRef = { current: '' };

    const { rerender } = renderHook(
      ({ messages }) =>
        useConversationPersistence({
          messages,
          model: 'model-1',
          ownerId: 'user-1',
          ownerLoading: false,
          setMessages: vi.fn(),
          clear: vi.fn(),
        }),
      {
        initialProps: {
          messages: [] as ChatMessage[],
        },
        wrapper: createWrapper(locationRef, '/playground?c=conv-existing'),
      },
    );

    await waitFor(() => expect(mocks.getConversation).toHaveBeenCalledWith('conv-existing'));

    rerender({
      messages: [
        { id: 'stored-user', role: 'user', content: '问题', streaming: false },
        {
          id: 'stored-assistant',
          role: 'assistant',
          content: '',
          streaming: true,
          versions: [{ content: '旧回答' }],
          activeVersion: 0,
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('带 URL 会话 ID 刷新时恢复服务端消息和原模型', async () => {
    mocks.getConversation.mockResolvedValue({
      conversation: { id: 'conv-existing', title: '问题', model: 'model-original' },
      messages: [
        { id: 'stored-user', role: 'user', content: '服务端问题' },
        { id: 'stored-assistant', role: 'assistant', content: '服务端回答' },
      ],
    });
    const onModelRestore = vi.fn();
    const locationRef = { current: '' };

    const { result } = renderHook(
      () => {
        const [messages, setMessages] = useState<ChatMessage[]>([]);
        const persistence = useConversationPersistence({
          messages,
          model: 'model-current',
          ownerId: 'user-1',
          ownerLoading: false,
          setMessages,
          clear: () => setMessages([]),
          onModelRestore,
        });
        return { messages, persistence };
      },
      { wrapper: createWrapper(locationRef, '/playground?c=conv-existing') },
    );

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages.map((message) => message.content)).toEqual([
      '服务端问题',
      '服务端回答',
    ]);
    expect(result.current.persistence.activeConversationId).toBe('conv-existing');
    expect(onModelRestore).toHaveBeenCalledWith('model-original');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('刷新时恢复尚未完成服务端保存的本地草稿', async () => {
    mocks.create.mockResolvedValue({ id: 'conv-restored', title: '刷新问题' });
    mocks.save.mockResolvedValue({ status: 'saved' });
    sessionStorage.setItem(
      'map-playground-conversation-draft-v2:user-1',
      JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        signature: 'pending-signature',
        payload: {
          title: '刷新问题',
          model: 'model-1',
          messages: [
            { role: 'user', content: '刷新问题' },
            { role: 'assistant', content: '刷新后仍应恢复的完整回答' },
          ],
        },
      }),
    );
    const locationRef = { current: '' };

    const { result } = renderHook(
      () => {
        const [messages, setMessages] = useState<ChatMessage[]>([]);
        const persistence = useConversationPersistence({
          messages,
          model: 'model-1',
          ownerId: 'user-1',
          ownerLoading: false,
          setMessages,
          clear: () => setMessages([]),
        });
        return { messages, persistence };
      },
      { wrapper: createWrapper(locationRef) },
    );

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages[0]?.content).toBe('刷新问题');
    expect(result.current.messages[1]?.content).toBe('刷新后仍应恢复的完整回答');
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(locationRef.current).toBe('?c=conv-restored');
  });

  it('刷新时恢复流式部分回答并标记生成已中断', async () => {
    mocks.save.mockResolvedValue({ status: 'saved' });
    sessionStorage.setItem(
      'map-playground-conversation-draft-v2:user-1',
      JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        conversationId: 'conv-existing',
        signature: 'pending-partial',
        interrupted: true,
        payload: {
          title: '刷新问题',
          model: 'model-1',
          messages: [
            { role: 'user', content: '刷新问题' },
            { role: 'assistant', content: '刷新前已经生成的部分回答' },
          ],
        },
      }),
    );
    const locationRef = { current: '' };

    const { result } = renderHook(
      () => {
        const [messages, setMessages] = useState<ChatMessage[]>([]);
        const persistence = useConversationPersistence({
          messages,
          model: 'model-1',
          ownerId: 'user-1',
          ownerLoading: false,
          setMessages,
          clear: () => setMessages([]),
        });
        return { messages, persistence };
      },
      { wrapper: createWrapper(locationRef, '/playground?c=conv-existing') },
    );

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages[1]).toMatchObject({
      role: 'assistant',
      content: '刷新前已经生成的部分回答',
      streaming: false,
      interrupted: true,
    });
    expect(mocks.getConversation).not.toHaveBeenCalled();
  });

  it('连续选择会话时忽略先发后到的旧详情响应', async () => {
    const detailA = deferred<{
      conversation: { id: string; title: string; model: string };
      messages: Array<{ id: string; role: 'user'; content: string }>;
    }>();
    const detailB = deferred<{
      conversation: { id: string; title: string; model: string };
      messages: Array<{ id: string; role: 'user'; content: string }>;
    }>();
    mocks.getConversation.mockImplementation((id: string) =>
      id === 'conv-a' ? detailA.promise : detailB.promise,
    );
    const setMessages = vi.fn();
    const locationRef = { current: '' };

    const { result } = renderHook(
      () =>
        useConversationPersistence({
          messages: [],
          model: 'model-1',
          ownerId: 'user-1',
          ownerLoading: false,
          setMessages,
          clear: vi.fn(),
        }),
      { wrapper: createWrapper(locationRef) },
    );

    act(() => {
      result.current.selectConversation('conv-a');
      result.current.selectConversation('conv-b');
    });
    await act(async () => {
      detailB.resolve({
        conversation: { id: 'conv-b', title: 'B', model: 'model-1' },
        messages: [{ id: 'b-user', role: 'user', content: 'B 问题' }],
      });
      await detailB.promise;
    });
    await waitFor(() => expect(result.current.activeConversationId).toBe('conv-b'));

    await act(async () => {
      detailA.resolve({
        conversation: { id: 'conv-a', title: 'A', model: 'model-1' },
        messages: [{ id: 'a-user', role: 'user', content: 'A 问题' }],
      });
      await detailA.promise;
    });

    expect(result.current.activeConversationId).toBe('conv-b');
    expect(setMessages).toHaveBeenCalledTimes(1);
    expect(setMessages.mock.calls[0]?.[0]?.[0]?.content).toBe('B 问题');
  });

  it('选择详情返回前新建会话时忽略迟到响应', async () => {
    const detail = deferred<{
      conversation: { id: string; title: string; model: string };
      messages: Array<{ id: string; role: 'user'; content: string }>;
    }>();
    mocks.getConversation.mockReturnValue(detail.promise);
    const setMessages = vi.fn();
    const clear = vi.fn();
    const locationRef = { current: '' };

    const { result } = renderHook(
      () =>
        useConversationPersistence({
          messages: [],
          model: 'model-1',
          ownerId: 'user-1',
          ownerLoading: false,
          setMessages,
          clear,
        }),
      { wrapper: createWrapper(locationRef) },
    );

    act(() => {
      result.current.selectConversation('conv-a');
      result.current.newChat();
    });
    await act(async () => {
      detail.resolve({
        conversation: { id: 'conv-a', title: 'A', model: 'model-1' },
        messages: [{ id: 'a-user', role: 'user', content: 'A 问题' }],
      });
      await detail.promise;
    });

    expect(result.current.activeConversationId).toBeUndefined();
    expect(setMessages).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('URL 详情加载中发送消息时创建新会话，不覆盖旧会话', async () => {
    const detail = deferred<{
      conversation: { id: string; title: string; model: string };
      messages: Array<{ id: string; role: 'user'; content: string }>;
    }>();
    mocks.getConversation.mockReturnValue(detail.promise);
    mocks.create.mockResolvedValue({ id: 'conv-new', title: '新问题' });
    mocks.save.mockResolvedValue({ status: 'saved' });
    const locationRef = { current: '' };

    const { result, rerender } = renderHook(
      ({ messages }) =>
        useConversationPersistence({
          messages,
          model: 'model-1',
          ownerId: 'user-1',
          ownerLoading: false,
          setMessages: vi.fn(),
          clear: vi.fn(),
        }),
      {
        initialProps: { messages: [] as ChatMessage[] },
        wrapper: createWrapper(locationRef, '/playground?c=conv-old'),
      },
    );

    await waitFor(() => expect(mocks.getConversation).toHaveBeenCalledWith('conv-old'));
    rerender({
      messages: [user('新问题'), assistant('', true)],
    });

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save).toHaveBeenCalledWith({
      id: 'conv-new',
      payload: {
        title: '新问题',
        model: 'model-1',
        messages: [{ role: 'user', content: '新问题' }],
      },
    });
    expect(result.current.activeConversationId).toBe('conv-new');
    expect(locationRef.current).toBe('?c=conv-new');

    await act(async () => {
      detail.resolve({
        conversation: { id: 'conv-old', title: '旧会话', model: 'model-1' },
        messages: [{ id: 'old-user', role: 'user', content: '旧问题' }],
      });
      await detail.promise;
    });
    expect(result.current.activeConversationId).toBe('conv-new');
  });

  it('最终快照保存失败后自动重试', async () => {
    vi.useFakeTimers();
    mocks.create.mockResolvedValue({ id: 'conv-1', title: '问题' });
    mocks.save.mockRejectedValueOnce(new Error('临时失败')).mockResolvedValueOnce({
      status: 'saved',
    });
    const locationRef = { current: '' };

    renderHook(
      () =>
        useConversationPersistence({
          messages: [user('问题'), assistant('完整回答', false)],
          model: 'model-1',
          ownerId: 'user-1',
          ownerLoading: false,
          setMessages: vi.fn(),
          clear: vi.fn(),
        }),
      { wrapper: createWrapper(locationRef) },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });
});
