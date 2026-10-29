import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useVoiceRecorder } from '../useVoiceRecorder';

describe('useVoiceRecorder', () => {
  let mediaDevicesDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  });

  afterEach(() => {
    if (mediaDevicesDescriptor) {
      Object.defineProperty(navigator, 'mediaDevices', mediaDevicesDescriptor);
    } else {
      Reflect.deleteProperty(navigator, 'mediaDevices');
    }
    vi.unstubAllGlobals();
  });

  it('should discard a microphone stream when recording is cancelled before permission resolves', async () => {
    let resolveStream: (stream: MediaStream) => void = () => undefined;
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveStream = resolve;
        }),
    );
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal('AudioContext', class MockAudioContext {});

    const onClip = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder(onClip));

    await act(async () => {
      void result.current.start();
      await Promise.resolve();
    });
    expect(getUserMedia).toHaveBeenCalledOnce();

    act(() => {
      result.current.cancel();
    });
    await act(async () => {
      resolveStream(stream);
      await Promise.resolve();
    });

    expect(stopTrack).toHaveBeenCalledOnce();
    expect(onClip).not.toHaveBeenCalled();
    expect(result.current.recording).toBe(false);
  });
});
