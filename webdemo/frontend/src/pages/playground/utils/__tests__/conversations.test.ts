/**
 * conversations 映射纯函数单测：stored↔ChatMessage 互转 + 签名。
 */

import { describe, it, expect } from 'vitest';
import type { MapStoredMessage } from '@/api/map';
import type { ChatMessage, ToolEvent } from '../../types';
import {
  chatMessagesToSavePayload,
  messagesForDraft,
  messagesSignature,
  storedToChatMessage,
} from '../conversations';

describe('storedToChatMessage', () => {
  it('基本字段映射 + 强制非流式', () => {
    const stored: MapStoredMessage = {
      id: 'm1',
      role: 'assistant',
      content: '你好',
      created_at: '2026-06-30T00:00:00Z',
    };
    expect(storedToChatMessage(stored)).toEqual({
      id: 'm1',
      role: 'assistant',
      content: '你好',
      streaming: false,
    });
  });

  it('带 reasoning 与 usage 时展开为 TokenUsage', () => {
    const stored: MapStoredMessage = {
      id: 'm2',
      role: 'assistant',
      content: '答案',
      reasoning: '思考',
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
      created_at: '2026-06-30T00:00:00Z',
    };
    const msg = storedToChatMessage(stored);
    expect(msg.reasoning).toBe('思考');
    expect(msg.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 });
  });

  it('加载历史时不向用户恢复内部工具执行日志', () => {
    const stored: MapStoredMessage = {
      id: 'm-internal-trace',
      role: 'assistant',
      content: '真实答案\n\n已读取 AnswerProcessTimeline.tsx',
      reasoning: '已查看 1 张图像\n已读取 SKILL.md',
      created_at: '2026-06-30T00:00:00Z',
    };

    expect(storedToChatMessage(stored)).toMatchObject({
      content: '真实答案',
      streaming: false,
    });
    expect(storedToChatMessage(stored).reasoning).toBeUndefined();
  });

  it('回填计时指标（首 token 延迟 / 总耗时）为 metrics', () => {
    const stored: MapStoredMessage = {
      id: 'm3',
      role: 'assistant',
      content: '答案',
      first_token_ms: 70,
      duration_ms: 410,
      created_at: '2026-06-30T00:00:00Z',
    };
    expect(storedToChatMessage(stored).metrics).toEqual({ firstTokenMs: 70, durationMs: 410 });
  });

  it('回填联网引用来源 citations', () => {
    const stored: MapStoredMessage = {
      id: 'm4',
      role: 'assistant',
      content: '答案',
      citations: [{ url: 'https://ex.com', title: 'Ex' }],
      created_at: '2026-06-30T00:00:00Z',
    };
    expect(storedToChatMessage(stored).citations).toEqual([{ url: 'https://ex.com', title: 'Ex' }]);
  });

  it('回填联网过程字段（顶层）以便刷新后折叠区重绘工具步骤', () => {
    const stored: MapStoredMessage = {
      id: 'm-web-search',
      role: 'assistant',
      content: '根据搜索结果…',
      search_step: 'synthesizing',
      search_active_tool: 'web_search',
      search_result_count: 5,
      search_browse_count: 2,
      search_queries: ['最新 AI 进展'],
      search_tools: ['web_search', 'web_extractor'],
      created_at: '2026-06-30T00:00:00Z',
    };
    const msg = storedToChatMessage(stored);
    expect(msg.searchStep).toBe('synthesizing');
    expect(msg.searchActiveTool).toBe('web_search');
    expect(msg.searchResultCount).toBe(5);
    expect(msg.searchBrowseCount).toBe(2);
    expect(msg.searchQueries).toEqual(['最新 AI 进展']);
    expect(msg.searchTools).toEqual(['web_search', 'web_extractor']);
  });

  it('回填联网过程字段（多版本 alt_versions 内嵌），applyVersion 后镜像回顶层', () => {
    const stored: MapStoredMessage = {
      id: 'm-web-search-multi',
      role: 'assistant',
      content: '当前回答',
      search_step: 'synthesizing',
      search_active_tool: 'web_extractor',
      search_tools: ['web_extractor'],
      alt_versions: [
        {
          content: '旧回答',
          search_step: 'found',
          search_active_tool: 'web_search',
          search_tools: ['web_search'],
        },
        {
          content: '当前回答',
          search_step: 'synthesizing',
          search_active_tool: 'web_extractor',
          search_tools: ['web_extractor'],
        },
      ],
      active_version: 1,
      created_at: '2026-06-30T00:00:00Z',
    };
    const msg = storedToChatMessage(stored);
    expect(msg.searchActiveTool).toBe('web_extractor');
    expect(msg.versions?.[0]?.searchActiveTool).toBe('web_search');
    expect(msg.versions?.[1]?.searchActiveTool).toBe('web_extractor');
  });

  it('回填被安审隔离的消息状态', () => {
    const stored = {
      id: 'm-blocked',
      role: 'user' as const,
      content: '被拦截的请求',
      context_excluded: true,
      created_at: '2026-06-30T00:00:00Z',
    } satisfies MapStoredMessage;

    expect(storedToChatMessage(stored)).toMatchObject({
      id: 'm-blocked',
      contextExcluded: true,
    });
  });

  it('回填当前回答及多版本的请求关联 ID', () => {
    const stored: MapStoredMessage = {
      id: 'm-request-id',
      role: 'assistant',
      content: '当前回答',
      request_id: 'req_current',
      client_request_id: 'map_playground_0123456789abcdef0123456789abcdef',
      api_key_id: '00000000-0000-0000-0000-000000000001',
      alt_versions: [
        {
          content: '旧回答',
          request_id: 'req_previous',
          client_request_id: 'map_playground_fedcba9876543210fedcba9876543210',
          api_key_id: '00000000-0000-0000-0000-000000000002',
        },
        {
          content: '当前回答',
          request_id: 'req_current',
          client_request_id: 'map_playground_0123456789abcdef0123456789abcdef',
          api_key_id: '00000000-0000-0000-0000-000000000001',
        },
      ],
      active_version: 1,
      created_at: '2026-06-30T00:00:00Z',
    };

    expect(storedToChatMessage(stored)).toMatchObject({
      requestId: 'req_current',
      clientRequestId: 'map_playground_0123456789abcdef0123456789abcdef',
      apiKeyId: '00000000-0000-0000-0000-000000000001',
      versions: [
        {
          content: '旧回答',
          requestId: 'req_previous',
          clientRequestId: 'map_playground_fedcba9876543210fedcba9876543210',
          apiKeyId: '00000000-0000-0000-0000-000000000002',
        },
        {
          content: '当前回答',
          requestId: 'req_current',
          clientRequestId: 'map_playground_0123456789abcdef0123456789abcdef',
          apiKeyId: '00000000-0000-0000-0000-000000000001',
        },
      ],
    });
  });

  it('回填附件元信息并用 url 作为刷新后的预览兜底', () => {
    const stored: MapStoredMessage = {
      id: 'm5',
      role: 'user',
      content: '识别图片',
      attachments: [
        {
          id: 'att1',
          kind: 'image',
          name: 'image.png',
          mime: 'image/png',
          size: 123,
          url: 'https://assets-hub.obs.cn-north-4.myhuaweicloud.com/map/dev/image/image.png',
          proxyUrl: '/api/assets/object/map/dev/image/image.png',
          objectKey: 'map/dev/image/image.png',
        },
      ],
      created_at: '2026-06-30T00:00:00Z',
    };
    expect(storedToChatMessage(stored).attachments).toEqual([
      {
        id: 'att1',
        kind: 'image',
        name: 'image.png',
        mime: 'image/png',
        size: 123,
        dataUrl: '/api/assets/object/map/dev/image/image.png',
        url: 'https://assets-hub.obs.cn-north-4.myhuaweicloud.com/map/dev/image/image.png',
        proxyUrl: '/api/assets/object/map/dev/image/image.png',
        objectKey: 'map/dev/image/image.png',
      },
    ]);
  });
});

