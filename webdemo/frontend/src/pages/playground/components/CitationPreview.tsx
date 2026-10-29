/**
 * 引用来源的悬浮预览卡片。
 *
 * 用途：正文角标（CitationBadge）与其他来源入口 hover 时的统一预览，
 * 用户无需离开回答即可判断来源；卡片自身也可点击，在新窗口打开原文。
 */

import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Citation } from '../types';
import {
  citationDomain,
  isNativeOpenIntent,
  openCitationWindow,
  safeCitationHref,
} from '../utils/citations';
import { CitationFavicon } from './CitationFavicon';

interface CitationPreviewCardProps {
  /** 要预览的来源。 */
  citation: Citation;
}

/**
 * 渲染单条来源的标题、域名和摘要。
 * @param citation 来源数据
 * @returns 来源预览内容
 */
export function CitationPreviewCard({ citation }: CitationPreviewCardProps) {
  const { t } = useTranslation('playground');
  const domain = citationDomain(citation.url);
  const title = citation.title || domain;
  const href = safeCitationHref(citation.url);

  const inner = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <CitationFavicon url={citation.url} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground/90">
          {domain}
        </span>
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      </div>
      {/*
        标题与摘要都不能再加 block/flex 等 display 工具类：Tailwind 3.4 把 display 排在
        line-clamp 之后，display:block 会覆盖 line-clamp 依赖的 display:-webkit-box，
        -webkit-line-clamp 随即失效，整段网页正文铺开会把预览卡撑出视口。
      */}
      <p className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-foreground">{title}</p>
      {citation.snippet ? (
        <p className="mt-1.5 line-clamp-4 text-xs leading-5 text-muted-foreground/90">
          {citation.snippet}
        </p>
      ) : null}
      <p className="mt-2 text-[11px] font-medium text-primary">{t('openSource')}</p>
    </>
  );

  // 预览卡片本身也可点击打开原文：避免 Tooltip 内部的非交互卡片让用户感到"点不动"。
  if (!href) {
    return <div className="w-[min(22rem,calc(100vw-2rem))] p-3.5 text-left">{inner}</div>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-citation-url={href}
      aria-label={`${title}，${t('openSource')}`}
      onClick={(event) => {
        // 修饰键 + 中键 → 让原生"在新标签页打开"行为继续生效
        if (isNativeOpenIntent(event)) return;
        event.preventDefault();
        event.stopPropagation();
        openCitationWindow(href);
      }}
      className="block w-[min(22rem,calc(100vw-2rem))] cursor-pointer rounded-md p-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {inner}
    </a>
  );
}
