import { describe, expect, it, vi } from 'vitest';
import {
  fetchRefAudioDataUri,
  isSavedVoiceReady,
  resolveTtsMode,
  resolveTtsVoice,
  ttsVoicesForMode,
} from '../ttsVoices';

const savedVoice = {
  id: 'voice_123',
  name: '客服女声',
  content_type: 'audio/wav' as const,
  file_bytes: 128,
  status: 'ready' as const,
  audio_url: '/voices/voice_123/audio',
  created_at: '2026-09-03T00:00:00Z',
  updated_at: '2026-09-03T00:00:00Z',
};

describe('预置参考音色', () => {
  it('加载成功后复用缓存，避免重复请求音色素材', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([0, 1, 2]).buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchRefAudioDataUri('audio/test-cached.wav');
    const second = await fetchRefAudioDataUri('audio/test-cached.wav');

    expect(first).toBe('data:audio/wav;base64,AAEC');
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('素材加载失败时返回可恢复的用户提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    await expect(fetchRefAudioDataUri('audio/test-failure.wav')).rejects.toThrow(
      '预置音色素材加载失败，请稍后重试或改用其他音色',
    );
  });
});

describe('私有音色提交前校验', () => {
  it('列表未成功加载时不允许提交私有音色', () => {
    expect(isSavedVoiceReady('voice_123', [savedVoice], false)).toBe(false);
  });

  it('列表成功加载且命中当前用户音色时允许提交', () => {
    expect(isSavedVoiceReady('voice_123', [savedVoice], true)).toBe(true);
  });

  it('预置音色不依赖私有音色列表', () => {
    expect(isSavedVoiceReady('demo-a', [], false)).toBe(true);
  });
});

describe('音色功能权限边界', () => {
  it('未获自定义音色权限时生成模式仍保留默认和预置音色', () => {
    expect(ttsVoicesForMode('generate', false).map((voice) => voice.value)).toEqual([
      'default',
      'demo-a',
      'demo-b',
    ]);
  });

  it('上传复刻入口仅对获授权用户开放', () => {
    expect(ttsVoicesForMode('clone', false)).toEqual([]);
    expect(ttsVoicesForMode('clone', true).map((voice) => voice.value)).toEqual(['__upload__']);
  });

  it('权限动态收回后立即回退普通生成模式', () => {
    expect(resolveTtsMode('clone', false)).toBe('generate');
    expect(resolveTtsMode('clone', true)).toBe('clone');
    expect(resolveTtsMode('generate', false)).toBe('generate');
  });

  it('权限动态收回后不再提交已上传或已保存的自定义音色', () => {
    expect(resolveTtsVoice('__upload__', false, [], false)).toBe('default');
    expect(resolveTtsVoice('voice_123', false, [savedVoice], true)).toBe('default');
    expect(resolveTtsVoice('demo-a', false, [], false)).toBe('demo-a');
  });
});