describe('chatMessagesToSavePayload', () => {
  it('剥离 streaming/error，跳过空占位与错误消息', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: '问', streaming: false },
      {
        id: '2',
        role: 'assistant',
        content: '答',
        streaming: false,
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      },
      { id: '3', role: 'assistant', content: '', streaming: true }, // 空占位，跳过
      { id: '4', role: 'assistant', content: 'x', error: '失败' }, // 错误，跳过
    ];
    const payload = chatMessagesToSavePayload(messages, '标题', 'gpt');
    expect(payload.title).toBe('标题');
    expect(payload.model).toBe('gpt');
    expect(payload.messages).toEqual([
      { role: 'user', content: '问' },
      { role: 'assistant', content: '答', prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    ]);
  });

  it('持久化计时指标（四舍五入为整数毫秒）', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: '答',
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        metrics: { firstTokenMs: 70.6, durationMs: 410.2 },
      },
    ];
    const payload = chatMessagesToSavePayload(messages, '标题');
    expect(payload.messages[0]).toEqual({
      role: 'assistant',
      content: '答',
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
      first_token_ms: 71,
      duration_ms: 410,
    });
  });

  it('持久化联网引用 citations', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: '根据搜索结果…',
        citations: [{ url: 'https://ex.com', title: 'Ex' }],
      },
    ];
    const payload = chatMessagesToSavePayload(messages, '标题');
    expect(payload.messages[0]?.citations).toEqual([{ url: 'https://ex.com', title: 'Ex' }]);
  });

  it('持久化联网过程字段（单版本消息顶层）以便刷新后折叠区重绘', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: '回答',
        searchStep: 'synthesizing',
        searchActiveTool: 'web_search',
        searchResultCount: 5,
        searchBrowseCount: 2,
        searchQueries: ['最新 AI 进展'],
        searchTools: ['web_search', 'web_extractor'],
      },
    ];
    expect(chatMessagesToSavePayload(messages, '标题').messages[0]).toMatchObject({
      search_step: 'synthesizing',
      search_active_tool: 'web_search',
      search_result_count: 5,
      search_browse_count: 2,
      search_queries: ['最新 AI 进展'],
      search_tools: ['web_search', 'web_extractor'],
    });
  });

  it('持久化联网过程字段到 alt_versions（多版本回答）', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: '当前',
        searchActiveTool: 'web_extractor',
        searchTools: ['web_extractor'],
        versions: [
          {
            content: '旧',
            searchActiveTool: 'web_search',
            searchTools: ['web_search'],
          },
          {
            content: '当前',
            searchActiveTool: 'web_extractor',
            searchTools: ['web_extractor'],
          },
        ],
        activeVersion: 1,
      },
    ];
    const payload = chatMessagesToSavePayload(messages, '标题');
    expect(payload.messages[0]?.alt_versions).toMatchObject([
      { content: '旧', search_active_tool: 'web_search', search_tools: ['web_search'] },
      { content: '当前', search_active_tool: 'web_extractor', search_tools: ['web_extractor'] },
    ]);
  });

  it('保存会话时清理正文和思考中的内部工具执行日志', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: '真实答案\n\n已读取 AnswerProcessTimeline.tsx',
        reasoning: '先分析问题。\n已读取 SKILL.md',
      },
    ];

    expect(chatMessagesToSavePayload(messages, '标题').messages[0]).toMatchObject({
      role: 'assistant',
      content: '真实答案',
    });
    expect(chatMessagesToSavePayload(messages, '标题').messages[0]?.reasoning).toBeUndefined();
  });

  it('持久化被安审隔离的消息状态', () => {
    const payload = chatMessagesToSavePayload(
      [
        {
          id: 'blocked',
          role: 'user',
          content: '被拦截的请求',
          contextExcluded: true,
        },
      ],
      '标题',
    );

    expect(payload.messages).toEqual([
      { role: 'user', content: '被拦截的请求', context_excluded: true },
    ]);
  });

  it('持久化当前回答及多版本的请求关联 ID', () => {
    const messages: ChatMessage[] = [
      {
        id: 'a-request-id',
        role: 'assistant',
        content: '当前回答',
        requestId: 'req_current',
        clientRequestId: 'map_playground_0123456789abcdef0123456789abcdef',
        apiKeyId: '00000000-0000-0000-0000-000000000001',
        versions: [
          {
            content: '旧回答',
            requestId: 'req_previous',
            clientRequestId: 'map_playground_fedcba9876543210fedcba9876543210',
            apiKeyId: '00000000-0000-0000-0000-000000000002',
          },
          {
            content: '当前回答',
            requestId: 'req_current',
            clientRequestId: 'map_playground_0123456789abcdef0123456789abcdef',
            apiKeyId: '00000000-0000-0000-0000-000000000001',
          },
        ],
        activeVersion: 1,
      },
    ];

    expect(chatMessagesToSavePayload(messages, '标题').messages[0]).toMatchObject({
      request_id: 'req_current',
      client_request_id: 'map_playground_0123456789abcdef0123456789abcdef',
      api_key_id: '00000000-0000-0000-0000-000000000001',
      alt_versions: [
        {
          content: '旧回答',
          request_id: 'req_previous',
          client_request_id: 'map_playground_fedcba9876543210fedcba9876543210',
          api_key_id: '00000000-0000-0000-0000-000000000002',
        },
        {
          content: '当前回答',
          request_id: 'req_current',
          client_request_id: 'map_playground_0123456789abcdef0123456789abcdef',
          api_key_id: '00000000-0000-0000-0000-000000000001',
        },
      ],
    });
  });

  it('持久化附件 URL 元信息但不保存 base64 dataUrl', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: '识别图片',
        attachments: [
          {
            id: 'att1',
            kind: 'image',
            name: 'image.png',
            mime: 'image/png',
            size: 123,
            dataUrl: 'data:image/png;base64,AAA',
            url: 'https://assets-hub.obs.cn-north-4.myhuaweicloud.com/map/dev/image/image.png',
            proxyUrl: '/api/assets/object/map/dev/image/image.png',
            publicUrl: 'https://platform-dev.modelbest.co/api/assets/public/token',
            objectKey: 'map/dev/image/image.png',
          },
        ],
      },
    ];
    const payload = chatMessagesToSavePayload(messages, '标题');
    expect(payload.messages[0]?.attachments).toEqual([
      {
        id: 'att1',
        kind: 'image',
        name: 'image.png',
        mime: 'image/png',
        size: 123,
        url: 'https://assets-hub.obs.cn-north-4.myhuaweicloud.com/map/dev/image/image.png',
        proxyUrl: '/api/assets/object/map/dev/image/image.png',
        publicUrl: 'https://platform-dev.modelbest.co/api/assets/public/token',
        objectKey: 'map/dev/image/image.png',
      },
    ]);
  });
});

