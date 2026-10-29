import { useCallback, useEffect, useState } from 'react';
import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';

import type { ImageParseSnapshot } from '../utils/imageParseHistoryTypes';
import { IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED } from '../utils/imageParseFeatureFlags';
import { mergeImageParseTables } from '../utils/imageParseTableMerge';

interface ExampleMergeState {
  status: 'idle' | 'merging' | 'merged';
  /** Pages changed by a merge (0-based) */
  pages: number[];
}

const MERGE_IDLE: ExampleMergeState = { status: 'idle', pages: [] };

/**
 * Cross-page table merge for a multi-page example: reuse the PDF frontend table-merge logic.
 * The result returns only pages that changed; the caller writes them back to the example snapshot and re-renders from the original image and the result column.
 */
export function useImageParseExampleMerge(
  snapshots?: readonly ImageParseSnapshot[],
  onMerged?: (merged: Map<number, ImageParseSdkResult>) => void,
) {
  const [state, setState] = useState<ExampleMergeState>(MERGE_IDLE);
  const available = Boolean(snapshots && snapshots.length > 1);

  const merge = useCallback(async (): Promise<number> => {
    if (!snapshots || snapshots.length < 2) return 0;
    setState({ status: 'merging', pages: [] });
    try {
      const merged = mergeImageParseTables(
        snapshots.map((snapshot, index) => ({
          page: index + 1,
          result: { markdown: snapshot.markdown, blocks: snapshot.layout },
        })),
      );
      const changed = [...merged.keys()].filter((index) => Boolean(snapshots[index]));
      setState(changed.length ? { status: 'merged', pages: changed } : MERGE_IDLE);
      onMerged?.(merged);
      return [...merged.values()].reduce(
        (sum, result) => sum + result.blocks.filter((block) => block.mergedIntoPreviousPage).length,
        0,
      );
    } catch (failure) {
      setState(MERGE_IDLE);
      throw failure;
    }
  }, [snapshots, onMerged]);

  const unmerge = useCallback(() => {
    onMerged?.(new Map());
    setState(MERGE_IDLE);
  }, [onMerged]);

  // When switching examples, the previous group's merge result must not be carried onto the new group's pages.
  useEffect(() => {
    setState(MERGE_IDLE);
  }, [snapshots]);

  return {
    ...state,
    /** Shares the build flag with PDF merge; when it is off, the toolbar does not render the merge button. */
    enabled: IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED,
    available,
    merge,
    unmerge,
  };
}
