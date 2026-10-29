/**
 * 体验中心 URL 路由单测：合法体验键、加载期不回退、无可见模型时回退。
 */

import { describe, expect, it } from 'vitest';
import {
  experienceChromeCopy,
  experienceDocsPath,
  experiencePath,
  normalizeExperience,
  resolveExperience,
} from '../experienceRoute';

describe('normalizeExperience', () => {
  it('keeps known experience keys from the URL', () => {
    expect(normalizeExperience('tts')).toBe('tts');
    expect(normalizeExperience('duplex')).toBe('duplex');
    expect(normalizeExperience('document-parse')).toBe('image-parse');
    expect(normalizeExperience('image-parse')).toBe('image-parse');
    expect(normalizeExperience('field-extract')).toBe('field-extract');
  });

  it('falls back to language for missing or unknown params', () => {
    expect(normalizeExperience()).toBe('language');
    expect(normalizeExperience('unknown')).toBe('language');
  });
});

describe('resolveExperience', () => {
  it('does not fall back while models are still loading', () => {
    expect(
      resolveExperience('image-parse', true, {
        tts: false,
        duplex: false,
        'image-parse': false,
      }),
    ).toBe('image-parse');
  });

  it('falls back to language when the requested experience has no visible models', () => {
    expect(resolveExperience('tts', false, { tts: false, duplex: true, 'image-parse': true })).toBe(
      'language',
    );
    expect(
      resolveExperience('duplex', false, { tts: true, duplex: false, 'image-parse': true }),
    ).toBe('language');
    expect(
      resolveExperience('image-parse', false, {
        tts: true,
        duplex: true,
        'image-parse': false,
      }),
    ).toBe('language');
  });

  it('字段提取与全文识别共享模型权限，加载期保留字段入口', () => {
    const available = { tts: false, duplex: false, 'image-parse': false };
    expect(resolveExperience('field-extract', true, available)).toBe('field-extract');
    expect(resolveExperience('field-extract', false, available)).toBe('language');
    expect(resolveExperience('field-extract', false, { ...available, 'image-parse': true })).toBe(
      'field-extract',
    );
  });
});

describe('experiencePath', () => {
  it('keeps language on the playground root and prefixes other experiences', () => {
    expect(experiencePath('language')).toBe('/playground');
    expect(experiencePath('tts')).toBe('/playground/tts');
    expect(experiencePath('duplex')).toBe('/playground/duplex');
    expect(experiencePath('image-parse')).toBe('/playground/document-parse');
    expect(experiencePath('field-extract')).toBe('/playground/field-extract');
  });
});

describe('experienceDocsPath', () => {
  it('maps each experience to its documentation page', () => {
    expect(experienceDocsPath('language')).toBe('/docs/models/text');
    expect(experienceDocsPath('tts')).toBe('/docs/models/speech');
    expect(experienceDocsPath('duplex')).toBe('/docs/models/full-duplex');
    expect(experienceDocsPath('image-parse')).toBe('/docs/api/document-parse');
    expect(experienceDocsPath('field-extract')).toBe('/docs/api/kie');
  });
});

describe('experienceChromeCopy', () => {
  it('maps non-language experiences to their title and subtitle keys', () => {
    expect(experienceChromeCopy('tts')).toEqual({
      titleKey: 'ttsExperienceTitle',
      subtitleKey: 'ttsExperienceSubtitle',
    });
    expect(experienceChromeCopy('duplex')).toEqual({
      titleKey: 'duplexExperienceTitle',
      subtitleKey: 'duplexExperienceSubtitle',
    });
    expect(experienceChromeCopy('image-parse')).toEqual({
      titleKey: 'imageParseExperienceTitle',
      subtitleKey: 'imageParseExperienceSubtitle',
    });
  });
});
