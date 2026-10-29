/**
 * Unit tests for toRequestMessages: multimodal attachment message construction + placeholder filtering.
 */

import { describe, it, expect } from 'vitest';
import type { Attachment, ChatMessage } from '../../types';
import {
  mergeCitations,
  toRequestMessages,
  snapshotVersion,
  applyVersion,
  findQAPair,
} from '../messages';

/** Build a test attachment */
function att(kind: Attachment['kind'], overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: `a-${kind}`,
    kind,
    name: `f.${kind}`,
    mime: `${kind}/x`,
    size: 1,
    dataUrl: `data:${kind}/x;base64,AAA`,
    ...overrides,
  };
}

describe('toRequestMessages', () => {
  it('纯文本消息保持字符串 content', () => {
    const list: ChatMessage[] = [{ id: '1', role: 'user', content: '你好' }];
    expect(toRequestMessages(list)).toEqual([{ role: 'user', content: '你好' }]);
  });

  it('带图片的用户消息构造多模态 content 数组（文本在前，图片在后）', () => {
    const list: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: '看图',
        attachments: [att('image', { mime: 'image/png', dataUrl: 'data:image/png;base64,AAA' })],
      },
    ];
    expect(toRequestMessages(list)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '看图' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
        ],
      },
    ]);
  });

  it('仅图片无文字：content 数组只含 image_url', () => {
    const list: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: '',
        attachments: [att('image', { mime: 'image/png', dataUrl: 'data:image/png;base64,BBB' })],
      },
    ];
    expect(toRequestMessages(list)).toEqual([
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,BBB' } }],
      },
    ]);
  });

  it('视频/音频/文件附件分别映射为 video_url / input_audio / file', () => {
    const list: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: '',
        attachments: [
          att('video', { mime: 'video/mp4', dataUrl: 'data:video/mp4;base64,VVV' }),
          att('audio', { mime: 'audio/mpeg', dataUrl: 'data:audio/mpeg;base64,SSS' }),
          att('file', {
            name: 'doc.pdf',
            mime: 'application/pdf',
            dataUrl: 'data:application/pdf;base64,FFF',
          }),
        ],
      },
    ];
    expect(toRequestMessages(list)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'video_url', video_url: { url: 'data:video/mp4;base64,VVV' } },
          { type: 'input_audio', input_audio: { data: 'SSS', format: 'mp3' } },
          {
            type: 'file',
            file: { filename: 'doc.pdf', file_data: 'data:application/pdf;base64,FFF' },
          },
        ],
      },
    ]);
  });

  it('跳过无正文/无附件的流式占位', () => {
    const list: ChatMessage[] = [
      { id: '1', role: 'user', content: '问' },
      { id: '2', role: 'assistant', content: '', streaming: true },
    ];
    expect(toRequestMessages(list)).toEqual([{ role: 'user', content: '问' }]);
  });

  it('不把刷新中断的部分回答继续发送给模型', () => {
    const list: ChatMessage[] = [
      { id: '1', role: 'user', content: '第一问' },
      {
        id: '2',
        role: 'assistant',
        content: '不完整回答',
        interrupted: true,
      },
      { id: '3', role: 'user', content: '第二问' },
    ];

    expect(toRequestMessages(list)).toEqual([
      { role: 'user', content: '第一问' },
      { role: 'user', content: '第二问' },
    ]);
  });

  it('保留被安审拦截的消息展示，但不将该轮再发送给模型', () => {
    const list = [
      {
        id: '1',
        role: 'user' as const,
        content: '被拦截的请求',
        contextExcluded: true,
      },
      {
        id: '2',
        role: 'assistant' as const,
        content: '这条内容暂时无法继续处理，换个话题试试吧。',
        contextExcluded: true,
      },
      { id: '3', role: 'user' as const, content: '正常继续提问' },
    ] satisfies ChatMessage[];

    expect(toRequestMessages(list)).toEqual([{ role: 'user', content: '正常继续提问' }]);
  });

  it('不把 assistant 内部工具执行日志带入下一轮请求上下文', () => {
    const list: ChatMessage[] = [
      { id: '1', role: 'user', content: '问题' },
      {
        id: '2',
        role: 'assistant',
        content: '真实回答\n\n已读取 AnswerProcessTimeline.tsx',
      },
    ];

    expect(toRequestMessages(list)).toEqual([
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '真实回答' },
    ]);
  });

  it('systemPrompt 置于最前', () => {
    const list: ChatMessage[] = [{ id: '1', role: 'user', content: '问' }];
    expect(toRequestMessages(list, '你是助手')).toEqual([
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '问' },
    ]);
  });
});

