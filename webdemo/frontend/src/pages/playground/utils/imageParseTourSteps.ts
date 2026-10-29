import type { DriveStep } from 'driver.js';

/**
 * The example step also offers "Next". Clicking Next loads the first example in the current list,
 * and later steps advance through the tour lifecycle only after the document has mounted.
 */
export function exampleGatePopover(
  selector: string,
  nextLabel: string,
): NonNullable<DriveStep['popover']> {
  return {
    showButtons: ['next', 'close'],
    // When a later target has not mounted yet, driver.js treats this step as the last one and the button becomes "Get started".
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
 * Build the document-parsing tour: the empty state first lets the user pick a platform example, then introduces recognition settings and result-area capabilities.
 * @param options translations and current document state
 * @returns the choose-example, recognition-settings, recognition-box, block-edit, and export steps
 */
export function imageParseTourSteps({
  t,
  hasDocument = () => false,
}: ImageParseTourStepsOptions): DriveStep[] {
  // Recognition waiting is handled by the tour lifecycle; a missing optional target is skipped directly, so a mask is not left behind after the popover is hidden.
  const workspaceStep = { skipMissingElement: true, waitForElement: 0 };
  const steps: DriveStep[] = [];
  if (!hasDocument()) {
    steps.push({
      ...workspaceStep,
      // After the example loads, the picker unmounts; that step is already done, and going back lets driver.js skip it instead of stopping on a mask with no target.
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
      // Before parsing finishes the download button does not exist yet, so point at the stable result bar first and do not leave the tour waiting on nothing.
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
