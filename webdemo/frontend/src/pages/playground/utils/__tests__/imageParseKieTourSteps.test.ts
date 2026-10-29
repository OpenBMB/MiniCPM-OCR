import { describe, expect, it, vi } from 'vitest';

import { playgroundMessages } from '@/i18n/messages/playground';
import { imageParseKieTourSteps } from '../imageParseKieTourSteps';

describe('关键信息抽取引导', () => {
  it('空态先选择示例，再介绍字段配置、开始抽取和结果核对', () => {
    const steps = imageParseKieTourSteps({ t: (key) => key });

    expect(steps).toHaveLength(4);
    expect(steps.map((step) => step.element)).toEqual([
      '[data-tour="image-parse-kie-examples"]',
      '[data-tour="image-parse-kie-fields"]',
      '[data-tour="image-parse-kie-start"]',
      '[data-pane="markdown"]',
    ]);
    expect(steps[0]).toMatchObject({
      skipMissingElement: true,
      waitForElement: 0,
      popover: {
        title: 'imageParseKieTourExampleTitle',
        description: 'imageParseKieTourExampleBody',
        side: 'top',
        showButtons: ['next', 'close'],
      },
    });
    for (const step of steps.slice(1)) {
      expect(step).toMatchObject({ skipMissingElement: true, waitForElement: 0 });
    }
  });

  it('已有文件但尚无结果时跳过示例，保留字段配置和开始抽取', () => {
    const steps = imageParseKieTourSteps({
      t: (key) => key,
      hasDocument: () => true,
    });

    expect(steps.map((step) => step.element)).toEqual([
      '[data-tour="image-parse-kie-fields"]',
      '[data-tour="image-parse-kie-start"]',
      '[data-pane="markdown"]',
    ]);
  });

  it('已有结果时只保留结果核对，避免指向已卸载的配置面板', () => {
    const steps = imageParseKieTourSteps({
      t: (key) => key,
      hasDocument: () => true,
      hasResult: () => true,
    });

    expect(steps).toHaveLength(1);
    expect(steps[0]?.element).toBe('[data-pane="markdown"]');
  });

  it.each(['zh-CN', 'en-US'] as const)('使用%s文案说明完整抽取流程', (language) => {
    const messages = playgroundMessages[language];
    const t = vi.fn((key: string) => {
      const value = messages[key as keyof typeof messages];
      return typeof value === 'string' ? value : key;
    });
    const steps = imageParseKieTourSteps({ t });

    expect(steps.map((step) => step.popover?.title)).toEqual([
      messages.imageParseKieTourExampleTitle,
      messages.imageParseKieTourFieldsTitle,
      messages.imageParseKieTourStartTitle,
      messages.imageParseKieTourResultTitle,
    ]);
    if (language === 'zh-CN') {
      expect(messages.imageParseKieTourExampleBody).toContain('示例');
      expect(messages.imageParseKieTourFieldsBody).toContain('列表下方');
      expect(messages.imageParseKieTourFieldsBody).not.toContain('模板');
      expect(messages.imageParseKieTourStartBody).toContain('开始抽取');
      expect(messages.imageParseKieTourResultBody).toContain('JSON');
    } else {
      expect(messages.imageParseKieTourExampleBody).toContain('sample');
      expect(messages.imageParseKieTourFieldsBody).toContain('below the list');
      expect(messages.imageParseKieTourFieldsBody).not.toContain('templates');
      expect(messages.imageParseKieTourStartBody).toContain('Start extraction');
      expect(messages.imageParseKieTourResultBody).toContain('JSON');
    }
  });
});
