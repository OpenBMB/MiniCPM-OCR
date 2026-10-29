import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { imageParseSourceUnavailable, type ImageParseSource } from '@/api/map/imageParseSource';

import type { ImageParseDraft } from './useImageParseDraft';
import type { ImageParseLayoutBlock } from '../utils/imageParseSample';
import { imageParseBlockId } from '../utils/imageParseBlocks';
import { imageParseDraftRanges } from '../utils/imageParseDraftRanges';
import { imageParseBlockCanRegenerate } from '../utils/imageParseQuality';
import { imageParseBlockGenerator } from '../utils/imageParseRegenerationRequest';
import {
  imageParseRegenerationErrorKey,
  imageParseRegenerationIds,
  regenerateMappedImageParseBlock,
  type ImageParseRegeneration,
} from '../utils/imageParseRegeneration';

interface RegenerationInput {
  resultKey: string;
  /** 当前登录用户可见的文档解析模型 ID。 */
  model: string;
  /** 当前选中 API Key 的明文密钥；仅内存传入，不落盘。 */
  secret: string;
  blocks: readonly ImageParseLayoutBlock[];
  draft: ImageParseDraft;
  documentDataUrl: string;
  mime: string;
  pageIndex: number;
  loading: boolean;
  source?: ImageParseSource;
  /** 请求终态后刷新 Playground 免费体验状态。 */
  refreshTrial?: () => void;
}

/** 编排主动块优化：限制预算、保护人工修改，并中止跨文档/页码的旧任务。 */
export function useImageParseRegeneration(input: RegenerationInput) {
  const { resultKey, blocks } = input;
  const { refreshTrial } = input;
  const latest = useRef(input);
  useLayoutEffect(() => {
    latest.current = input;
  }, [input]);
  const active = useRef<AbortController | null>(null);
  const [state, setState] = useState<{
    key: string;
    histories: Record<string, Record<string, ImageParseRegeneration>>;
    pending: ReadonlySet<string>;
  }>({ key: resultKey, histories: {}, pending: new Set() });
  const results = useMemo(() => state.histories[resultKey] ?? {}, [resultKey, state.histories]);
  const pending = state.key === resultKey ? state.pending : new Set<string>();
  const unavailableReason = imageParseSourceUnavailable(input.source) ??
    (input.secret ? undefined : 'imageParseAuthFailed');
  const available = unavailableReason === undefined;

  const stop = useCallback(() => {
    active.current?.abort();
    active.current = null;
    setState((previous) => ({ ...previous, pending: new Set() }));
  }, []);
  useEffect(() => stop, [resultKey, stop]);

  const reset = useCallback(() => {
    stop();
    setState((previous) => ({
      ...previous,
      key: resultKey,
      histories: { ...previous.histories, [resultKey]: {} },
      pending: new Set(),
    }));
  }, [resultKey, stop]);

  const run = useCallback(
    async (ids: readonly string[]) => {
      const eligibleIds = ids.filter((id) => !results[id]);
      if (active.current || input.loading || !available || !eligibleIds.length) return;
      const controller = new AbortController();
      active.current = controller;
      const signal = controller.signal;
      const isCurrent = () => !signal.aborted && latest.current.resultKey === resultKey;
      setState((previous) => ({
        key: resultKey,
        histories: previous.histories,
        pending: new Set(eligibleIds),
      }));
      // 批量按顺序调用，避免低分块数量放大服务并发；每块独立失败不会清空已完成结果。
      for (const id of eligibleIds) {
        if (!isCurrent()) break;
        const original = blocks.find((block, index) => imageParseBlockId(block, index) === id);
        if (!original || !imageParseBlockCanRegenerate(original)) continue;
        const previous = results[id];
        const currentBest = previous?.best ?? original;
        let record: ImageParseRegeneration = previous ?? {
          original,
          best: original,
          rounds: 0,
          improved: false,
        };
        try {
          record = await regenerateMappedImageParseBlock({
            id,
            original,
            currentBest,
            signal,
            getDraft: () => {
              if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError');
              return latest.current.draft;
            },
            generate: imageParseBlockGenerator(
              {
                source: input.source,
                model: input.model,
                secret: input.secret,
                documentDataUrl: input.documentDataUrl,
                mime: input.mime,
                pageIndex: input.pageIndex,
              },
              original,
              id,
              signal,
            ),
            onApply: (next, range) => {
              const draft = latest.current.draft;
              draft.setValue(next, range, 'model');
              // React 可合并整批提交，下一块必须同步取得更新后的文本与偏移。
              latest.current = {
                ...latest.current,
                draft: {
                  ...draft,
                  value: next,
                  ranges: imageParseDraftRanges(draft.value, next, draft.ranges, range),
                },
              };
            },
          });
        } catch (failure) {
          if (controller.signal.aborted || latest.current.resultKey !== resultKey) break;
          record = {
            ...record,
            best: currentBest,
            improved: false,
            error: imageParseRegenerationErrorKey(failure),
          };
        }
        if (controller.signal.aborted || latest.current.resultKey !== resultKey) break;
        setState((previous) => ({
          key: resultKey,
          histories: {
            ...previous.histories,
            [resultKey]: { ...previous.histories[resultKey], [id]: record },
          },
          pending: new Set([...previous.pending].filter((item) => item !== id)),
        }));
      }
      // 每个块优化都是一次真实 L2 请求；批量结束后刷新免费次数。
      refreshTrial?.();
      if (active.current === controller) {
        active.current = null;
        setState((previous) => ({ ...previous, pending: new Set() }));
      }
    },
    [
      available,
      blocks,
      input.documentDataUrl,
      input.loading,
      input.mime,
      input.model,
      input.pageIndex,
      input.secret,
      input.source,
      refreshTrial,
      resultKey,
      results,
    ],
  );

  const layout = useMemo(
    () =>
      blocks.map((block, index) => {
        const record = results[imageParseBlockId(block, index)];
        return record ? record.best : block;
      }),
    [blocks, results],
  );
  const eligibleIds = imageParseRegenerationIds(layout, input.draft).filter((id) => !results[id]);

  return {
    ...({ unavailableReason } as { unavailableReason?: string }),
    available,
    results,
    pending,
    layout,
    eligibleLowCount: eligibleIds.length,
    busy: pending.size > 0,
    reset,
    stop,
    regenerateBlock: (id: string) => run([id]),
    regenerateLowBlocks: () => run(eligibleIds),
  };
}
