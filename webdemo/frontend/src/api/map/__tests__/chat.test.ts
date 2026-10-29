import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  requestChat,
  streamChat,
  streamPlaygroundWebSearch,
  ChatError,
  type Citation,
  type TokenUsage,
  type ToolStatusEvent,
} from '../chat';

/**
 * streamPlaygroundWebSearch 的 SSE frame 分发测试：
 * 用 mock fetch 返回一段 SSE 字节流，验证 tool_status / citations / content / usage / [DONE] 与带内 error 帧的处理。
 */

/** 用给定文本片段构造一个 SSE 流式 Response（片段可跨 frame 边界，用于验证 buffer 拼接）。 */
function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

interface Captured {
  content: string;
  reasoning: string;
  citations: Citation[];
  statuses: ToolStatusEvent[];
  requestIds: string[];
  moderationAnswers: number;
  usage?: TokenUsage;
  done: boolean;
}

function makeCallbacks(): { cap: Captured; callbacks: Parameters<typeof streamPlaygroundWebSearch>[2] } {
  const cap: Captured = {
    content: '',
    reasoning: '',
    citations: [],
    statuses: [],
    requestIds: [],
    moderationAnswers: 0,
    done: false,
  };
  return {
    cap,
    callbacks: {
      onContent: (d) => {
        cap.content += d;
      },
      onReasoning: (d) => {
        cap.reasoning += d;
      },
      onCitations: (c) => {
        cap.citations.push(...c);
      },
      onToolStatus: (s) => {
        cap.statuses.push(s);
      },
      onRequestId: (requestId) => {
        cap.requestIds.push(requestId);
      },
      onModerationAnswer: () => {
        cap.moderationAnswers += 1;
      },
      onUsage: (u) => {
        cap.usage = u;
      },
      onDone: () => {
        cap.done = true;
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamPlaygroundWebSearch', () => {
  it('托管联网请求通过专用请求头传递运行时上下文，请求体不暴露该字段', async () => {
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return sseResponse(['data: [DONE]\n\n']);
      }),
    );

    const { callbacks } = makeCallbacks();
    await streamPlaygroundWebSearch(
      { model: 'm', messages: [] },
      'key-1',
      callbacks,
      undefined,
      'map_playground_0123456789abcdef0123456789abcdef',
      {
        timezone: 'Asia/Shanghai',
        locale: 'zh-CN',
        utc_offset_minutes: 480,
        location: '北京市',
      },
    );

    expect(capturedInit?.headers).toMatchObject({
      'X-Map-Playground-Timezone': 'Asia/Shanghai',
      'X-Map-Playground-Locale': 'zh-CN',
      'X-Map-Playground-UTC-Offset-Minutes': '480',
      'X-Map-Playground-Location': '北京市',
    });
    expect(JSON.parse(capturedInit?.body as string)).not.toHaveProperty('runtime_context');
  });

  it('分发 tool_status / citations / 正文 / usage 并在 [DONE] 收尾', async () => {
    const frames = [
      'event: tool_status\ndata: {"tool":"web_search","status":"running","queries":["go"]}\n\n',
      'event: citations\ndata: [{"url":"https://ex.com","title":"T"}]\n\n',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3},"choices":[]}\n\n',
      'data: [DONE]\n\n',
    ];
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return sseResponse(frames);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { cap, callbacks } = makeCallbacks();
    await streamPlaygroundWebSearch(
      { model: 'm', messages: [] },
      'key-1',
      callbacks,
      undefined,
      'map_playground_0123456789abcdef0123456789abcdef',
    );

    expect(capturedUrl).toBe('/api/playground/chat/completions');
    expect(capturedInit?.method).toBe('POST');
    // 请求体只带 api_key_id，不含明文 secret，且 stream 强制为 true
    const body = JSON.parse(capturedInit?.body as string);
    expect(body.api_key_id).toBe('key-1');
    expect(body.client_request_id).toBe('map_playground_0123456789abcdef0123456789abcdef');
    expect(body.stream).toBe(true);

    expect(cap.statuses).toHaveLength(1);
    expect(cap.statuses[0]).toMatchObject({ tool: 'web_search', status: 'running', queries: ['go'] });
    expect(cap.citations).toEqual([{ url: 'https://ex.com', title: 'T' }]);
    expect(cap.content).toBe('Hello');
    expect(cap.usage).toEqual({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
    expect(cap.done).toBe(true);
  });

  it('跨读取边界的 frame 能被正确拼接', async () => {
    // 把一个 content frame 拆成两段字节，验证 buffer 拼接
    const frames = ['data: {"choices":[{"delta":{"con', 'tent":"Hi"}}]}\n\n', 'data: [DONE]\n\n'];
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(frames)));

    const { cap, callbacks } = makeCallbacks();
    await streamPlaygroundWebSearch({ model: 'm', messages: [] }, undefined, callbacks);
    expect(cap.content).toBe('Hi');
    expect(cap.done).toBe(true);
  });

  it('接收最终模型调用的请求 ID', async () => {
    const frames = [
      'event: request_id\ndata: {"request_id":"req_web_search_final"}\n\n',
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(frames)));

    const { cap, callbacks } = makeCallbacks();
    await streamPlaygroundWebSearch({ model: 'm', messages: [] }, undefined, callbacks);

    expect(cap.requestIds).toEqual(['req_web_search_final']);
  });

  it('接收托管联网链路的安全代答事件', async () => {
    const frames = [
      'event: moderation\ndata: {"action":"answer"}\n\n',
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(frames)));

    const { cap, callbacks } = makeCallbacks();
    await streamPlaygroundWebSearch({ model: 'm', messages: [] }, undefined, callbacks);

    expect(cap.moderationAnswers).toBe(1);
  });

  it('带内 error 帧应 reject 为 ChatError 且不触发 onDone', async () => {
    const frames = ['event: error\ndata: {"message":"联网搜索请求失败"}\n\n', 'data: [DONE]\n\n'];
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(frames)));

    const { cap, callbacks } = makeCallbacks();
    await expect(streamPlaygroundWebSearch({ model: 'm', messages: [] }, 'k', callbacks)).rejects.toBeInstanceOf(ChatError);
    expect(cap.done).toBe(false);
  });

  it('HTTP 非 2xx 直接 reject 为 ChatError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['{"error":{"message":"bad"}}'], 400)));
    const { callbacks } = makeCallbacks();
    await expect(streamPlaygroundWebSearch({ model: 'm', messages: [] }, 'k', callbacks)).rejects.toBeInstanceOf(ChatError);
  });

  it('HTTP 200 的 L3 错误信封不能被当作正常 SSE 结束', async () => {
    const body = JSON.stringify({ code: 10001, message: '登录令牌缺失或无效' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );

    const { cap, callbacks } = makeCallbacks();
    await expect(streamPlaygroundWebSearch({ model: 'm', messages: [] }, 'k', callbacks)).rejects.toBeInstanceOf(ChatError);
    expect(cap.done).toBe(false);
  });

  it('未收到 [DONE] 时按流异常处理，不把半截回答标记为完成', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'])));

    const { cap, callbacks } = makeCallbacks();
    await expect(streamPlaygroundWebSearch({ model: 'm', messages: [] }, 'k', callbacks)).rejects.toBeInstanceOf(ChatError);
    expect(cap.content).toBe('partial');
    expect(cap.done).toBe(false);
  });
});

