/**
 * Unit tests for chatCompletion pure functions: auth checks and finish/abort/fail finalization,
 * plus the streaming SSE callbacks that belong to the same completion lifecycle (chatStreamCallbacks).
 */

import type { SetStateAction } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatMessage } from '../../types';
import {
  authErrorForCompletion,
  COMPLETION_KEY_ERROR,
  finalizeAbortedMessages,
  finalizeCompletedMessages,
  finalizeFailedMessages,
  markConversationTurnContextExcluded,
} from '../chatCompletion';
import { createStreamCallbacks } from '../chatStreamCallbacks';

function assistant(id: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: 'assistant', content: '', streaming: true, ...extra };
}

describe('authErrorForCompletion', () => {
  it('webSearch 无 keyId 时返回错误文案', () => {
    expect(authErrorForCompletion(true, undefined, 'sk')).toBe(COMPLETION_KEY_ERROR);
  });

  it('非 webSearch 无 secret 时返回错误文案', () => {
    expect(authErrorForCompletion(false, 'key-1', undefined)).toBe(COMPLETION_KEY_ERROR);
  });

  it('条件满足时返回 null', () => {
    expect(authErrorForCompletion(true, 'key-1')).toBeNull();
    expect(authErrorForCompletion(false, undefined, 'sk')).toBeNull();
  });
});

describe('finalizeAbortedMessages', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('首次生成 abort 不写入 versions', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const list = [assistant('a1', { content: 'partial', streaming: true })];
    const next = finalizeAbortedMessages(list, 'a1', 900);
    expect(next[0]?.versions).toBeUndefined();
    expect(next[0]?.content).toBe('partial');
    expect(next[0]?.streaming).toBe(false);
  });

  it('重新生成 abort 回退到末个已完成版本', () => {
    vi.spyOn(performance, 'now').mockReturnValue(2000);
    const list = [
      assistant('a1', {
        content: 'partial-new',
        streaming: true,
        versions: [{ content: 'v1' }, { content: 'v2' }],
        activeVersion: 1,
      }),
    ];
    const next = finalizeAbortedMessages(list, 'a1', 1500);
    expect(next[0]?.content).toBe('v2');
    expect(next[0]?.streaming).toBe(false);
    expect(next[0]?.versions).toHaveLength(2);
  });
});

describe('finalizeCompletedMessages', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finish 会把 citations/usage/metrics 快照进 versions', () => {
    vi.spyOn(performance, 'now').mockReturnValue(5300);
    const list = [
      assistant('a1', {
        content: '答',
        citations: [{ url: 'https://ex.com', title: 'Ex' }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        metrics: { firstTokenMs: 70 },
        streaming: true,
      }),
    ];
    const next = finalizeCompletedMessages(list, 'a1', 5000);
    expect(next[0]?.versions).toHaveLength(1);
    expect(next[0]?.versions?.[0]).toMatchObject({
      content: '答',
      citations: [{ url: 'https://ex.com', title: 'Ex' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      metrics: expect.objectContaining({ firstTokenMs: 70, durationMs: 300 }),
    });
    expect(next[0]?.activeVersion).toBe(0);
  });
});

describe('createStreamCallbacks', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Test translation stub: echo the key so assertions do not depend on a specific translation. */
  const translate = (key: string) => key;

  it('保留联网搜索真实查询词供过程区展示', () => {
    const setMessages = vi.fn();
    const callbacks = createStreamCallbacks({
      assistantId: 'assistant-1',
      webSearch: true,
      t: translate,
      isActive: () => true,
      markFirstToken: vi.fn(),
      onDone: vi.fn(),
      onRequestId: vi.fn(),
      setMessages,
    });

    callbacks.onToolStatus?.({
      tool: 'web_search',
      status: 'running',
      queries: ['北京天气', '上海天气'],
    });

    const updater = setMessages.mock.calls[0]?.[0] as (messages: ChatMessage[]) => ChatMessage[];
    const result = updater([assistant('assistant-1')]);

    expect(result[0]?.searchQueries).toEqual(['北京天气', '上海天气']);
    expect(result[0]?.searchTools).toEqual(['web_search']);
  });

  it('联网模式在收到真实工具事件前不伪造搜索阶段', () => {
    vi.useFakeTimers();
    let messages = [assistant('assistant-1', { searching: false })];
    const setMessages = vi.fn((update: SetStateAction<ChatMessage[]>) => {
      messages = typeof update === 'function' ? update(messages) : update;
    });
    const callbacks = createStreamCallbacks({
      assistantId: 'assistant-1',
      webSearch: true,
      t: translate,
      isActive: () => true,
      markFirstToken: vi.fn(),
      onDone: vi.fn(),
      onRequestId: vi.fn(),
      setMessages,
    });

    callbacks.onContent('直接回答');
    vi.advanceTimersByTime(16);

    expect(messages[0]?.content).toBe('直');
    expect(messages[0]?.searching).toBe(false);
    expect(messages[0]?.searchStep).toBeUndefined();
    expect(messages[0]?.searchTools).toBeUndefined();
  });

  it('开了联网但模型没调工具时，正文一到就收掉 searching', () => {
    vi.useFakeTimers();
    // useChat's placeholder message is searching: true when web search is on; reproduce that frame here
    let messages = [assistant('assistant-1', { searching: true })];
    const setMessages = vi.fn((update: SetStateAction<ChatMessage[]>) => {
      messages = typeof update === 'function' ? update(messages) : update;
    });
    const callbacks = createStreamCallbacks({
      assistantId: 'assistant-1',
      webSearch: true,
      t: translate,
      isActive: () => true,
      markFirstToken: vi.fn(),
      onDone: vi.fn(),
      onRequestId: vi.fn(),
      setMessages,
    });

    callbacks.onContent('直接回答');
    vi.advanceTimersByTime(16);

    expect(messages[0]?.searching).toBe(false);
  });

  it('网页浏览事件单独记录浏览数量且不覆盖搜索结果数量', () => {
    let messages = [assistant('assistant-1', { searchResultCount: 7 })];
    const setMessages = vi.fn((update: SetStateAction<ChatMessage[]>) => {
      messages = typeof update === 'function' ? update(messages) : update;
    });
    const callbacks = createStreamCallbacks({
      assistantId: 'assistant-1',
      webSearch: true,
      t: translate,
      isActive: () => true,
      markFirstToken: vi.fn(),
      onDone: vi.fn(),
      onRequestId: vi.fn(),
      setMessages,
    });

    callbacks.onToolStatus?.({
      tool: 'web_extractor',
      status: 'running',
      urls: ['https://one.example', 'https://two.example'],
    });

    expect(messages[0]?.searchActiveTool).toBe('web_extractor');
    expect(messages[0]?.searchBrowseCount).toBe(2);
    expect(messages[0]?.searchResultCount).toBe(7);
  });
});

