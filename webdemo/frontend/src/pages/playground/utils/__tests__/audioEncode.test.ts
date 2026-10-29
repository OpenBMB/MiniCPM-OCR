import { afterEach, describe, expect, it, vi } from 'vitest';
import { blobToWav16kFile } from '../audioEncode';

describe('audioEncode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('将非 WAV 音频转换为 16kHz 单声道 WAV 文件', async () => {
    const decoded = { duration: 1.25 } as AudioBuffer;
    const rendered = {
      getChannelData: () => new Float32Array([0, 0.5, -0.5]),
    } as unknown as AudioBuffer;

    class MockAudioContext {
      async decodeAudioData(): Promise<AudioBuffer> {
        return decoded;
      }

      close(): Promise<void> {
        return Promise.resolve();
      }
    }

    class MockOfflineAudioContext {
      destination = {};

      createBufferSource() {
        return {
          connect: vi.fn(),
          start: vi.fn(),
          buffer: decoded,
        };
      }

      async startRendering(): Promise<AudioBuffer> {
        return rendered;
      }
    }

    vi.stubGlobal('AudioContext', MockAudioContext);
    vi.stubGlobal('OfflineAudioContext', MockOfflineAudioContext);

    const input = new File(['fake-mp3'], 'customer-voice.mp3', { type: 'audio/mpeg' });
    const result = await blobToWav16kFile(input, 'customer-voice.wav');

    expect(result.durationSeconds).toBe(1.25);
    expect(result.file.name).toBe('customer-voice.wav');
    expect(result.file.type).toBe('audio/wav');
    expect(result.file.size).toBe(50);
  });
});
