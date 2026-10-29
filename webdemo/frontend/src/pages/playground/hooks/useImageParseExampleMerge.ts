import { useCallback, useEffect, useState } from 'react';
import type { ImageParseSdkResult } from '@/api/map/imageParseSdk';

import type { ImageParseSnapshot } from '../utils/imageParseHistoryTypes';
import { IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED } from '../utils/imageParseFeatureFlags';
import { mergeImageParseTables } from '../utils/imageParseTableMerge';

interface ExampleMergeState {
  status: 'idle' | 'merging' | 'merged';
  /** 被合并改动过的页（0 起始） */
  pages: number[];
}

const MERGE_IDLE: ExampleMergeState = { status: 'idle', pages: [] };

/**
 * 多页示例的跨页表格合并：复用 PDF 的前端表格合并逻辑。
 * 结果只返回有变化的页，由调用方写回示例快照并从原图/结果栏重新渲染。
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

  // 切换示例时上一组的合并结果不能带到新一组页面。
  useEffect(() => {
    setState(MERGE_IDLE);
  }, [snapshots]);

  return {
    ...state,
    /** 与 PDF 合并共用构建开关；关闭时工具栏不渲染合并按钮。 */
    enabled: IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED,
    available,
    merge,
    unmerge,
  };
}