describe('finalizeFailedMessages', () => {
  it('安审拦截会隔离该轮用户输入和平台提示，但不删除消息', () => {
    const next = finalizeFailedMessages(
      [{ id: 'u1', role: 'user', content: '被拦截的请求' }, assistant('a1')],
      'a1',
      '这条内容暂时无法继续处理，换个话题试试吧。',
      'content_policy_violation',
    );
    expect(next).toEqual([
      {
        id: 'u1',
        role: 'user',
        content: '被拦截的请求',
        contextExcluded: true,
      },
      {
        id: 'a1',
        role: 'assistant',
        content: '这条内容暂时无法继续处理，换个话题试试吧。',
        reasoning: undefined,
        citations: undefined,
        streaming: false,
        searching: false,
        searchStatus: '',
        contextExcluded: true,
        errorCode: 'content_policy_violation',
      },
    ]);
  });

  it('输出安审撤回会清空已经上屏的正文与思考', () => {
    const next = finalizeFailedMessages(
      [
        { id: 'u1', role: 'user', content: '提问' },
        {
          id: 'a1',
          role: 'assistant',
          content: '已经流式渲染出来的违规正文',
          reasoning: '已经流式渲染出来的思考',
          citations: [{ url: 'https://ex.com' }],
          streaming: true,
        },
      ],
      'a1',
      '内容不合规，本次回答已撤回',
      'content_policy_violation',
    );
    const assistantMessage = next[1];
    expect(assistantMessage?.content).toBe('内容不合规，本次回答已撤回');
    expect(assistantMessage?.reasoning).toBeUndefined();
    expect(assistantMessage?.citations).toBeUndefined();
    expect(assistantMessage?.contextExcluded).toBe(true);
    expect(assistantMessage?.streaming).toBe(false);
  });

  it('安审拦截不误隔离此前已经完成的历史轮次', () => {
    const next = finalizeFailedMessages(
      [
        { id: 'u1', role: 'user', content: '正常问题' },
        { id: 'a0', role: 'assistant', content: '正常回答' },
        { id: 'u2', role: 'user', content: '被拦截的请求' },
        assistant('a1'),
      ],
      'a1',
      '这条内容暂时无法继续处理，换个话题试试吧。',
      'content_policy_violation',
    );

    expect(next[0]?.contextExcluded).toBeUndefined();
    expect(next[1]?.contextExcluded).toBeUndefined();
    expect(next[2]?.contextExcluded).toBe(true);
    expect(next[3]?.contextExcluded).toBe(true);
  });

  it('普通失败仍保留错误信息', () => {
    const next = finalizeFailedMessages([assistant('a1')], 'a1', '服务异常', 'upstream_error');
    expect(next[0]).toMatchObject({
      error: '服务异常',
      errorCode: 'upstream_error',
    });
  });

  it('有历史版本时失败回退，不新增 error', () => {
    const list = [
      assistant('a1', {
        content: '',
        streaming: true,
        versions: [{ content: 'ok' }],
        activeVersion: 0,
      }),
    ];
    const next = finalizeFailedMessages(list, 'a1', 'boom');
    expect(next[0]?.content).toBe('ok');
    expect(next[0]?.error).toBeUndefined();
  });
});

describe('markConversationTurnContextExcluded', () => {
  it('安全代答成功时也隔离当前问答轮', () => {
    const next = markConversationTurnContextExcluded(
      [
        { id: 'u1', role: 'user', content: '正常问题' },
        { id: 'a0', role: 'assistant', content: '正常回答' },
        { id: 'u2', role: 'user', content: '触发安全代答的请求' },
        assistant('a1'),
      ],
      'a1',
    );

    expect(next[0]?.contextExcluded).toBeUndefined();
    expect(next[1]?.contextExcluded).toBeUndefined();
    expect(next[2]?.contextExcluded).toBe(true);
    expect(next[3]?.contextExcluded).toBe(true);
  });
});
