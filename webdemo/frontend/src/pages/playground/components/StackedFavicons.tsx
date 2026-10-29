/**
 * 叠放的来源站点图标。
 *
 * 用途：过程时间线的搜索行与回答下方的来源胶囊共用同一枚「一叠网页」视觉，
 * 用极小的横向占位表达「这一步碰了这些站点」，具体是哪些页面由抽屉承载。
 */

import { cn } from '@map/ui';

import type { Citation } from '../types';
import { MAX_ROW_FAVICONS, STAGGER_CLASS_NAME, staggerStyle } from '../utils/answerTimeline';
import { CitationFavicon } from './CitationFavicon';

interface StackedFaviconsProps {
  /** 要展示的来源；只取其 url 画图标。 */
  citations: Citation[];
  /** 最多叠放几个，多出来的不展示也不计数。 */
  max?: number;
  /** 外层容器样式。 */
  className?: string;
}

/**
 * 渲染一叠重叠的站点图标。
 *
 * 图标是纯装饰（`aria-hidden`）：同一批来源的可读表达已经由紧挨着的文案（「搜索到 N 个网页」、
 * 胶囊上的「N 个网页」）和抽屉里的完整列表给出，这里再读一遍只会让屏幕阅读器把一行念成
 * 一串无意义的域名。
 *
 * 溢出**不报 +N**：数量就在旁边那句文案里，再补一个 +N 是同一件事说两遍；而搜索行的这一叠
 * 是拿整条消息的来源兜底出来的近似值（后端不发 web_search 的地址），+N 会与该行自己报的
 * 「搜索到 N 个网页」直接对不上——截图里 `搜索到 10 个网页 +26` 就是这么来的。
 *
 * @param citations 来源列表
 * @param max 最多叠放数量，默认 MAX_ROW_FAVICONS
 * @param className 外层容器样式
 * @returns 叠放图标；没有来源时不渲染
 */
export function StackedFavicons({
  citations,
  max = MAX_ROW_FAVICONS,
  className,
}: StackedFaviconsProps) {
  const visible = citations.slice(0, max);
  if (visible.length === 0) return null;

  return (
    <span className={cn('inline-flex shrink-0 items-center align-middle', className)}>
      {visible.map((citation, index) => (
        <span
          key={citation.url}
          aria-hidden="true"
          style={staggerStyle(index)}
          /*
            重叠靠负外边距，层级靠 ring 与 background 撑出的"描边"——两个图标之间必须有一圈
            与页面同色的环，否则深色站点图标叠在一起会糊成一团分不出个数。
          */
          className={cn(STAGGER_CLASS_NAME, '-ml-1.5 first:ml-0')}
        >
          <CitationFavicon
            url={citation.url}
            className="size-5 rounded-full border-0 bg-muted ring-2 ring-background"
            imageClassName="size-3"
          />
        </span>
      ))}
    </span>
  );
}
