import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@map/store';
import { useChatCompletion } from '../useChatCompletion';
import { DEFAULT_PARAMS, type ChatMessage } from '../../types';

const streamChat = vi.fn();
const requestChat = vi.fn();
const streamPlaygroundWebSearch = vi.fn();
const runtimeContext = {
  timezone: 'Asia/Shanghai',
  locale: 'zh-CN' as const,
  utc_offset_minutes: 480,
};
const collectPlaygroundRuntimeContext = vi.fn((_locale: 'zh-CN' | 'en-US') => runtimeContext);

vi.mock('@/api/map/chat', () => ({
  streamChat: (...args: unknown[]) => streamChat(...args),
  requestChat: (...args: unknown[]) => requestChat(...args),
  streamPlaygroundWebSearch: (...args: unknown[]) => streamPlaygroundWebSearch(...args),
  ChatError: class ChatError extends Error {
    status = 0;
    code?: string;
  },
  createPlaygroundClientRequestID: () => 'client-test',
}));

vi.mock('../../utils/runtimeContext', () => ({
  collectPlaygroundRuntimeContext: (locale: 'zh-CN' | 'en-US') =>
    collectPlaygroundRuntimeContext(locale),
}));

const history: ChatMessage[] = [{ id: 'user-1', role: 'user', content: '你好' }];

beforeEach(() => {
  streamChat.mockReset();
  requestChat.mockReset();
  streamPlaygroundWebSearch.mockReset();
  collectPlaygroundRuntimeContext.mockClear();
  useAppStore.setState({ locale: 'zh-CN' });
  streamChat.mockReturnValue(new Promise<void>(() => undefined));
  streamPlaygroundWebSearch.mockReturnValue(new Promise<void>(() => undefined));
});

describe('useChatCompletion', () => {
  it('普通流式请求使用当前应用语言采集并传递运行时上下文', async () => {
    const setMessages = vi.fn();
    const { result } = renderHook(() =>
      useChatCompletion({
        setMessages,
        model: 'model-test',
        getSecret: () => 'secret-test',
        keyId: 'key-test',
        params: DEFAULT_PARAMS,
      }),
    );

    await act(async () => {
      result.current.startCompletion(history, 'assistant-1');
    });

    // This mock only forwards locale; the second argument (userLocation) is carried by the implementation itself.
    expect(collectPlaygroundRuntimeContext).toHaveBeenCalledWith('zh-CN');
    expect(streamChat.mock.calls[0]?.[5]).toEqual(runtimeContext);
  });

  it('联网请求传递同一份运行时上下文', async () => {
    const setMessages = vi.fn();
    const { result } = renderHook(() =>
      useChatCompletion({
        setMessages,
        model: 'model-test',
        getSecret: () => undefined,
        keyId: 'key-test',
        params: { ...DEFAULT_PARAMS, webSearch: true },
      }),
    );

    await act(async () => {
      result.current.startCompletion(history, 'assistant-1');
    });

    expect(streamPlaygroundWebSearch.mock.calls[0]?.[5]).toEqual(runtimeContext);
  });

  it('非流式请求传递同一份运行时上下文', async () => {
    requestChat.mockReturnValue(new Promise(() => undefined));
    const setMessages = vi.fn();
    const { result } = renderHook(() =>
      useChatCompletion({
        setMessages,
        model: 'model-test',
        getSecret: () => 'secret-test',
        keyId: 'key-test',
        params: { ...DEFAULT_PARAMS, stream: false },
      }),
    );

    await act(async () => {
      result.current.startCompletion(history, 'assistant-1');
    });

    expect(requestChat.mock.calls[0]?.[4]).toEqual(runtimeContext);
  });

  it('MiniCPM-OCR-Jev 打开流式开关时仍使用非流式请求', async () => {
    requestChat.mockReturnValue(new Promise(() => undefined));
    const setMessages = vi.fn();
    const { result } = renderHook(() =>
      useChatCompletion({
        setMessages,
        model: 'MiniCPM-OCR-Jev',
        getSecret: () => 'secret-test',
        keyId: 'key-test',
        params: DEFAULT_PARAMS,
      }),
    );

    await act(async () => {
      result.current.startCompletion(history, 'assistant-1');
    });

    expect(streamChat).not.toHaveBeenCalled();
    expect(requestChat).toHaveBeenCalledTimes(1);
  });

  it('用户停止流式请求后立即结束 loading', () => {
    const setMessages = vi.fn();
    const { result } = renderHook(() =>
      useChatCompletion({
        setMessages,
        model: 'model-test',
        getSecret: () => 'secret-test',
        keyId: 'key-test',
        params: DEFAULT_PARAMS,
      }),
    );

    act(() => {
      result.current.startCompletion(history, 'assistant-1');
    });
    expect(result.current.loading).toBe(true);

    act(() => {
      result.current.stop();
    });

    expect(result.current.loading).toBe(false);
  });

  it('旧请求的 AbortError 不会收尾新的请求', async () => {
    const rejects: Array<(reason?: unknown) => void> = [];
    streamChat.mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          rejects.push(reject);
        }),
    );
    const setMessages = vi.fn();
    const { result } = renderHook(() =>
      useChatCompletion({
        setMessages,
        model: 'model-test',
        getSecret: () => 'secret-test',
        keyId: 'key-test',
        params: DEFAULT_PARAMS,
      }),
    );

    act(() => {
      result.current.startCompletion(history, 'assistant-1');
    });
    act(() => {
      result.current.stop();
    });
    act(() => {
      result.current.startCompletion(history, 'assistant-1');
    });
    const callsAfterNewRequest = setMessages.mock.calls.length;

    await act(async () => {
      rejects[0]?.(new DOMException('The operation was aborted.', 'AbortError'));
      await Promise.resolve();
    });

    expect(setMessages).toHaveBeenCalledTimes(callsAfterNewRequest);
    expect(result.current.loading).toBe(true);
  });
});
