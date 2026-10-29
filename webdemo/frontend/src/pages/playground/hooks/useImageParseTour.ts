import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { imageParseTourSteps } from '../utils/imageParseTourSteps';
import {
  useImageParseGuidedTour,
  type UseImageParseGuidedTourOptions,
} from './useImageParseGuidedTour';

/** Stable seen id for the document-parsing tour; history version records are compatible as the same family of tour. */
export const IMAGE_PARSE_TOUR_ID = 'image-parse';
const GATE_SELECTORS = ['[data-tour="image-parse-examples"]'] as const;

type UseImageParseTourOptions = Omit<
  UseImageParseGuidedTourOptions,
  'tourId' | 'gateSelectors' | 'buildSteps'
>;

/**
 * First-visit tour for document parsing; the empty state starts from a platform example, and after it is closed the replay entry does not stay on screen.
 * @param options whether it is enabled, and the current document state
 * @returns the entry that replays the tour manually
 */
export function useImageParseTour(options: UseImageParseTourOptions) {
  const { t } = useTranslation('playground');
  const buildSteps = useCallback(
    (hasDocument: () => boolean) => imageParseTourSteps({ t, hasDocument }),
    [t],
  );
  return useImageParseGuidedTour({
    ...options,
    tourId: IMAGE_PARSE_TOUR_ID,
    gateSelectors: GATE_SELECTORS,
    buildSteps,
  });
}
