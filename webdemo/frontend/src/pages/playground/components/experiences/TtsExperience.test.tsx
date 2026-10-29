import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canUseVoiceClone: true,
  setVoice: vi.fn(),
  useTtsSynthesis: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@map/ui', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/api/map', () => ({
  useFeatureAccessQuery: () => ({
    data: { voice_clone: mocks.canUseVoiceClone },
  }),
}));

vi.mock('../../hooks/useTtsSynthesis', () => ({
  TTS_MAX_LEN: 2000,
  useTtsSynthesis: mocks.useTtsSynthesis,
}));

vi.mock('./AudioWavePlayer', () => ({
  AudioWavePlayer: () => <div>audio</div>,
}));

vi.mock('./TtsSettingsPanel', () => ({
  TtsSettingsPanel: ({
    mode,
    onModeChange,
  }: {
    mode: 'generate' | 'clone';
    onModeChange: (mode: 'generate' | 'clone') => void;
  }) => (
    <div>
      <span data-testid="settings-mode">{mode}</span>
      <button type="button" onClick={() => onModeChange('clone')}>
        clone mode
      </button>
    </div>
  ),
}));

import { TtsExperience } from './TtsExperience';

describe('TtsExperience permission changes', () => {
  beforeEach(() => {
    mocks.canUseVoiceClone = true;
    mocks.setVoice.mockReset();
    mocks.useTtsSynthesis.mockReturnValue({
      text: '',
      setText: vi.fn(),
      savedVoices: [],
      voice: 'default',
      setVoice: mocks.setVoice,
      uploadReference: vi.fn(),
      audioUrl: undefined,
      audioFormat: 'wav',
      loading: false,
      error: undefined,
    });
  });

  it('权限被收回后整个页面回退到普通生成模式', async () => {
    const { rerender } = render(<TtsExperience model={{} as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'clone mode' }));

    expect(screen.getByRole('heading', { name: 'ttsCloneText' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('ttsClonePlaceholder')).toBeInTheDocument();

    mocks.canUseVoiceClone = false;
    rerender(<TtsExperience model={{} as never} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ttsGenerateText' })).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('ttsGeneratePlaceholder')).toBeInTheDocument();
    expect(screen.getByTestId('settings-mode')).toHaveTextContent('generate');
    expect(mocks.setVoice).toHaveBeenCalledWith('default');
  });
});