describe('messagesForDraft', () => {
  it('首 token 到达前也保留一个可重新生成的中断回答', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: '问题', streaming: false },
      { id: 'a1', role: 'assistant', content: '', streaming: true },
    ];

    expect(messagesForDraft(messages)).toEqual([
      messages[0],
      {
        ...messages[1],
        streaming: false,
        searching: false,
        interrupted: true,
      },
    ]);
  });

  it('保留首次生成中已经返回的部分正文并跳过空占位', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: '问题', streaming: false },
      {
        id: 'a1',
        role: 'assistant',
        content: '已经生成的部分回答',
        reasoning: '部分思考',
        streaming: true,
      },
    ];

    expect(messagesForDraft(messages)).toEqual([
      messages[0],
      {
        ...messages[1],
        streaming: false,
        searching: false,
        interrupted: true,
      },
    ]);
  });

  it('只有部分思考内容时也保留为中断回答', () => {
    const message: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      reasoning: '尚未输出正文的部分思考',
      streaming: true,
    };

    expect(messagesForDraft([message])).toEqual([
      {
        ...message,
        streaming: false,
        searching: false,
        interrupted: true,
      },
    ]);
  });

  it('重新生成已有部分内容时保留旧完成版本和当前中断版本', () => {
    const message: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '新回答的部分正文',
      reasoning: '新回答的部分思考',
      citations: [{ url: 'https://partial.example' }],
      streaming: true,
      versions: [{ content: '旧完整回答' }],
      activeVersion: 0,
    };

    expect(messagesForDraft([message])).toEqual([
      {
        ...message,
        streaming: false,
        searching: false,
        interrupted: true,
        versions: [
          { content: '旧完整回答' },
          {
            content: '新回答的部分正文',
            reasoning: '新回答的部分思考',
            citations: [{ url: 'https://partial.example' }],
            interrupted: true,
          },
        ],
        activeVersion: 1,
      },
    ]);
  });

  it('重新生成未完成时自动保存仍保留旧版本的工具事件', () => {
    const message: ChatMessage = {
      id: 'a-tool-version',
      role: 'assistant',
      content: '',
      streaming: true,
      versions: [
        {
          content: '旧回答',
          toolEvents: [
            {
              eventId: 'evt-old',
              step: 1,
              tool: 'web_search',
              status: 'success',
              resultCount: 3,
            },
          ],
        },
      ],
      activeVersion: 0,
    };

    expect(messagesForDraft([message])[0]?.toolEvents).toEqual([
      {
        eventId: 'evt-old',
        step: 1,
        tool: 'web_search',
        status: 'success',
        resultCount: 3,
      },
    ]);
  });
});

describe('messagesSignature', () => {
  it('内容变化时签名不同，不变时相同', () => {
    const a: ChatMessage[] = [{ id: '1', role: 'user', content: 'hi' }];
    const b: ChatMessage[] = [{ id: '1', role: 'user', content: 'hi' }];
    const c: ChatMessage[] = [{ id: '1', role: 'user', content: 'hi there' }];
    expect(messagesSignature(a)).toBe(messagesSignature(b));
    expect(messagesSignature(a)).not.toBe(messagesSignature(c));
  });

  it('工具事件原地变化也算变化（条数不变，状态或来源地址变了）', () => {
    const withEvent = (patch: Partial<ToolEvent>): ChatMessage[] => [
      {
        id: '1',
        role: 'assistant',
        content: '答案',
        toolEvents: [{ eventId: 'e1', step: 1, tool: 'web_search', status: 'running', ...patch }],
      },
    ];

    const running = messagesSignature(withEvent({}));
    const success = messagesSignature(withEvent({ status: 'success' }));
    const withUrls = messagesSignature(
      withEvent({ status: 'success', citationUrls: ['https://example.com/a'] }),
    );

    expect(running).not.toBe(success);
    expect(success).not.toBe(withUrls);
  });
});
