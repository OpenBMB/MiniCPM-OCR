/**
 * conversationDraft 单测：有效期、损坏数据清理与敏感字段剥离。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '../../types';
import {
  clearConversationDraft,
  readConversationDraft,
  writeConversationDraft,
} from '../conversationDraft';
import { chatMessagesToSavePayload } from '../conversations';

const DRAFT_KEY = 'map-playground-conversation-draft-v2';

describe('conversationDraft', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('读写有效草稿并保留会话 ID', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const payload = {
      title: '问题',
      model: 'model-1',
      messages: [{ role: 'user' as const, content: '问题' }],
    };

    writeConversationDraft('user-1', {
      conversationId: 'conv-1',
      signature: 'sig-1',
      payload,
    });

    expect(readConversationDraft('user-1')).toEqual({
      version: 1,
      updatedAt: 1_000,
      conversationId: 'conv-1',
      signature: 'sig-1',
      payload,
    });
  });

  it.each([
    [
      '过期',
      JSON.stringify({
        version: 1,
        updatedAt: 1_000,
        signature: 'sig',
        payload: { messages: [{ role: 'user', content: '问题' }] },
      }),
    ],
    ['损坏', '{"version":1'],
    [
      '消息结构非法',
      JSON.stringify({
        version: 1,
        updatedAt: 25 * 60 * 60 * 1000,
        signature: 'sig',
        payload: { messages: [{ role: 'user', content: 123 }] },
      }),
    ],
  ])('%s草稿会被删除', (_label, raw) => {
    vi.spyOn(Date, 'now').mockReturnValue(25 * 60 * 60 * 1000 + 1_001);
    sessionStorage.setItem(`${DRAFT_KEY}:user-1`, raw);

    expect(readConversationDraft('user-1')).toBeUndefined();
    expect(sessionStorage.getItem(`${DRAFT_KEY}:user-1`)).toBeNull();
  });

  it('仅写入可持久化消息，不包含附件 Base64 或鉴权字段', () => {
    const message: ChatMessage & { apiKey: string; authorization: string } = {
      id: 'user-1',
      role: 'user',
      content: '识别图片',
      apiKey: 'sensitive-api-key',
      authorization: 'Bearer sensitive-token',
      attachments: [
        {
          id: 'att-1',
          kind: 'image',
          name: 'image.png',
          mime: 'image/png',
          size: 100,
          dataUrl: 'data:image/png;base64,SECRET',
          url: 'https://example.test/image.png',
        },
      ],
    };
    const payload = chatMessagesToSavePayload([message], '识别图片', 'model-1');

    writeConversationDraft('user-1', { signature: 'sig', payload });

    const raw = sessionStorage.getItem(`${DRAFT_KEY}:user-1`);
    expect(raw).toContain('https://example.test/image.png');
    expect(raw).not.toContain('data:image/png;base64');
    expect(raw).not.toContain('sensitive-api-key');
    expect(raw).not.toContain('sensitive-token');
  });

  it('不同用户不能读取或清理彼此草稿', () => {
    const payload = {
      title: '用户 A 的问题',
      messages: [{ role: 'user' as const, content: '仅用户 A 可见' }],
    };
    writeConversationDraft('user-a', { signature: 'sig-a', payload });

    expect(readConversationDraft('user-b')).toBeUndefined();
    clearConversationDraft('user-b');
    expect(readConversationDraft('user-a')?.payload).toEqual(payload);
  });

  it('可显式清理草稿', () => {
    sessionStorage.setItem(`${DRAFT_KEY}:user-1`, '{}');
    clearConversationDraft('user-1');
    expect(sessionStorage.getItem(`${DRAFT_KEY}:user-1`)).toBeNull();
  });
});
