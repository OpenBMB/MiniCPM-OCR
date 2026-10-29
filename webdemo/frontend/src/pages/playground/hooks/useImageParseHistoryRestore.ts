import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import {
  IMAGE_PARSE_DEFAULT_MODE,
  isImageParsePipelineMode,
  type ImageParseMode,
} from '@/api/map/imageParseSdk';
import type { ImageParseSource } from '@/api/map/imageParseSource';

import type { Attachment } from '../types';
import type { ImageParseLayoutBlock } from '../utils/imageParseSample';
import type { ImageParseRotationInfo } from '../utils/imageParseSample';
import { sanitizeImageParseSnapshot, type ImageParseSnapshot } from '../utils/imageParseHistory';
import { isImageParseSharedExample } from '../utils/imageParseExamples';
import type { useImageParseCrops } from './useImageParseCrops';
import type { usePdfImageParse } from './usePdfImageParse';

interface ImageParseHistoryRestoreContext {
  restoreBoundary: (mode: ImageParseMode) => void;
  generation: MutableRefObject<number>;
  pdf: ReturnType<typeof usePdfImageParse>;
  setImage: (attachment?: Attachment) => void;
  cancel: () => void;
  loadCrops: ReturnType<typeof useImageParseCrops>['loadCrops'];
  /** 图片还没有识别结果时，恢复后继续自动识别。 */
  markPending?: () => void;
}

interface ImageParseHistoryRestoreSetters {
  setMode: (mode: ImageParseMode) => void;
  setFields?: Dispatch<SetStateAction<string[]>>;
  setMarkdown: Dispatch<SetStateAction<string>>;
  setLayout: Dispatch<SetStateAction<readonly ImageParseLayoutBlock[]>>;
  setSource?: Dispatch<SetStateAction<ImageParseSource | undefined>>;
  setRotation?: Dispatch<SetStateAction<ImageParseRotationInfo | undefined>>;
  setFinished: Dispatch<SetStateAction<boolean>>;
  setResultRevision: Dispatch<SetStateAction<number>>;
}

/**
 * 恢复缓存只重建本地结果和裁图，同步取消自动执行与旧 OCR 回调。
 * @param context 当前任务范围、取消边界和 PDF 编排
 * @param setters 原始识别结果的状态写入器
 * @returns 接受快照并报告是否有效的恢复函数；后续识别使用工作台默认档位
 */
export function useImageParseHistoryRestore(
  {
    restoreBoundary,
    generation,
    pdf,
    setImage,
    cancel,
    loadCrops,
    markPending,
  }: ImageParseHistoryRestoreContext,
  {
    setMode,
    setFields,
    setMarkdown,
    setLayout,
    setSource,
    setRotation,
    setFinished,
    setResultRevision,
  }: ImageParseHistoryRestoreSetters,
) {
  // 固定共享案例快照在当前会话内不变；普通历史每次仍按不可信输入校验。
  const examples = useRef(new WeakMap<ImageParseSnapshot, ImageParseSnapshot>());
  return useCallback(
    (value: ImageParseSnapshot, options?: { previewOnly?: boolean; finished?: boolean }) => {
      const reuse = !options?.previewOnly && isImageParseSharedExample(value.attachment?.id);
      const safe =
        (reuse && examples.current.get(value)) ||
        sanitizeImageParseSnapshot(value, {
          allowHydratedFileURL: true,
          allowSharedImagePreview: options?.previewOnly === true,
        });
      if (!safe) return false;
      if (reuse) examples.current.set(value, safe);
      // 既有 LIS 档位恢复后回到默认档位；流水线档位必须保留，否则 KIE 字段与
      // 印章结果会被下一次识别当成文档解析。
      const cached = {
        ...safe,
        mode: isImageParsePipelineMode(safe.mode) ? safe.mode : IMAGE_PARSE_DEFAULT_MODE,
      };
      setImage(cached.attachment);
      cancel();
      pdf.stop();
      restoreBoundary(cached.mode);
      if (cached.pdf) pdf.restore(cached.attachment, cached.mode, cached.pdf);
      setMode(cached.mode);
      setFields?.(cached.mode === 'kie' ? [...(cached.fields ?? [])] : []);
      setMarkdown(cached.markdown);
      setLayout(cached.layout);
      // 默认档位仅影响后续解析，不能改写历史 source 中的真实模型和服务端时间。
      setSource?.(cached.source);
      setRotation?.(cached.rotation);
      const imagePending =
        !cached.pdf &&
        !options?.previewOnly &&
        !options?.finished &&
        cached.markdown === '' &&
        cached.layout.length === 0;
      setFinished(!options?.previewOnly && !imagePending);
      if (imagePending) markPending?.();
      if (!cached.pdf && !options?.previewOnly && !imagePending) {
        const run = generation.current;
        void loadCrops(
          {
            markdown: cached.markdown,
            blocks: cached.layout,
            rotation: cached.rotation,
          },
          cached.attachment.dataUrl,
          new AbortController().signal,
          () => generation.current === run,
        );
      }
      setResultRevision((value) => value + 1);
      return true;
    },
    [
      cancel,
      generation,
      loadCrops,
      markPending,
      pdf,
      restoreBoundary,
      setFinished,
      setImage,
      setLayout,
      setMarkdown,
      setMode,
      setFields,
      setResultRevision,
      setSource,
      setRotation,
    ],
  );
}
