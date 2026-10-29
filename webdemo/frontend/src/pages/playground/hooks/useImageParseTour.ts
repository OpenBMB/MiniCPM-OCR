import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { imageParseTourSteps } from '../utils/imageParseTourSteps';
import {
  useImageParseGuidedTour,
  type UseImageParseGuidedTourOptions,
} from './useImageParseGuidedTour';

/** 文档解析引导的稳定已读标识；历史版本记录按同族引导兼容。 */
export const IMAGE_PARSE_TOUR_ID = 'image-parse';
const GATE_SELECTORS = ['[data-tour="image-parse-examples"]'] as const;

type UseImageParseTourOptions = Omit<
  UseImageParseGuidedTourOptions,
  'tourId' | 'gateSelectors' | 'buildSteps'
>;

/**
 * 文档解析首次访问引导；空态从平台示例开始，关闭后不再常驻重播入口。
 * @param options 是否启用与当前文档状态
 * @returns 手动重播引导的入口
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
