import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { VoiceSelector } from './VoiceSelector';

const SAVED_VOICE = {
  id: 'voice_123',
  name: '客服女声',
  content_type: 'audio/wav' as const,
  file_bytes: 128,
  status: 'ready' as const,
  audio_url: '/voices/voice_123/audio',
  created_at: '2026-09-03T00:00:00Z',
  updated_at: '2026-09-03T00:00:00Z',
};

beforeAll(() => {
  // Radix Select 在真实浏览器依赖 Pointer Capture；jsdom 没有该 API，需要最小兼容垫片。
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
  HTMLElement.prototype.scrollIntoView = () => undefined;
});

describe('VoiceSelector', () => {
  it('should search and select a saved voice in the dialog', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <VoiceSelector
        value="default"
        onChange={onChange}
        presetOptions={[{ value: 'default', label: '默认音色' }]}
        savedVoices={[SAVED_VOICE]}
        ariaLabel="音色"
        searchPlaceholder="搜索音色名称或 ID"
        presetGroupLabel="预置音色"
        savedGroupLabel="我的音色"
        noResultsLabel="没有匹配的音色"
      />,
    );

    await user.click(screen.getByRole('button', { name: '音色' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeVisible();
    });
    await user.type(screen.getByRole('searchbox'), '客服');
    expect(screen.queryByRole('option', { name: '默认音色' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: /客服女声/ }));
    expect(onChange).toHaveBeenCalledWith('voice_123');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('不允许私有音色时不展示我的音色', async () => {
    const user = userEvent.setup();

    render(
      <VoiceSelector
        value="default"
        onChange={vi.fn()}
        presetOptions={[{ value: 'default', label: '默认音色' }]}
        savedVoices={[SAVED_VOICE]}
        allowSavedVoices={false}
        ariaLabel="音色"
        searchPlaceholder="搜索音色名称或 ID"
        presetGroupLabel="预置音色"
        savedGroupLabel="我的音色"
        noResultsLabel="没有匹配的音色"
      />,
    );

    await user.click(screen.getByRole('button', { name: '音色' }));
    expect(screen.getByRole('option', { name: '默认音色' })).toBeVisible();
    expect(screen.queryByRole('option', { name: /客服女声/ })).not.toBeInTheDocument();
    expect(screen.queryByText('我的音色')).not.toBeInTheDocument();
  });
});
