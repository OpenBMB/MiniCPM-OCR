import { useImageParseKieTour } from './useImageParseKieTour';
import { useImageParseTour } from './useImageParseTour';

interface UseImageParseExperienceTourOptions {
  task: 'standard' | 'kie';
  userId?: string;
  projectId?: string;
  ready: boolean;
  hasDocument: boolean;
  standardResultReady: boolean;
  hasKieResult: boolean;
  failed: boolean;
}

/**
 * 按当前识别任务选择文档解析或关键信息抽取引导。
 * @param options 任务类型、账号状态与两类任务的就绪状态
 * @returns 当前任务的新手引导重播入口
 */
export function useImageParseExperienceTour({
  task,
  userId,
  projectId,
  ready,
  hasDocument,
  standardResultReady,
  hasKieResult,
  failed,
}: UseImageParseExperienceTourOptions) {
  const standardTour = useImageParseTour({
    userId,
    enabled: task === 'standard' && Boolean(userId && projectId),
    ready,
    hasDocument,
    resultReady: standardResultReady,
    failed,
  });
  const kieTour = useImageParseKieTour({
    userId,
    enabled: task === 'kie' && Boolean(userId && projectId),
    ready,
    hasDocument,
    // 字段配置和结果核对都属于可继续引导的阶段；错误或运行中由 ready/failed 暂停。
    hasResult: hasKieResult,
    resultReady: hasDocument && ready,
    failed,
  });
  return task === 'kie' ? kieTour : standardTour;
}
