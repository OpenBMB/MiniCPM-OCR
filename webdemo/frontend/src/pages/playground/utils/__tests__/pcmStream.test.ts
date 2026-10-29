/**
 * Unit tests for pcmStream pure functions: float32 encode/decode must round-trip losslessly (no Int16 quantization), linear resampling length/endpoints must be correct,
 * and a base64 tail that is not 4-byte aligned is safely dropped. AudioContext-related classes depend on the browser audio stack and are not covered here.
 */

import { describe, expect, it, vi } from 'vitest';
import { MicCapture, resamplePcm, base64ToFloat32, float32ToBase64 } from '../pcmStream';

describe('resamplePcm', () => {
  it('同采样率返回原数组（零拷贝）', () => {
    const x = new Float32Array([0.1, 0.2, 0.3]);
    expect(resamplePcm(x, 16000, 16000)).toBe(x);
  });

  it('上采样翻倍长度、保端点', () => {
    const x = new Float32Array([0, 1, 0, -1]);
    const out = resamplePcm(x, 24000, 48000);
    expect(out.length).toBe(8);
    expect(out[0]).toBeCloseTo(0, 5);
  });

  it('下采样按比例缩短长度', () => {
    const x = new Float32Array(6).fill(0.5);
    const out = resamplePcm(x, 24000, 16000); // ratio 1.5 → round(6/1.5)=4
    expect(out.length).toBe(4);
    expect(out[0]).toBeCloseTo(0.5, 5);
  });
});

describe('float32ToBase64 ↔ base64ToFloat32', () => {
  it('往返无损（无量化）', () => {
    const x = new Float32Array([0, 0.5, -0.5, 1, -1, 0.123456]);
    const round = base64ToFloat32(float32ToBase64(x));
    expect(round.length).toBe(x.length);
    for (let i = 0; i < x.length; i += 1) expect(round[i]).toBe(x[i]);
  });

  it('对 worklet 切片出的子视图也能编出精确 buffer', () => {
    const full = new Float32Array([9, 9, 0.25, -0.75, 9, 9]);
    const view = full.subarray(2, 4); // byteOffset != 0
    const round = base64ToFloat32(float32ToBase64(view));
    expect(Array.from(round)).toEqual([0.25, -0.75]);
  });
});

describe('base64ToFloat32 对齐', () => {
  it('非 4 字节对齐时丢弃尾部字节', () => {
    // 6 bytes: the first 4 bytes = float32 1.0 (little-endian 00 00 80 3F); the trailing 2 bytes are dropped
    const b64 = btoa(String.fromCharCode(0, 0, 128, 63, 1, 2));
    const out = base64ToFloat32(b64);
    expect(out.length).toBe(1);
    expect(out[0]).toBe(1);
  });

  it('不足 4 字节返回空数组', () => {
    const b64 = btoa(String.fromCharCode(1, 2));
    expect(base64ToFloat32(b64).length).toBe(0);
  });
});

describe('MicCapture', () => {
  it('启动时恢复浏览器挂起的 AudioContext，确保 AudioWorklet 能持续产出音频块', async () => {
    const addModule = vi.fn().mockResolvedValue(undefined);
    const resume = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const source = { connect: vi.fn(), disconnect: vi.fn() };

    class FakeAudioContext {
      state = 'suspended';
      audioWorklet = { addModule };
      destination = {};

      createMediaStreamSource() {
        return source;
      }

      resume = resume;
      close = close;
    }

    class FakeAudioWorkletNode {
      port = { onmessage: null };

      disconnect = vi.fn();
    }

    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:capture-worklet'),
      revokeObjectURL: vi.fn(),
    });

    const capture = new MicCapture();
    await capture.start({} as MediaStream, vi.fn());

    expect(resume).toHaveBeenCalledOnce();
    expect(addModule).toHaveBeenCalledOnce();
    expect(source.connect).toHaveBeenCalledOnce();

    capture.stop();
  });
});
