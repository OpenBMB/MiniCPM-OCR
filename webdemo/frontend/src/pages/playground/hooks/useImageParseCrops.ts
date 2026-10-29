import { useCallback, useState } from 'react';
import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';
import { imageParseCrops } from '../utils/imageParseCrops';

/** An original-image crop lands only while this parse is still valid; failure does not affect the text result. */
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
        // An image decode or crop failure does not affect the parsed body or block selection.
      }
    },
    [],
  );
  return { crops, clearCrops, loadCrops };
}
