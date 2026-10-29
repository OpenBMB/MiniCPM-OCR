import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { imageParseKieTourSteps } from '../utils/imageParseKieTourSteps';
import {
  useImageParseGuidedTour,
  type UseImageParseGuidedTourOptions,
} from './useImageParseGuidedTour';

/** 关键信息抽取引导的稳定已读标识；历史版本记录按同族引导兼容。 */
export const IMAGE_PARSE_KIE_TOUR_ID = 'image-parse-kie';
const GATE_SELECTORS = [
  '[data-tour="image-parse-kie-examples"]',
  '[data-tour="image-parse-kie-start"]',
] as const;

type UseImageParseKieTourOptions = Omit<
  UseImageParseGuidedTourOptions,
  'tourId' | 'gateSelectors' | 'buildSteps'
> & {
  /** 已有结果时用于裁剪步骤，避免指向已卸载的字段配置面板。 */
  hasResult?: boolean;
};

/**
 * 关键信息抽取首次访问引导；示例载入后介绍字段配置、开始抽取与结果核对。
 * @param options 是否启用与当前任务状态
 * @returns 手动重播引导的入口
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
