/**
 * 回答引用来源面板。
 *
 * 用途：集中浏览本轮回答的全部来源；点击任一来源在新窗口打开原文。
 * 桌面端由 PlaygroundLayout 以非模态并排形式呈现（正文仍可读可点），窄屏退化为覆盖式抽屉。
 * 正文角标点击后会带着 activeUrl 进来，本组件负责把那一条滚入视野并保持选中态。
 */

import { useEffect, useRef } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@map/ui';

import type { Citation } from '../types';
import {
  citationDisplayIndex,
  citationDomain,
  citationURLKey,
  safeCitationHref,
} from '../utils/citations';
import { CitationFavicon } from './CitationFavicon';

interface CitationDrawerProps {
  /** 回答使用的全部来源。 */
  citations: Citation[];
  /** 需要定位并高亮的来源地址；来自正文角标点击，缺省表示不高亮任何一条。 */
  activeUrl?: string;
  /** 关闭面板。 */
  onClose: () => void;
}

/**
 * 渲染 Playground 主布局内的引用来源工作区。
 * @param citations 回答使用的全部来源
 * @param activeUrl 需要定位并高亮的来源地址
 * @param onClose 关闭面板
 * @returns 来源面板内容
 */
export function CitationDrawer({ citations, activeUrl, onClose }: CitationDrawerProps) {
  const { t } = useTranslation('playground');
  const title = t('referencesTitle', { count: citations.length });
  // 用归一化后的 key 比对：模型正文里的链接常与来源数据差一个末尾斜杠或查询参数顺序。
  const activeKey = activeUrl ? citationURLKey(activeUrl) : undefined;
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    if (!activeKey) return;
    const node = itemRefs.current.get(activeKey);
    if (!node) return;
    // block:'nearest' —— 目标已在视野内时不滚动，避免每点一个角标列表都弹一下。
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [activeKey]);

  return (
    <aside
      className="flex h-full min-w-0 flex-col bg-background/80"
      aria-label={title}
      data-testid="citation-drawer"
    >
      <header className="shrink-0 border-b border-border/35 bg-background/35 px-4 pb-3 pt-4 sm:px-5 sm:pb-4 sm:pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground/90">{t('referencesDescription')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label={t('closeReferences')}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <ol className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 py-2 sm:px-3">
        {citations.map((citation, index) => {
          const href = safeCitationHref(citation.url);
          const domain = citationDomain(citation.url);
          const sourceTitle = citation.title || domain;
          const key = citationURLKey(citation.url);
          const isActive = activeKey === key;
          const content = (
            <>
              <span
                className={cn(
                  'pt-0.5 text-xs font-medium tabular-nums',
                  // 序号跟着变色：选中态不能只靠背景色传达（颜色不是唯一信号）
                  isActive ? 'text-primary' : 'text-muted-foreground/60',
                )}
              >
                {String(citationDisplayIndex(citation, index)).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <CitationFavicon url={citation.url} className="size-5" />
                  <span className="truncate text-xs font-medium text-muted-foreground/90">
                    {domain}
                  </span>
                </span>
                <span className="mt-1 block text-sm font-semibold leading-5 text-foreground/95">
                  {sourceTitle}
                </span>
                {/*
                  同 CitationPreview：摘要不能带 block 等 display 工具类，Tailwind 3.4 的
                  display 排在 line-clamp 之后会把 display:-webkit-box 覆盖掉，clamp 失效后
                  每条来源都会展开成整篇网页正文。line-clamp-2 自身即块级盒。
                */}
                {citation.snippet ? (
                  <span className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground/90">
                    {citation.snippet}
                  </span>
                ) : null}
              </span>
              <ArrowUpRight
                className="mt-0.5 size-4 shrink-0 text-muted-foreground/60 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
                aria-hidden="true"
              />
            </>
          );

          const rowClassName = cn(
            'grid min-h-16 grid-cols-[1.5rem_minmax(0,1fr)_1rem] gap-2.5 rounded-xl px-2.5 py-2.5 sm:px-3',
            /*
              选中态用 primary 淡染 + 内描边，不把底色加深：同 SourcesChip 的推导，
              muted 系混进面板底色会掉饱和、显脏。比 hover 重一档，才分得清「我点中的是这条」
              和「鼠标正掠过这条」。
            */
            isActive ? 'bg-primary/[0.12] ring-1 ring-inset ring-primary/30' : 'bg-background/20',
          );

          return (
            <li
              key={citation.url}
              ref={(node) => {
                if (node) itemRefs.current.set(key, node);
                else itemRefs.current.delete(key);
              }}
            >
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    rowClassName,
                    'group transition-[background-color,box-shadow] duration-200',
                    'hover:bg-background/65 hover:shadow-[0_10px_24px_-20px_hsl(var(--foreground)/0.35)]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
                  )}
                  aria-label={`${sourceTitle}，${t('openSource')}`}
                >
                  {content}
                </a>
              ) : (
                <div className={rowClassName} aria-current={isActive ? 'true' : undefined}>
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
