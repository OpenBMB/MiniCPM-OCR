import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setApplicationLocale } from '@/i18n';
import { AudioWavePlayer } from './AudioWavePlayer';

vi.mock('../../utils/audioEncode', () => ({
  decodeWaveformPeaks: vi.fn(() => new Promise(() => undefined)),
}));

describe('AudioWavePlayer', () => {
  let play: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(async () => {
    await setApplicationLocale('zh-CN');
    play = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('生成结果就绪后会自动播放', () => {
    const { container } = render(<AudioWavePlayer src="blob:tts-result" autoPlay />);

    fireEvent.canPlay(container.querySelector('audio')!);

    expect(play).toHaveBeenCalledOnce();
  });

  it('自动播放被浏览器拦截时给出可操作提示', async () => {
    play.mockRejectedValueOnce(new Error('NotAllowedError'));
    const { container } = render(<AudioWavePlayer src="blob:tts-result" autoPlay />);

    fireEvent.canPlay(container.querySelector('audio')!);

    await waitFor(() =>
      expect(screen.getByText('浏览器阻止自动播放，请点击播放按钮')).toBeInTheDocument(),
    );
  });
});
