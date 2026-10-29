/**
 * MAP 请求器 token 工具单测：JWT subject 仅用于客户端数据隔离。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { setApplicationLocale } from '@/i18n';
import { clearToken, getTokenSubject, mapRequest, mapUpload, setToken } from '../request';

/** 构造无需签名的测试 JWT；生产鉴权仍由服务端校验真实签名。 */
function testToken(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${encoded}.signature`;
}

describe('getTokenSubject', () => {
  afterEach(clearToken);

  it('从 Base64URL JWT payload 读取 sub', () => {
    setToken(testToken({ sub: 'user-1', role: 'user' }));
    expect(getTokenSubject()).toBe('user-1');
  });

  it.each(['', 'invalid-token', 'header.invalid.signature', testToken({ sub: 123 })])(
    '无效 token 返回空字符串',
    (token) => {
      setToken(token);
      expect(getTokenSubject()).toBe('');
    },
  );
});

describe('mapRequest', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await setApplicationLocale('zh-CN');
  });

  it('uses the active application locale for control-plane requests', async () => {
    await setApplicationLocale('en-US');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: { ok: true } }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await mapRequest('/models');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          get: expect.any(Function),
        }),
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('Accept-Language')).toBe('en-US');
  });

  it('hides an HTML gateway failure behind a retryable service error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html><title>504 Gateway Time-out</title></html>', {
          status: 504,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );

    await expect(mapRequest('/auth/config')).rejects.toThrow('服务暂时不可用，请稍后重试');
  });

  it('passes an abort signal to asset uploads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: { ok: true } }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await mapUpload('/assets/upload', new FormData(), {}, controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/assets/upload',
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
