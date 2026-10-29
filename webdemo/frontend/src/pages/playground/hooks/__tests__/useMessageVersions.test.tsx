/**
 * Unit tests for the useMessageVersions hook: regenerate orchestration and feedback/version delegation.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../types';
import { useMessageVersions } from '../useMessageVersions';

function user(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, streaming: false };
}

function assistant(id: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: 'assistant', content: '答', streaming: false, ...extra };
}

describe('useMessageVersions', () => {
  it('loading 时 regenerate 不触发 startCompletion', () => {
    const startCompletion = vi.fn();
    const setMessages = vi.fn();
    const messages = [user('u1', '问'), assistant('a1')];

    const { result } = renderHook(() =>
      useMessageVersions({
        messages,
        setMessages,
        loading: true,
        startCompletion,
      }),
    );

    act(() => {
      result.current.regenerate('a1');
    });

    expect(startCompletion).not.toHaveBeenCalled();
    expect(setMessages).not.toHaveBeenCalled();
  });

  it('regenerate 成功时准备消息并以其前历史发起补全', () => {
    const startCompletion = vi.fn();
    let state = [user('u1', '问'), assistant('a1', { content: '旧答' })];
    const setMessages = vi.fn(
      (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
        state = typeof updater === 'function' ? updater(state) : updater;
      },
    );

    const { result } = renderHook(() =>
      useMessageVersions({
        messages: state,
        setMessages,
        loading: false,
        startCompletion,
      }),
    );

    act(() => {
      result.current.regenerate('a1');
    });

    expect(startCompletion).toHaveBeenCalledWith([state[0]], 'a1');
    expect(state[1]?.streaming).toBe(true);
    expect(state[1]?.searching).toBe(false);
    expect(state[1]?.content).toBe('');
    expect(state[1]?.versions).toEqual([{ content: '旧答' }]);
  });

  it('regenerate 目标不存在时不触发', () => {
    const startCompletion = vi.fn();
    const setMessages = vi.fn();

    const { result } = renderHook(() =>
      useMessageVersions({
        messages: [user('u1', '问')],
        setMessages,
        loading: false,
        startCompletion,
      }),
    );

    act(() => {
      result.current.regenerate('missing');
    });

    expect(startCompletion).not.toHaveBeenCalled();
    expect(setMessages).not.toHaveBeenCalled();
  });

  it('setFeedback 切换顶层与当前版本 feedback', () => {
    let state = [
      assistant('a1', {
        versions: [{ content: 'v1' }, { content: 'v2' }],
        activeVersion: 1,
      }),
    ];
    const setMessages = vi.fn(
      (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
        state = typeof updater === 'function' ? updater(state) : updater;
      },
    );

    const { result } = renderHook(() =>
      useMessageVersions({
        messages: state,
        setMessages,
        loading: false,
        startCompletion: vi.fn(),
      }),
    );

    act(() => {
      result.current.setFeedback('a1', 'up');
    });
    expect(state[0]?.feedback).toBe('up');
    expect(state[0]?.versions?.[1]?.feedback).toBe('up');

    act(() => {
      result.current.setFeedback('a1', 'up');
    });
    expect(state[0]?.feedback).toBeUndefined();
  });

  it('setActiveVersion 翻页镜像版本字段', () => {
    let state = [
      assistant('a1', {
        content: '新',
        versions: [{ content: '旧' }, { content: '新' }],
        activeVersion: 1,
      }),
    ];
    const setMessages = vi.fn(
      (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
        state = typeof updater === 'function' ? updater(state) : updater;
      },
    );

    const { result } = renderHook(() =>
      useMessageVersions({
        messages: state,
        setMessages,
        loading: false,
        startCompletion: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveVersion('a1', 0);
    });
    expect(state[0]?.content).toBe('旧');
    expect(state[0]?.activeVersion).toBe(0);
  });
});
