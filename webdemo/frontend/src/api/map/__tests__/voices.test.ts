import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapResourcesApi } from '../resources';

describe('voice resource API', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            requestId: 'req_voice',
            code: 0,
            message: 'success',
            data: { list: [] },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('queries user-owned voices through the portal API', async () => {
    await mapResourcesApi.voices();
    expect(fetch).toHaveBeenCalledWith(
      '/api/voices',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it('uses multipart upload without forcing a JSON content type', async () => {
    const file = new File(['RIFF0000WAVE'], 'voice.wav', { type: 'audio/wav' });
    await mapResourcesApi.createVoice(file, '客服女声');
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Headers).get('Content-Type')).toBeNull();
  });
});
