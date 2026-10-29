import type { DriveStep } from 'driver.js';

import { exampleGatePopover } from './imageParseTourSteps';

interface ImageParseKieTourStepsOptions {
  t: (key: string, options?: Record<string, unknown>) => string;
  hasDocument?: () => boolean;
  hasResult?: () => boolean;
}

/**
 * 构造关键信息抽取引导：先选择示例，再配置字段并开始抽取，最后核对结果。
 * @param options 翻译与当前任务状态
 * @returns 示例、字段、开始抽取和结果步骤
 */
export function imageParseKieTourSteps({
  t,
  hasDocument = () => false,
  hasResult = () => false,
}: ImageParseKieTourStepsOptions): DriveStep[] {
  // 字段配置和结果都会随任务阶段挂载；缺失目标先跳过，等待生命周期恢复。
  const workspaceStep = { skipMissingElement: true, waitForElement: 0 };
  const steps: DriveStep[] = [];
  if (!hasDocument()) {
    steps.push({
      ...workspaceStep,
      // 示例载入后选择区会卸载；该步骤已完成，回退时由 driver.js 跳过而不是停在无目标遮罩。
      element: '[data-tour="image-parse-kie-examples"]',
      popover: {
        title: t('imageParseKieTourExampleTitle'),
        description: t('imageParseKieTourExampleBody'),
        side: 'top',
        ...exampleGatePopover('[data-tour="image-parse-kie-examples"]', t('imageParseTourNext')),
      },
    });
  }
  if (!hasDocument() || !hasResult()) {
    steps.push(
      {
        ...workspaceStep,
        element: '[data-tour="image-parse-kie-fields"]',
        popover: {
          title: t('imageParseKieTourFieldsTitle'),
          description: t('imageParseKieTourFieldsBody'),
          side: 'bottom',
        },
      },
      {
        ...workspaceStep,
        element: '[data-tour="image-parse-kie-start"]',
        popover: {
          title: t('imageParseKieTourStartTitle'),
          description: t('imageParseKieTourStartBody'),
          side: 'left',
          align: 'start',
        },
      },
    );
  }
  steps.push({
    ...workspaceStep,
    element: '[data-pane="markdown"]',
    popover: {
      title: t('imageParseKieTourResultTitle'),
      description: t('imageParseKieTourResultBody'),
      side: 'left',
      align: 'start',
    },
  });
  return steps;
}
