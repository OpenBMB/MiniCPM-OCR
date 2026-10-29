import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react';
import {
  imageParseMappedProgress,
  imageParseScrollAnchors,
} from '../utils/imageParseScrollAnchors';
import type { ImageParseLayoutBlock } from '../utils/imageParseSample';
import {
  useImageParseResultPagination,
  type ImageParseResultPaginationOptions,
} from './useImageParseResultPagination';

const NO_BLOCKS: readonly ImageParseLayoutBlock[] = [];

type PendingResultScroll = {
  top: number;
  source: 'origin' | 'focus';
};

/** 原图栏接收的进度请求与用户滚动反馈。进度取值为 [0, 1]。 */
export interface ImageParseOriginScrollProps {
  scrollProgress?: number;
  onScrollProgress: (progress: number, programmatic?: boolean) => void;
  originScrollRef: (node: HTMLElement | null) => void;
}

function boundedProgress(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * 双栏滚动接线；禁用联动时不读写另一栏，新结果清除旧请求。
 * @param linked 是否启用联动
 * @param resultKey 当前结果身份；更换文件、页码或结果时应更新
 * @returns 原图 props、结果栏 viewport ref 与 scroll handler
 *
 * 有版面块时按真实渲染锚点插值；无对应节点时不执行不可靠的跨栏跳转。
 */
export function useImageParseScrollSync(
  linked: boolean,
  resultKey: string,
  blocks = NO_BLOCKS,
  pagination?: ImageParseResultPaginationOptions,
) {
  const resultNode = useRef<HTMLDivElement | null>(null);
  const originNode = useRef<HTMLElement | null>(null);
  const originProgress = useRef(0);
  const pendingResult = useRef<PendingResultScroll | undefined>(undefined);
  const pendingOrigin = useRef<number | undefined>(undefined);
  const [request, setRequest] = useState<{ key: string; progress: number }>();
  const [scope, setScope] = useState({ linked, resultKey });

  if (scope.linked !== linked || scope.resultKey !== resultKey) {
    setScope({ linked, resultKey });
    setRequest(undefined);
  }

  useEffect(() => {
    pendingResult.current = undefined;
    pendingOrigin.current = undefined;
    originProgress.current = 0;
  }, [linked, resultKey]);

  const resultRef = useCallback((node: HTMLDivElement | null) => {
    resultNode.current = node;
    pendingResult.current = undefined;
  }, []);
  const originScrollRef = useCallback((node: HTMLElement | null) => {
    originNode.current = node;
  }, []);

  const onScrollProgress = useCallback(
    (value: number, programmatic = false) => {
      if (!linked || !Number.isFinite(value)) return;
      const progress = boundedProgress(value);
      originProgress.current = progress;
      const expected = pendingOrigin.current;
      pendingOrigin.current = undefined;
      setRequest(undefined);
      // 原图确认结果栏发出的请求时，不再将同一位置写回结果栏。
      if (programmatic || (expected !== undefined && Math.abs(progress - expected) < 0.001)) return;
      const node = resultNode.current;
      if (!node) return;
      const anchors = imageParseScrollAnchors(originNode.current, node, blocks, progress);
      if (
        !anchors.length &&
        (blocks.length || originNode.current?.hasAttribute('data-pdf-viewport'))
      )
        return;
      const mapped = anchors.length
        ? imageParseMappedProgress(anchors, progress, 'origin')
        : progress;
      const next = Math.max(0, node.scrollHeight - node.clientHeight) * mapped;
      if (Math.abs(node.scrollTop - next) < 0.5) return;
      node.scrollTop = next;
      node.dataset.ocrProgrammaticTop = String(node.scrollTop);
      pendingResult.current = { top: node.scrollTop, source: 'origin' };
    },
    [linked, blocks],
  );

  const scrollResultTo = useCallback((top: number) => {
    const node = resultNode.current;
    if (!node || !Number.isFinite(top)) return;
    const next = Math.max(0, Math.min(node.scrollHeight - node.clientHeight, top));
    if (Math.abs(node.scrollTop - next) < 0.5) return;
    pendingResult.current = { top: next, source: 'focus' };
    node.scrollTop = next;
    node.dataset.ocrProgrammaticTop = String(node.scrollTop);
  }, []);

  const onResultScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!linked) return;
      const node = event.currentTarget;
      const expected = pendingResult.current;
      pendingResult.current = undefined;
      // 块定位允许浏览器因布局变化落在邻近位置，不能把确认误判为用户滚动并反向改写原图。
      if (expected !== undefined) {
        if (Math.abs(node.scrollTop - expected.top) < 1 || expected.source === 'focus') return;
      }
      const range = Math.max(0, node.scrollHeight - node.clientHeight);
      // 换页重建或短结果产生的零偏移不是用户要求原文回到首页。
      if (!range) return;
      const progress = boundedProgress(node.scrollTop / range);
      const anchors = imageParseScrollAnchors(
        originNode.current,
        node,
        blocks,
        originProgress.current,
      );
      if (
        !anchors.length &&
        (blocks.length || originNode.current?.hasAttribute('data-pdf-viewport'))
      )
        return;
      const mapped = anchors.length
        ? imageParseMappedProgress(anchors, progress, 'result')
        : progress;
      pendingOrigin.current = mapped;
      setRequest({ key: resultKey, progress: mapped });
    },
    [linked, resultKey, blocks],
  );

  const enterResultPage = useCallback(
    (edge: 0 | 1) => {
      const node = resultNode.current;
      if (!node) return false;
      scrollResultTo(edge * Math.max(0, node.scrollHeight - node.clientHeight));
      if (linked) {
        const anchors = imageParseScrollAnchors(
          originNode.current,
          node,
          blocks,
          originProgress.current,
        );
        if (anchors.length) {
          const progress = imageParseMappedProgress(anchors, edge, 'result');
          pendingOrigin.current = progress;
          setRequest({ key: resultKey, progress });
        }
      }
      return true;
    },
    [linked, resultKey, blocks, scrollResultTo],
  );
  const resultPaneRef = useImageParseResultPagination(resultKey, pagination, enterResultPage);

  const originProps: ImageParseOriginScrollProps = {
    scrollProgress: linked && request && request.key === resultKey ? request.progress : undefined,
    onScrollProgress,
    originScrollRef,
  };
  return { originProps, resultRef, resultPaneRef, onResultScroll, scrollResultTo };
}
