import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { synthesizeSpeech } from '../audio';

/**
 * Request-body assembly and error-mapping test for synthesizeSpeech:
 * Aligned with LIS voxcpm_speech@2 — the experience center always requests WAV SSE, aggregates the current `audio` field, and still accepts the historical
 * `delta` field, and returns the Blob the player needs only when audio.done completes. Extra-contract fields
 * (cfg/denoise/normalize) are sent only when the user changes them explicitly.
 */

/** Build a successful SSE audio response. */
function speechResponse(events?: string): Response {
  return new Response(
    events ??
      [
        'event: speech.audio.delta',
        'data: {"type":"speech.audio.delta","audio":"AQI="}',
        '',
        'event: speech.audio.done',
        'data: {"type":"speech.audio.done","usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}',
        '',
      ].join('\n'),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );
}

/** Build an OpenAI-style error response */
function errorResponse(status: number, message?: string, code?: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Read the request body and init from the latest mock fetch call */
function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  // The repo target is ES2020, so Array.prototype.at cannot be used
  const calls = fetchMock.mock.calls;
  const [, init] = calls[calls.length - 1] as [string, RequestInit];
  return { init, body: JSON.parse(init.body as string) as Record<string, unknown> };
}

const base = { model: 'tts-1', secret: 'lis_sk_x', text: '你好' };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Build a new Response on every call: a Response body can be read only once, and reusing the same instance reports unusable on the second call
  fetchMock = vi.fn().mockImplementation(() => Promise.resolve(speechResponse()));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('synthesizeSpeech 请求体', () => {
  it('voice 恒为 default——上游无命名音色库，未知音色会 4xx', async () => {
    await synthesizeSpeech({ ...base, refAudio: 'data:audio/wav;base64,AAAA' });
    expect(lastCall(fetchMock).body.voice).toBe('default');
  });

  it('私有音色使用 voice_xxx 交给平台按当前用户归属解析', async () => {
    await synthesizeSpeech({ ...base, voice: 'voice_123' });
    expect(lastCall(fetchMock).body.voice).toBe('voice_123');
    expect(lastCall(fetchMock).body.ref_audio).toBeUndefined();
  });

  it('不填写 stream，由平台强制启用 SSE 并确保终态返回官方 usage', async () => {
    await synthesizeSpeech(base);
    const { body, init } = lastCall(fetchMock);
    expect(Object.keys(body).sort()).toEqual(['input', 'model', 'response_format', 'voice']);
    expect(body.response_format).toBe('wav');
    expect(body.stream).toBeUndefined();
    expect((init.headers as Record<string, string>).Accept).toBe('text/event-stream');
  });

  it('声音描述以 (描述) 前缀注入 input', async () => {
    await synthesizeSpeech({ ...base, control: ' 温柔女声 ' });
    expect(lastCall(fetchMock).body.input).toBe('(温柔女声)你好');
  });

  it('cfg/denoise/normalize 门控：仅在显式传入时下发', async () => {
    await synthesizeSpeech({ ...base, cfg: 2.5, denoise: true, normalize: false });
    const { body } = lastCall(fetchMock);
    expect(body.cfg_value).toBe(2.5);
    expect(body.denoise).toBe(true);
    expect(body.do_normalize).toBeUndefined();
  });

  it('聚合现网 audio 片段后生成可播放 WAV', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        speechResponse(
          [
            'event: speech.audio.delta',
            'data: {"type":"speech.audio.delta","audio":"AQI="}',
            '',
            'event: speech.audio.delta',
            'data: {"type":"speech.audio.delta","audio":"AwQ="}',
            '',
            'event: speech.audio.done',
            'data: {"type":"speech.audio.done","usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}',
            '',
          ].join('\n'),
        ),
      ),
    );
    await expect(synthesizeSpeech(base)).resolves.toMatchObject({
      format: 'wav',
      objectUrl: 'blob:x',
    });
  });

  it('兼容历史 delta 音频字段', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        speechResponse(
          [
            'event: speech.audio.delta',
            'data: {"type":"speech.audio.delta","delta":"AQI="}',
            '',
            'event: speech.audio.done',
            'data: {"type":"speech.audio.done","usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}',
            '',
          ].join('\n'),
        ),
      ),
    );
    await expect(synthesizeSpeech(base)).resolves.toMatchObject({
      format: 'wav',
      objectUrl: 'blob:x',
    });
  });

  it('音频事件缺少 audio 和 delta 时明确失败', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        speechResponse(
          [
            'event: speech.audio.delta',
            'data: {"type":"speech.audio.delta"}',
            '',
            'event: speech.audio.done',
            'data: {"type":"speech.audio.done","usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}',
            '',
          ].join('\n'),
        ),
      ),
    );
    await expect(synthesizeSpeech(base)).rejects.toThrow('语音服务返回了无效的音频片段');
  });
});

describe('synthesizeSpeech 错误映射', () => {
  it('2xx 但 Content-Type 非 audio/* 也视为失败', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    );
    await expect(synthesizeSpeech(base)).rejects.toThrow();
  });

  it('没有 speech.audio.done 时拒绝残缺音频', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        speechResponse(
          [
            'event: speech.audio.delta',
            'data: {"type":"speech.audio.delta","delta":"AQI="}',
            '',
          ].join('\n'),
        ),
      ),
    );
    await expect(synthesizeSpeech(base)).rejects.toThrow(/未完成/);
  });

  it('409 指向模型能力配置，413 指向参考音频过大', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(errorResponse(409)));
    await expect(synthesizeSpeech(base)).rejects.toThrow(/不是语音合成服务/);

    fetchMock.mockImplementation(() => Promise.resolve(errorResponse(413)));
    await expect(synthesizeSpeech(base)).rejects.toThrow(/过大/);
  });

  it('优先透出上游 error.message', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(errorResponse(400, 'voice 不能为空')));
    await expect(synthesizeSpeech(base)).rejects.toThrow(/voice 不能为空/);
  });

  it('私有音色不存在时提示重新选择音色，而不是误报模型不可用', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(errorResponse(404, '音色不存在', 'voice_not_found')),
    );
    await expect(synthesizeSpeech({ ...base, voice: 'voice_missing' })).rejects.toThrow(
      '音色不存在或已失效，请重新选择',
    );
  });

  it('按错误 code 区分模型不存在与模型能力不匹配', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(errorResponse(404, '模型不可用', 'model_not_found')),
    );
    await expect(synthesizeSpeech(base)).rejects.toThrow('模型不可用，请检查模型配置');

    fetchMock.mockImplementation(() =>
      Promise.resolve(errorResponse(400, '该模型不支持语音合成', 'model_capability_mismatch')),
    );
    await expect(synthesizeSpeech(base)).rejects.toThrow('该模型不支持语音合成');
  });
});