describe('mergeCitations', () => {
  it('合并并按 url 去重，同时用后续结果补全更丰富的摘要', () => {
    const prev = [{ url: 'https://a.com', title: 'A', snippet: '短摘要' }];
    const incoming = [
      { url: 'https://a.com', title: 'A 重复', snippet: '这是后续网页读取返回的更完整摘要' },
      { url: 'https://b.com', title: 'B' },
    ];
    expect(mergeCitations(prev, incoming)).toEqual([
      { url: 'https://a.com', title: 'A', snippet: '这是后续网页读取返回的更完整摘要' },
      { url: 'https://b.com', title: 'B' },
    ]);
  });

  it('prev 为空时返回 incoming 副本', () => {
    expect(mergeCitations(undefined, [{ url: 'https://c.com' }])).toEqual([
      { url: 'https://c.com' },
    ]);
  });

  it('有后端编号时以编号为身份，并按编号升序排列', () => {
    // The second search returned the item with the larger number first: if array order followed arrival order, the source panel would read as 2, then 1.
    const merged = mergeCitations(
      [{ ref: 1, url: 'https://a.com', title: 'A' }],
      [
        { ref: 3, url: 'https://c.com', title: 'C' },
        { ref: 2, url: 'https://b.com', title: 'B' },
      ],
    );
    expect(merged.map((c) => c.ref)).toEqual([1, 2, 3]);
  });

  it('同一编号视为同一来源，即使 URL 串不完全相同', () => {
    const merged = mergeCitations(
      [{ ref: 1, url: 'https://a.com/x', title: 'A' }],
      [{ ref: 1, url: 'https://a.com/x/', snippet: '网页正文摘要' }],
    );
    expect(merged).toEqual([
      { ref: 1, url: 'https://a.com/x', title: 'A', snippet: '网页正文摘要' },
    ]);
  });

  it('无编号时按归一化 URL 去重：末尾斜杠与查询参数顺序不算两条来源', () => {
    const merged = mergeCitations(
      [{ url: 'https://a.com/x?b=2&a=1', title: 'A' }],
      [{ url: 'https://a.com/x/?a=1&b=2', snippet: '同一篇' }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].snippet).toBe('同一篇');
  });
});

describe('snapshotVersion / applyVersion', () => {
  it('快照含 citations，applyVersion 镜像回顶层', () => {
    const msg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '答',
      citations: [{ url: 'https://ex.com', title: 'Ex' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      versions: [
        { content: '旧', citations: [{ url: 'https://old.com' }] },
        { content: '新', citations: [{ url: 'https://new.com' }] },
      ],
      activeVersion: 1,
    };
    const snap = snapshotVersion(msg);
    expect(snap.citations).toEqual([{ url: 'https://ex.com', title: 'Ex' }]);
    const applied = applyVersion(msg, 0);
    expect(applied.content).toBe('旧');
    expect(applied.citations).toEqual([{ url: 'https://old.com' }]);
    expect(applied.activeVersion).toBe(0);
  });

  it('反馈态写入版本快照并可镜像回顶层', () => {
    const msg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '答',
      feedback: 'up',
      versions: [{ content: '答', feedback: 'up' }],
      activeVersion: 0,
    };
    expect(snapshotVersion(msg).feedback).toBe('up');
    const toggled = applyVersion(
      {
        ...msg,
        versions: [{ content: '答', feedback: undefined }],
        feedback: undefined,
      },
      0,
    );
    expect(toggled.feedback).toBeUndefined();
  });
});

describe('findQAPair', () => {
  it('取最近 user 提问与 assistant 正文，越过分隔线停止上溯', () => {
    const list: ChatMessage[] = [
      { id: 'u0', role: 'user', content: '旧问', streaming: false },
      { id: 'd1', role: 'system', content: '', divider: true, streaming: false },
      { id: 'u1', role: 'user', content: '新问', streaming: false },
      { id: 'a1', role: 'assistant', content: '新答', streaming: false },
    ];
    expect(findQAPair(list, 'a1')).toEqual({ question: '新问', answer: '新答' });
  });
});
