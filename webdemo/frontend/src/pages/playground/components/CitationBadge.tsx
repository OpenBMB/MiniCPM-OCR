/**
 * 正文内的引用角标。
 *
 * 用途：把命中来源的 Markdown 链接渲染成与来源列表同号的上标数字，
 * 悬浮出预览卡、点击唤起右侧来源面板并定位到该条（未接 onActivate 时退回新窗口打开原文）。
 *
 * 为什么用 `relative + top` 而不是 `<sup>` / `vertical-align: super`：
 * 后两者会抬高行内盒并撑高整行行高，正文读起来忽上忽下；相对定位不参与行盒计算，
 * 角标视觉上升但版面完全不动。
 */

import { useTranslation } from 'react-i18next';

import { cn, Tooltip, TooltipContent, TooltipTrigger } from '@map/ui';

import type { Citation } from '../types';
import { isNativeOpenIntent, openCitationWindow, safeCitationHref } from '../utils/citations';
import { CitationPreviewCard } from './CitationPreview';

interface CitationBadgeProps {
  /** 角标对应的来源。 */
  citation: Citation;
  /** 来源序号（从 1 起，与底部参考资料、来源面板同号）。 */
  index: number;
  /** 点击角标时的接管动作（打开来源面板并定位）；不传则维持新窗口打开原文。 */
  onActivate?: () => void;
}

/**
 * 渲染一个可预览、可跳转的引用角标。
 * @param citation 角标对应的来源
 * @param index 来源序号（从 1 起）
 * @param onActivate 点击时的接管动作，缺省为新窗口打开原文
 * @returns 上标数字角标；地址非法时退化为不可点的纯数字
 */
export function CitationBadge({ citation, index, onActivate }: CitationBadgeProps) {
  const { t } = useTranslation('playground');
  const href = safeCitationHref(citation.url);
  const label = t('citationIndexLabel', { index });

  // data-citation-badge 让 MarkdownRenderer 的 `[&_a]` 基础样式跳过角标，
  // 否则正文链接的下划线与主色会盖掉角标自身的配色。
  const badgeClassName = cn(
    'relative -top-[0.3em] mx-[0.1em] inline-flex h-[1.15em] min-w-[1.15em] items-center justify-center',
    'rounded-[0.35em] bg-muted px-[0.28em] align-baseline text-[0.7em] font-medium leading-none',
    'tabular-nums text-muted-foreground no-underline',
    'transition-colors duration-150 motion-reduce:transition-none',
  );

  if (!href) {
    return (
      <span data-citation-badge className={badgeClassName} aria-label={label}>
        {index}
      </span>
    );
  }

  return (
    <Tooltip delayDuration={160}>
      <TooltipTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          data-citation-badge
          data-citation-url={href}
          aria-label={label}
          onClick={(event) => {
            // Cmd/Ctrl/中键仍按浏览器原生语义直接开新标签，不抢高级用户的习惯
            if (isNativeOpenIntent(event)) return;
            event.preventDefault();
            event.stopPropagation();
            // 接了面板就交给面板定位高亮；没接（如独立预览场景）才退回打开原文
            if (onActivate) onActivate();
            else openCitationWindow(href);
          }}
          className={cn(
            badgeClassName,
            'cursor-pointer hover:bg-primary/15 hover:text-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          )}
        >
          {index}
        </a>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="p-0">
        <CitationPreviewCard citation={citation} />
      </TooltipContent>
    </Tooltip>
  );
}
