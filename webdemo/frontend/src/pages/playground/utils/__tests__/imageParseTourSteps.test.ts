import { describe, expect, it, vi } from 'vitest';

import { playgroundMessages } from '@/i18n/messages/playground';
import { imageParseTourSteps } from '../imageParseTourSteps';

describe('文档解析引导', () => {
  it('空态先选择平台示例，再介绍识别设置、识别框、块编辑和导出', () => {
    const steps = imageParseTourSteps({ t: (key) => key });

    expect(steps).toHaveLength(5);
    expect(steps.map((step) => step.element)).toEqual([
      '[data-tour="image-parse-examples"]',
      '[data-tour="image-parse-recognition-settings"]',
      '[data-tour="image-parse-confidence-toggle"]',
      '[data-edit-block]',
      '[data-pane="markdown"]',
    ]);
    expect(steps[0]).toMatchObject({
      skipMissingElement: true,
      waitForElement: 0,
      popover: {
        title: 'imageParseTourExampleTitle',
        description: 'imageParseTourExampleBody',
        side: 'top',
        showButtons: ['next', 'close'],
      },
    });
    for (const step of steps.slice(1, 5)) {
      expect(step).toMatchObject({
        skipMissingElement: true,
        waitForElement: 0,
      });
    }
    expect(steps[2]?.popover).toMatchObject({ side: 'bottom' });
    expect(steps[4]?.popover).toMatchObject({ side: 'left', align: 'start' });
  });

  it('已有文档时跳过示例步骤，直接从识别设置开始', () => {
    const steps = imageParseTourSteps({
      t: (key) => key,
      hasDocument: () => true,
    });

    expect(steps).toHaveLength(4);
    expect(steps.map((step) => step.element)).toEqual([
      '[data-tour="image-parse-recognition-settings"]',
      '[data-tour="image-parse-confidence-toggle"]',
      '[data-edit-block]',
      '[data-pane="markdown"]',
    ]);
  });

  it.each(['zh-CN', 'en-US'] as const)('使用%s文案说明从平台示例开始', (language) => {
    const messages = playgroundMessages[language];
    const t = vi.fn((key: string) => {
      const value = messages[key as keyof typeof messages];
      return typeof value === 'string' ? value : key;
    });
    const steps = imageParseTourSteps({ t });

    expect(steps[0]?.popover).toMatchObject({
      title: messages.imageParseTourExampleTitle,
      description: messages.imageParseTourExampleBody,
    });
    expect(steps[4]?.popover).toMatchObject({
      title: messages.imageParseTourExportTitle,
      description: messages.imageParseTourExportBody,
    });
    if (language === 'zh-CN') {
      expect(messages.imageParseTourRecognitionSettingsBody).toContain('信息图标');
      expect(messages.imageParseTourRecognitionSettingsBody).toContain('印章和图表');
      expect(messages.imageParseTourRecognitionSettingsBody).not.toContain('旋转自适应');
      expect(messages.imageParseTourEditBody).toContain('双击');
      expect(steps.map((step) => step.popover?.title)).toEqual([
        '选择一个平台示例',
        '调整识别设置',
        '查看识别框',
        '双击块编辑',
        '带走你的成果',
      ]);
      expect(messages.imageParseTourExampleBody).toContain('示例');
      expect(messages.imageParseTourExportBody).toContain('结果栏右上角');
    } else {
      expect(messages.imageParseTourRecognitionSettingsBody).toContain('info icon');
      expect(messages.imageParseTourRecognitionSettingsBody).toContain('seal and chart');
      expect(messages.imageParseTourRecognitionSettingsBody).not.toContain('auto-rotate');
      expect(messages.imageParseTourEditBody).toContain('Double-click');
      expect(messages.imageParseTourExampleBody).toContain('sample');
      expect(messages.imageParseTourExportBody).toContain('result pane');
    }
  });
});
