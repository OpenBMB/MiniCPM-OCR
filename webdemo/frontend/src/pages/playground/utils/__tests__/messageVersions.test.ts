/**
 * messageVersions 纯函数单测：regenerate 上下文、准备态、反馈切换、版本翻页。
 */

import { describe, it, expect } from 'vitest';
import type { Attachment, ChatMessage } from '../../types';
import {
  applyActiveVersionSwitch,
  applyFeedbackToggle,
  applyRegeneratePrep,
  findRegenerateContext,
  prepareRegenerateMessage,
  toggleFeedbackOnMessage,
} from '../messageVersions';

function user(id: string, content: string, attachments?: Attachment[]): ChatMessage {
  return { id, role: 'user', content, streaming: false, ...(attachments ? { attachments } : {}) };
}

function assistant(id: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: 'assistant', content: '答', streaming: false, ...extra };
}

describe('findRegenerateContext', () => {
  it('找到目标且其前有 user 正文时返回 base + target', () => {
    const messages = [user('u1', '问'), assistant('a1', { content: '答' })];
    expect(findRegenerateContext(messages, 'a1')).toEqual({
      base: [messages[0]],
      target: messages[1],
    });
  });

  it('其前 user 仅附件无文字时仍视为可发送', () => {
    const att: Attachment = {
      id: 'img1',
      kind: 'image',
      name: 'a.png',
      mime: 'image/png',
      size: 1,
      dataUrl: 'data:image/png;base64,AAA',
    };
    const messages = [user('u1', '', [att]), assistant('a1')];
    expect(findRegenerateContext(messages, 'a1')?.base).toHaveLength(1);
  });

  it('找不到 assistant 或前序无可发送 user 时返回 null', () => {
    expect(findRegenerateContext([assistant('a1')], 'a1')).toBeNull();
    expect(findRegenerateContext([user('u1', '问')], 'missing')).toBeNull();
    expect(findRegenerateContext([], 'a1')).toBeNull();
  });
});

describe('prepareRegenerateMessage', () => {
  it('清空 live 字段、保留已有 versions，等待真实工具事件后再标记 searching', () => {
    const target = assistant('a1', {
      content: '旧答',
      reasoning: '想',
      citations: [{ url: 'https://ex.com' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      metrics: { durationMs: 100 },
      feedback: 'up',
      versions: [{ content: 'v1' }, { content: 'v2' }],
      activeVersion: 1,
    });
    const next = prepareRegenerateMessage(target);
    expect(next.content).toBe('');
    expect(next.reasoning).toBeUndefined();
    expect(next.citations).toBeUndefined();
    expect(next.usage).toBeUndefined();
    expect(next.metrics).toBeUndefined();
    expect(next.error).toBeUndefined();
    expect(next.feedback).toBeUndefined();
    expect(next.versions).toEqual([{ content: 'v1' }, { content: 'v2' }]);
    expect(next.streaming).toBe(true);
    expect(next.searching).toBe(false);
  });

  it('重新生成中断回答时不保留不完整版本', () => {
    const interrupted = assistant('a1', {
      content: '部分回答',
      interrupted: true,
      versions: [{ content: '部分回答', interrupted: true }],
      activeVersion: 0,
    });

    const prepared = prepareRegenerateMessage(interrupted);

    expect(prepared.versions).toEqual([]);
    expect(prepared.interrupted).toBeUndefined();
    expect(prepared.streaming).toBe(true);
  });

  it('无 versions 时补首版 snapshot', () => {
    const target = assistant('a1', { content: '首答', citations: [{ url: 'https://x.com' }] });
    const next = prepareRegenerateMessage(target);
    expect(next.versions).toEqual([{ content: '首答', citations: [{ url: 'https://x.com' }] }]);
    expect(next.searching).toBe(false);
  });
});

describe('applyRegeneratePrep', () => {
  it('只替换目标 id 的消息', () => {
    const list = [user('u1', '问'), assistant('a1', { content: '答' })];
    const prepared = prepareRegenerateMessage(list[1]);
    const next = applyRegeneratePrep(list, 'a1', prepared);
    expect(next[0]).toBe(list[0]);
    expect(next[1]?.streaming).toBe(true);
    expect(next[1]?.content).toBe('');
  });
});

describe('toggleFeedbackOnMessage / applyFeedbackToggle', () => {
  it('首次点赞写入顶层与当前版本', () => {
    const msg = assistant('a1', {
      versions: [{ content: 'v1' }, { content: 'v2' }],
      activeVersion: 1,
    });
    const next = toggleFeedbackOnMessage(msg, 'up');
    expect(next.feedback).toBe('up');
    expect(next.versions?.[1]?.feedback).toBe('up');
    expect(next.versions?.[0]?.feedback).toBeUndefined();
  });

  it('再次点击同项取消反馈', () => {
    const msg = assistant('a1', {
      feedback: 'down',
      versions: [{ content: 'v1', feedback: 'down' }],
      activeVersion: 0,
    });
    expect(toggleFeedbackOnMessage(msg, 'down').feedback).toBeUndefined();
  });

  it('赞踩互斥：从 up 切到 down', () => {
    const msg = assistant('a1', {
      feedback: 'up',
      versions: [{ content: 'v1', feedback: 'up' }],
      activeVersion: 0,
    });
    const next = toggleFeedbackOnMessage(msg, 'down');
    expect(next.feedback).toBe('down');
    expect(next.versions?.[0]?.feedback).toBe('down');
  });

  it('无 versions 时只改顶层 feedback', () => {
    const msg = assistant('a1');
    expect(applyFeedbackToggle([msg], 'a1', 'up')[0]?.feedback).toBe('up');
  });

  it('不影响其它消息', () => {
    const list = [assistant('a1'), assistant('a2')];
    const next = applyFeedbackToggle(list, 'a1', 'up');
    expect(next[1]?.feedback).toBeUndefined();
  });
});

describe('applyActiveVersionSwitch', () => {
  it('翻页后顶层镜像目标版本的 citations 与 feedback', () => {
    const list = [
      assistant('a1', {
        content: '新',
        feedback: 'up',
        versions: [
          { content: '旧', citations: [{ url: 'https://old.com' }], feedback: 'down' },
          { content: '新', feedback: 'up' },
        ],
        activeVersion: 1,
      }),
    ];
    const next = applyActiveVersionSwitch(list, 'a1', 0);
    expect(next[0]?.content).toBe('旧');
    expect(next[0]?.citations).toEqual([{ url: 'https://old.com' }]);
    expect(next[0]?.feedback).toBe('down');
    expect(next[0]?.activeVersion).toBe(0);
  });

  it('索引越界时 applyVersion 保持消息不变', () => {
    const list = [
      assistant('a1', { content: '顶层', versions: [{ content: 'v1' }], activeVersion: 0 }),
    ];
    const next = applyActiveVersionSwitch(list, 'a1', 9);
    expect(next[0]?.content).toBe('顶层');
    expect(next[0]?.activeVersion).toBe(0);
  });
});
