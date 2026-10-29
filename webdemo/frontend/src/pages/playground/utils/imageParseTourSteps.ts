import type { DriveStep } from 'driver.js';

/**
 * 示例步骤同时给出「下一步」。点下一步时载入当前列表的第一个示例，
 * 后续步骤等文档挂载后再由引导生命周期前进。
 */
export function exampleGatePopover(
  selector: string,
  nextLabel: string,
): NonNullable<DriveStep['popover']> {
  return {
    showButtons: ['next', 'close'],
    // 后面的目标还没挂载时，driver.js 会把这一步当成最后一步，按钮变成「开始使用」。
    nextBtnText: nextLabel,
    onNextClick: (_element, _step, { driver: instance }) => {
      const example = document.querySelector<HTMLButtonElement>(
        `${selector} [data-image-parse-example-grid="true"] button:not([disabled])`,
      );
      if (example) {
        example.click();
        return;
      }
      instance.moveNext();
    },
  };
}

interface ImageParseTourStepsOptions {
  t: (key: string, options?: Record<string, unknown>) => string;
  hasDocument?: () => boolean;
}

/**
 * 构造文档解析引导：空态先让用户选择平台示例，再介绍识别设置与结果区能力。
 * @param options 翻译与当前文档状态
 * @returns 选择示例、识别设置、识别框、块编辑和导出步骤
 */
export function imageParseTourSteps({
  t,
  hasDocument = () => false,
}: ImageParseTourStepsOptions): DriveStep[] {
  // 识别等待由引导生命周期处理；缺失的可选目标直接跳过，避免隐藏提示框后留下遮罩。
  const workspaceStep = { skipMissingElement: true, waitForElement: 0 };
  const steps: DriveStep[] = [];
  if (!hasDocument()) {
    steps.push({
      ...workspaceStep,
      // 示例载入后选择区会卸载；该步骤已完成，回退时由 driver.js 跳过而不是停在无目标遮罩。
      element: '[data-tour="image-parse-examples"]',
      popover: {
        title: t('imageParseTourExampleTitle'),
        description: t('imageParseTourExampleBody'),
        side: 'top',
        ...exampleGatePopover('[data-tour="image-parse-examples"]', t('imageParseTourNext')),
      },
    });
  }
  steps.push(
    {
      ...workspaceStep,
      element: '[data-tour="image-parse-recognition-settings"]',
      popover: {
        title: t('imageParseTourRecognitionSettingsTitle'),
        description: t('imageParseTourRecognitionSettingsBody'),
        side: 'bottom',
      },
    },
    {
      ...workspaceStep,
      element: '[data-tour="image-parse-confidence-toggle"]',
      popover: {
        title: t('imageParseTourOriginTitle'),
        description: t('imageParseTourOriginBody'),
        side: 'bottom',
      },
    },
    {
      ...workspaceStep,
      element: '[data-edit-block]',
      popover: {
        title: t('imageParseTourEditTitle'),
        description: t('imageParseTourEditBody'),
        side: 'left',
        align: 'start',
      },
    },
    {
      ...workspaceStep,
      // 解析完成前下载按钮尚不存在，先指向稳定的结果栏，避免引导空等。
      element: '[data-pane="markdown"]',
      popover: {
        title: t('imageParseTourExportTitle'),
        description: t('imageParseTourExportBody'),
        side: 'left',
        align: 'start',
      },
    },
  );
  return steps;
}
