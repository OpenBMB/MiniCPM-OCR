import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { imageParseKieTourSteps } from '../utils/imageParseKieTourSteps';
import {
  useImageParseGuidedTour,
  type UseImageParseGuidedTourOptions,
} from './useImageParseGuidedTour';

/** Stable seen id for the key information extraction tour; history version records are compatible as the same family of tour. */
export const IMAGE_PARSE_KIE_TOUR_ID = 'image-parse-kie';
const GATE_SELECTORS = [
  '[data-tour="image-parse-kie-examples"]',
  '[data-tour="image-parse-kie-start"]',
] as const;

type UseImageParseKieTourOptions = Omit<
  UseImageParseGuidedTourOptions,
  'tourId' | 'gateSelectors' | 'buildSteps'
> & {
  /** Used to trim steps when a result already exists, so they do not point at a field-configuration panel that has unmounted. */
  hasResult?: boolean;
};

/**
 * First-visit tour for key information extraction; after the example loads, it introduces field configuration, starting extraction, and checking the result.
 * @param options whether it is enabled, and the current task state
 * @returns the entry that replays the tour manually
 */
export function useImageParseKieTour({
  hasResult = false,
  ...options
}: UseImageParseKieTourOptions) {
  const { t } = useTranslation('playground');
  const buildSteps = useCallback(
    (hasDocument: () => boolean) =>
      imageParseKieTourSteps({ t, hasDocument, hasResult: () => hasResult }),
    [hasResult, t],
  );
  return useImageParseGuidedTour({
    ...options,
    tourId: IMAGE_PARSE_KIE_TOUR_ID,
    gateSelectors: GATE_SELECTORS,
    buildSteps,
  });
}
