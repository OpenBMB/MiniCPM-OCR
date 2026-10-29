import type { DriveStep } from 'driver.js';

import { exampleGatePopover } from './imageParseTourSteps';

interface ImageParseKieTourStepsOptions {
  t: (key: string, options?: Record<string, unknown>) => string;
  hasDocument?: () => boolean;
  hasResult?: () => boolean;
}

/**
 * Build the key information extraction tour: choose an example, then configure fields and start extraction, and finally check the result.
 * @param options translations and current task state
 * @returns example, fields, start-extraction, and result steps
 */
export function imageParseKieTourSteps({
  t,
  hasDocument = () => false,
  hasResult = () => false,
}: ImageParseKieTourStepsOptions): DriveStep[] {
  // Field configuration and the result both mount with the task phase; a missing target is skipped first, and the lifecycle restores it later.
  const workspaceStep = { skipMissingElement: true, waitForElement: 0 };
  const steps: DriveStep[] = [];
  if (!hasDocument()) {
    steps.push({
      ...workspaceStep,
      // After the example loads, the picker unmounts; that step is already done, and going back lets driver.js skip it instead of stopping on a mask with no target.
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
