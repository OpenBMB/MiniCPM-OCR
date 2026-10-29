import { useCallback, useState } from 'react';
import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';
import { imageParseCrops } from '../utils/imageParseCrops';

/** 原图裁图只在本次解析有效时落地；失败不影响文字结果。 */
export function useImageParseCrops() {
  const [crops, setCrops] = useState<readonly string[]>([]);
  const clearCrops = useCallback(() => setCrops([]), []);
  const loadCrops = useCallback(
    async (
      result: ImageParseSdkResult,
      original: string,
      signal: AbortSignal,
      isCurrent: () => boolean,
    ) => {
      try {
        const next = await imageParseCrops(
          result.markdown,
          result.blocks,
          original,
          signal,
          result.rotation,
          { allPictures: true },
        );
        if (isCurrent()) setCrops(next);
      } catch {
        // 图片解码/裁切失败不影响解析正文与区块选择。
      }
    },
    [],
  );
  return { crops, clearCrops, loadCrops };
}
