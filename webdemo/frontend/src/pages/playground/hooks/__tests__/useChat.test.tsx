import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PARAMS } from '../../types';
import { useChat } from '../useChat';

const startCompletion = vi.fn();

vi.mock('../useChatCompletion', () => ({
  useChatCompletion: () => ({
    loading: false,
    stop: vi.fn(),
    startCompletion,
  }),
}));

vi.mock('../useMessageVersions', () => ({
  useMessageVersions: () => ({
    regenerate: vi.fn(),
    setFeedback: vi.fn(),
    setActiveVersion: vi.fn(),
  }),
}));

describe('useChat', () => {
  beforeEach(() => {
    startCompletion.mockClear();
  });

  function sendWith(webSearch: boolean) {
    const { result } = renderHook(() =>
      useChat({
        model: 'model-test',
        getSecret: () => undefined,
        keyId: 'key-test',
        params: { ...DEFAULT_PARAMS, webSearch },
      }),
    );

    act(() => {
      result.current.send('今天的天气');
    });

    return result;
  }

  it('开启联网时占位消息即刻进入搜索态，不等第一个工具事件', () => {
    // There are a few hundred milliseconds of gap from sending the request to the first tool_status; the placeholder must show the search state or there is a frame of "nothing at all"
    const result = sendWith(true);

    expect(result.current.messages[1]).toMatchObject({
      role: 'assistant',
      streaming: true,
      searching: true,
    });
    expect(startCompletion).toHaveBeenCalledOnce();
  });

  it('未开启联网时占位消息不进入搜索态', () => {
    const result = sendWith(false);

    expect(result.current.messages[1]).toMatchObject({
      role: 'assistant',
      streaming: true,
      searching: false,
    });
  });
});
