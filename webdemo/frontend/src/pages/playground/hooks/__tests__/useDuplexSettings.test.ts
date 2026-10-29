import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_AUDIO_DUPLEX_PROMPT,
  OFFICIAL_OMNI_PROMPT,
  buildDuplexSystemPrompt,
  resolveInitialDuplexSettings,
} from '../useDuplexSettings';

describe('双工设置恢复', () => {
  it('视频双工的旧音频场景配置恢复为官方 Omni 系统提示词', () => {
    const settings = resolveInitialDuplexSettings({
      audioSource: 'both',
      scene: 'audio_chinese_call',
      language: 'zh',
      system: OFFICIAL_AUDIO_DUPLEX_PROMPT,
    });

    expect(settings.audioSource).toBe('both');
    expect(settings.scene).toBe('omni_chinese_call');
    expect(settings.system).toBe(OFFICIAL_OMNI_PROMPT);
  });
});

describe('双工音色请求', () => {
  it('选择命名音色时附加真实的声音要求', () => {
    const system = buildDuplexSystemPrompt(OFFICIAL_OMNI_PROMPT, 'male_general');

    expect(system).toContain(OFFICIAL_OMNI_PROMPT);
    expect(system).toContain('沉稳');
  });

  it('英文场景追加英文声音要求', () => {
    const system = buildDuplexSystemPrompt('Streaming Omni Conversation.', 'male_general', 'en');

    expect(system).toContain('Voice requirements:');
    expect(system).toContain('steady and deep');
    expect(system).not.toContain('声音要求');
  });
});

describe('双工音色恢复', () => {
  it('恢复私有音色 ID 时回退到默认预置音色', () => {
    const settings = resolveInitialDuplexSettings({
      voice: 'voice_123',
      audioSource: 'mic',
      scene: 'audio_chinese_call',
      language: 'zh',
      system: OFFICIAL_AUDIO_DUPLEX_PROMPT,
    });

    expect(settings.voice).toBe('female_warm');
  });
});
