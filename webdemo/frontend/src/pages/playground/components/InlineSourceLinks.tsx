/**
 * 过程时间线上内联的来源标题链接。
 *
 * 用途：网页读取行就地列出「读了哪几篇」，让展开过程看到的是内容而不是元数据。
 * 链接随工具行主文案同行流动并自动换行，不单独占一行。
 */

import { ArrowUpRight } from 'lucide-react';

import { cn } from '@map/ui';

import type { Citation } from '../types';
import { MAX_ROW_TITLES, STAGGER_CLASS_NAME, staggerStyle } from '../utils/answerTimeline';
import {
  citationDomain,
  isNativeOpenIntent,
  openCitationWindow,
  safeCitationHref,
} from '../utils/citations';

interface InlineSourceLinksProps {
  /** 该工具行涉及的来源。 */
  citations: Citation[];
  /** 最多内联几条，超出部分计入 +N。 */
  max?: number;
  /** 单条链接的无障碍文案，需说清点下去会打开什么。 */
  linkLabel: (title: string) => string;
  /** 溢出计数的无障碍文案。 */
  overflowLabel: (count: number) => string;
}

/**
 * 渲染内联的来源标题链接。
 *
 * 宽度预算按「抽屉推开主区后」的窄布局取：单条最宽 12rem 截断，这样面板开合两种状态下
 * 都不会把工具行撑出横向滚动。
 *
 * @param citations 来源列表
 * @param max 最多内联数量，默认 MAX_ROW_TITLES
 * @param linkLabel 单条链接的无障碍文案
 * @param overflowLabel 溢出计数的无障碍文案
 * @returns 内联链接；没有可安全打开的来源时不渲染
 */
export function InlineSourceLinks({
  citations,
  max = MAX_ROW_TITLES,
  linkLabel,
  overflowLabel,
}: InlineSourceLinksProps) {
  const openable = citations.filter((citation) => safeCitationHref(citation.url));
  const visible = openable.slice(0, max);
  if (visible.length === 0) return null;
  const remaining = openable.length - visible.length;

  return (
    <>
      {visible.map((citation, index) => {
        const title = citation.title?.trim() || citationDomain(citation.url);
        return (
          <a
            key={citation.url}
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={linkLabel(title)}
            style={staggerStyle(index)}
            className={cn(
              STAGGER_CLASS_NAME,
              'ml-2 inline-flex max-w-48 items-baseline gap-0.5 align-baseline',
              'text-foreground/80 underline decoration-dotted decoration-from-font underline-offset-4',
              'transition-colors hover:text-foreground focus-visible:text-foreground',
            )}
            onClick={(event) => {
              // 修饰键点击、中键等交回浏览器；其余走统一的新窗口打开，行为与角标、抽屉一致
              if (isNativeOpenIntent(event)) return;
              event.preventDefault();
              openCitationWindow(citation.url);
            }}
          >
            <span className="truncate">{title}</span>
            <ArrowUpRight className="size-3 shrink-0 self-center opacity-60" aria-hidden="true" />
          </a>
        );
      })}
      {remaining > 0 ? (
        <span className="ml-2 text-xs tabular-nums text-muted-foreground/70">
          {overflowLabel(remaining)}
        </span>
      ) : null}
    </>
  );
}
