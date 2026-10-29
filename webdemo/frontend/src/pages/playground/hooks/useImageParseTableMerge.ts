import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import type { ImageParseLayoutBlock } from '../utils/imageParseSample';
import { IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED } from '../utils/imageParseFeatureFlags';
import {
  hasMergableImageParseTables,
  mergeImageParseTablesInPage,
} from '../utils/imageParseTableMerge';

/** 单图表格合并状态。pages 保留给共用工具栏类型，单图没有页码。 */
export interface ImageParseTableMergeState {
  status: 'idle' | 'merging' | 'merged';
  pages: readonly number[];
}

interface ImageParseTableMergeOptions {
  enabled: boolean;
  markdown: string;
  layout: readonly ImageParseLayoutBlock[];
  setMarkdown: Dispatch<SetStateAction<string>>;
  setLayout: Dispatch<SetStateAction<readonly ImageParseLayoutBlock[]>>;
  finished: boolean;
  loading: boolean;
  resultRevision: number;
  attachmentId?: string;
}

const MERGE_IDLE: ImageParseTableMergeState = { status: 'idle', pages: [] };

interface ImageParseTableMergeRecord extends ImageParseTableMergeState {
  identity: string;
  suppressed: boolean;
  original: { markdown: string; layout: readonly ImageParseLayoutBlock[] } | null;
}

const IDLE_RECORD: ImageParseTableMergeRecord = {
  identity: '',
  status: 'idle',
  pages: [],
  suppressed: false,
  original: null,
};

/**
 * 合并单图内被识别拆开的相邻表格，并保留原始结果用于撤销。
 * @param options 当前识别结果、状态写入入口与结果身份
 * @returns 工具栏使用的合并状态与操作
 */
export function useImageParseTableMerge({
  enabled,
  markdown,
  layout,
  setMarkdown,
  setLayout,
  finished,
  loading,
  resultRevision,
  attachmentId,
}: ImageParseTableMergeOptions) {
  const [record, setRecord] = useState<ImageParseTableMergeRecord>(IDLE_RECORD);
  const autoKey = useRef('');
  const hasMergeCandidate = useMemo(
    () => enabled && hasMergableImageParseTables({ markdown, blocks: layout }),
    [enabled, layout, markdown],
  );
  const identity = `${attachmentId ?? ''}:${resultRevision}`;
  const state: ImageParseTableMergeRecord =
    record.identity === identity
      ? record
      : { identity, ...MERGE_IDLE, suppressed: false, original: null };

  const merge = useCallback(async (): Promise<number> => {
    if (!enabled || !finished || loading || state.status === 'merged') return 0;
    setRecord({ identity, status: 'merging', pages: [], suppressed: false, original: null });
    try {
      const merged = mergeImageParseTablesInPage({ markdown, blocks: layout });
      if (!merged) {
        setRecord({ identity, ...MERGE_IDLE, suppressed: false, original: null });
        return 0;
      }
      const original = { markdown, layout };
      setMarkdown(merged.result.markdown);
      setLayout(merged.result.blocks);
      setRecord({ identity, status: 'merged', pages: [], suppressed: false, original });
      return merged.count;
    } catch (failure) {
      setRecord({ identity, ...MERGE_IDLE, suppressed: false, original: null });
      throw failure;
    }
  }, [
    enabled,
    finished,
    identity,
    layout,
    loading,
    markdown,
    setLayout,
    setMarkdown,
    state.status,
  ]);

  useEffect(() => {
    if (
      !IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED ||
      !enabled ||
      !finished ||
      loading ||
      state.suppressed ||
      autoKey.current === identity
    )
      return;
    autoKey.current = identity;
    void merge().catch(() => undefined);
  }, [enabled, finished, identity, loading, merge, state.suppressed]);

  const unmerge = useCallback(() => {
    const previous = state.original;
    if (!previous) {
      setRecord({ identity, ...MERGE_IDLE, suppressed: false, original: null });
      return;
    }
    setMarkdown(previous.markdown);
    setLayout(previous.layout);
    setRecord({ identity, ...MERGE_IDLE, suppressed: true, original: null });
  }, [identity, setLayout, setMarkdown, state.original]);

  const active = hasMergeCandidate || state.status === 'merged';
  return {
    status: state.status,
    pages: state.pages,
    enabled: IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED && active,
    available: IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED && active && finished && !loading,
    merge,
    unmerge,
    scope: 'singleImage' as const,
  };
}