describe('streamChat', () => {
  it('透传真实结束原因供 OCR 标识限长输出', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
      'data: [DONE]\n\n',
    ])));
    const onFinishReason = vi.fn();
    const { callbacks } = makeCallbacks();
    await streamChat({ model: 'm', messages: [] }, 'test', { ...callbacks, onFinishReason });
    expect(onFinishReason).toHaveBeenCalledExactlyOnceWith('length');
  });
  it('通过专用请求头传递运行时上下文', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      sseResponse(['data: [DONE]\n\n']),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { callbacks } = makeCallbacks();
    await streamChat(
      { model: 'm', messages: [] },
      'secret',
      callbacks,
      undefined,
      'map_playground_0123456789abcdef0123456789abcdef',
      {
        timezone: 'Asia/Shanghai',
        locale: 'zh-CN',
        utc_offset_minutes: 480,
      },
    );

    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).toMatchObject({
      'X-Map-Playground-Timezone': 'Asia/Shanghai',
      'X-Map-Playground-Locale': 'zh-CN',
      'X-Map-Playground-UTC-Offset-Minutes': '480',
    });
  });

  it('默认直连正式 API 域名，而不是历史 /llm 门户代理', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => sseResponse(['data: [DONE]\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    const { callbacks } = makeCallbacks();
    await streamChat({ model: 'm', messages: [] }, 'secret', callbacks);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.modelbest.cn/v1/chat/completions');
  });

  it('从平台响应头读取请求 ID', async () => {
    const response = sseResponse(['data: [DONE]\n\n']);
    response.headers.set('X-Request-Id', 'req_direct_chat');
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response);
    vi.stubGlobal('fetch', fetchMock);

    const { cap, callbacks } = makeCallbacks();
    await streamChat(
      { model: 'm', messages: [] },
      'secret',
      callbacks,
      undefined,
      'map_playground_0123456789abcdef0123456789abcdef',
    );

    expect(cap.requestIds).toEqual(['req_direct_chat']);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).toMatchObject({
      'X-Request-Id': 'map_playground_0123456789abcdef0123456789abcdef',
    });
  });

  it('从直连 L2 响应头识别安全代答', async () => {
    const response = sseResponse(['data: [DONE]\n\n']);
    response.headers.set('X-Map-Moderation-Action', 'answer');
    vi.stubGlobal('fetch', vi.fn(async () => response));

    const { cap, callbacks } = makeCallbacks();
    await streamChat({ model: 'm', messages: [] }, 'secret', callbacks);

    expect(cap.moderationAnswers).toBe(1);
  });

  it('输出安审撤回帧会中断本轮并带出 content_policy_violation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"已经上屏的正文"}}]}\n\n',
          'event: moderation\ndata: {"action":"revoke","scope":"all","code":"content_policy_violation","message":"内容不合规，本次回答已撤回"}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );

    const { cap, callbacks } = makeCallbacks();
    await expect(streamChat({ model: 'm', messages: [] }, 'secret', callbacks)).rejects.toMatchObject(
      { code: 'content_policy_violation', message: '内容不合规，本次回答已撤回' },
    );
    // 撤回后不得再触发正常收尾，否则上层会把被撤回的正文当作完成态落库。
    expect(cap.done).toBe(false);
  });

  it('非流式调用也传递客户端关联 ID 并读取权威请求 ID', async () => {
    const response = new Response(
      JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req_direct_nonstream' } },
    );
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestChat(
      { model: 'm', messages: [] },
      'secret',
      undefined,
      'map_playground_0123456789abcdef0123456789abcdef',
    );

    expect(result.requestId).toBe('req_direct_nonstream');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).toMatchObject({
      'X-Request-Id': 'map_playground_0123456789abcdef0123456789abcdef',
    });
  });

  it('非流式调用也通过专用请求头传递运行时上下文', async () => {
    const response = new Response(
      JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response);
    vi.stubGlobal('fetch', fetchMock);

    await requestChat(
      { model: 'm', messages: [] },
      'secret',
      undefined,
      'map_playground_0123456789abcdef0123456789abcdef',
      {
        timezone: 'America/Los_Angeles',
        locale: 'en-US',
        utc_offset_minutes: -420,
      },
    );

    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).toMatchObject({
      'X-Map-Playground-Timezone': 'America/Los_Angeles',
      'X-Map-Playground-Locale': 'en-US',
      'X-Map-Playground-UTC-Offset-Minutes': '-420',
    });
  });

  it('非流式调用保留安全代答标记', async () => {
    const response = new Response(
      JSON.stringify({ choices: [{ message: { content: '安全提示' } }] }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Map-Moderation-Action': 'answer' },
      },
    );
    vi.stubGlobal('fetch', vi.fn(async () => response));

    const result = await requestChat({ model: 'm', messages: [] }, 'secret');

    expect(result.moderationAnswer).toBe(true);
  });

  it('HTTP 200 的非 SSE 错误响应应 reject，不能被当作空流完成', async () => {
    const body = JSON.stringify({ error: { message: 'proxy returned json' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );

    const { cap, callbacks } = makeCallbacks();
    await expect(streamChat({ model: 'm', messages: [] }, 'secret', callbacks)).rejects.toBeInstanceOf(ChatError);
    expect(cap.done).toBe(false);
  });

  it('直连流式安审命中时读取带内 error 帧并保留错误码', async () => {
    const frames = [
      'data: {"choices":[{"delta":{"content":"安全片段"}}]}\n\n',
      'event: error\ndata: {"error":{"code":"content_policy_violation","message":"这条内容暂时无法继续处理，换个话题试试吧。"}}\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(frames)));

    const { cap, callbacks } = makeCallbacks();
    await expect(streamChat({ model: 'm', messages: [] }, 'secret', callbacks)).rejects.toMatchObject({
      code: 'content_policy_violation',
      message: '这条内容暂时无法继续处理，换个话题试试吧。',
    });
    expect(cap.content).toBe('安全片段');
    expect(cap.done).toBe(false);
  });

  it('最终 usage 没有 [DONE] 时也按正常完成收尾', async () => {
    const frames = [
      'data: {"choices":[{"delta":{"content":"完成"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(frames)));

    const { cap, callbacks } = makeCallbacks();
    await streamChat({ model: 'm', messages: [] }, 'secret', callbacks);
    expect(cap.content).toBe('完成');
    expect(cap.done).toBe(true);
  });

  it('402 额度错误映射为可读错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: '账户余额不足，请充值后再试' } }), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const { callbacks } = makeCallbacks();
    await expect(streamChat({ model: 'm', messages: [] }, 'secret', callbacks)).rejects.toMatchObject({
      status: 402,
      message: '账户余额不足，请充值后再试',
    });
  });

  it('Nginx 504 HTML 不得作为对话内容展示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('<html><head><title>504 Gateway Time-out</title></head><body>504 Gateway Time-out</body></html>', {
          status: 504,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );

    const { callbacks } = makeCallbacks();
    await expect(streamChat({ model: 'm', messages: [] }, 'secret', callbacks)).rejects.toMatchObject({
      status: 504,
      message: '上游服务异常，请稍后再试',
    });
  });
});
