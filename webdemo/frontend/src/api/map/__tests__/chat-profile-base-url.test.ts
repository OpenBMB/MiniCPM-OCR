import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Verify the Playground direct-to-L2 API hostname under different deploy profiles.
 * A GCP build once omitted VITE_CHAT_BASE_URL, so an empty value fell back to the Huawei Cloud .cn hostname.
 */
describe('Playground API 域名 profile 回退', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('GCP 构建缺少 VITE_CHAT_BASE_URL 时回退到 .ai API 域名', async () => {
    vi.stubEnv('VITE_AUTH_PROFILE', 'gcp');
    vi.stubEnv('VITE_CHAT_BASE_URL', '');

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      sseResponse(['data: [DONE]\n\n']),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { streamChat } = await import('../chat');
    await streamChat({ model: 'm', messages: [] }, 'secret', { onContent: vi.fn() });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.modelbest.ai/v1/chat/completions',
    );
  });

  it('legacy 构建缺少 VITE_CHAT_BASE_URL 时仍回退到 .cn API 域名', async () => {
    vi.stubEnv('VITE_AUTH_PROFILE', 'legacy');
    vi.stubEnv('VITE_CHAT_BASE_URL', '');

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      sseResponse(['data: [DONE]\n\n']),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { streamChat } = await import('../chat');
    await streamChat({ model: 'm', messages: [] }, 'secret', { onContent: vi.fn() });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.modelbest.cn/v1/chat/completions',
    );
  });
});

/** Build an SSE response that ends immediately. */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
