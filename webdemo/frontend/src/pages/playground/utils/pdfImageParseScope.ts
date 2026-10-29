import type { ImageParseMode } from '@/api/map/imageParseSdk';
import { isImageParseSharedExample } from './imageParseExamples';

/** PDF 识别结果所属的文件和执行参数。 */
export interface PdfParseScope {
  id?: string;
  source: string;
  mode: ImageParseMode;
  model: string;
  projectId: string;
  upright: boolean;
}

/**
 * 判断 PDF 结果能否用于当前上下文；共享案例不绑定用户的执行参数。
 * @param previous 结果范围
 * @param next 当前范围
 * @returns 结果是否仍有效
 */
export function samePdfScope(previous: PdfParseScope | undefined, next: PdfParseScope): boolean {
  return (
    previous?.id === next.id &&
    previous?.source === next.source &&
    previous?.mode === next.mode &&
    (isImageParseSharedExample(next.id ?? '') ||
      (previous?.model === next.model &&
        previous?.projectId === next.projectId &&
        previous?.upright === next.upright))
  );
}
