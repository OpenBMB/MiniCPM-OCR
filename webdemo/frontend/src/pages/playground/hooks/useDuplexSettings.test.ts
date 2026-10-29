import { describe, expect, it } from 'vitest';

import {
  OFFICIAL_AUDIO_DUPLEX_ENGLISH_PROMPT,
  OFFICIAL_AUDIO_DUPLEX_PROMPT,
  promptForAudioSource,
  resolveInitialDuplexSettings,
} from './useDuplexSettings';

describe('双工官方提示词', () => {
  it('英文音频双工提示词应完整表达声音、双工模式和助手身份', () => {
    expect(OFFICIAL_AUDIO_DUPLEX_ENGLISH_PROMPT).toContain(
      'Act as an assistant with the voice characteristics described above.',
    );
    expect(OFFICIAL_AUDIO_DUPLEX_ENGLISH_PROMPT).toContain(
      'You are in duplex mode, so you can listen and speak at the same time.',
    );
    expect(OFFICIAL_AUDIO_DUPLEX_ENGLISH_PROMPT).toContain(
      'You are ModelBest Xiao Gang Pao, an AI assistant developed by ModelBest Intelligence.',
    );
  });

  it('按语言和音频模式返回对应的系统提示词', () => {
    expect(promptForAudioSource('mic', 'en').system).toBe(OFFICIAL_AUDIO_DUPLEX_ENGLISH_PROMPT);
    expect(promptForAudioSource('mic', 'zh').system).toBe(OFFICIAL_AUDIO_DUPLEX_PROMPT);
  });

  it('英文界面下将历史中文默认双工配置迁移为英文提示词', () => {
    const settings = resolveInitialDuplexSettings(
      {
        audioSource: 'mic',
        scene: 'audio_chinese_call',
        language: 'zh',
        system: OFFICIAL_AUDIO_DUPLEX_PROMPT,
      },
      'en-US',
    );

    expect(settings.language).toBe('en');
    expect(settings.scene).toBe('audio_english_call');
    expect(settings.system).toBe(OFFICIAL_AUDIO_DUPLEX_ENGLISH_PROMPT);
    expect(settings.languageMode).toBe('auto');
  });

  it('用户手动选择双工语言后不随界面语言切换', () => {
    const settings = resolveInitialDuplexSettings(
      {
        audioSource: 'mic',
        scene: 'audio_chinese_call',
        language: 'zh',
        languageMode: 'manual',
        system: OFFICIAL_AUDIO_DUPLEX_PROMPT,
      },
      'en-US',
    );

    expect(settings.language).toBe('zh');
    expect(settings.scene).toBe('audio_chinese_call');
    expect(settings.system).toBe(OFFICIAL_AUDIO_DUPLEX_PROMPT);
    expect(settings.languageMode).toBe('manual');
  });
});
