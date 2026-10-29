import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { Button, cn } from '@map/ui';

import type { ProcessFollow } from '../hooks/useAnswerProcessDisclosure';
import type { Citation } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';

/**
 * 渲染回答过程折叠区的标题行。
 *
 * 整行就是折叠开关：过程区顶部只表达「思考了多久」，来源统一由回答下方的胶囊通往抽屉，
 * 标题不再兼任第二个跳转入口——一行两个动作，用户分不清点哪儿会发生什么。
 *
 * @param props 标题、图标、展开状态与内容
 * @returns 可键盘操作的折叠区
 */
export function ProcessDisclosure({
  id,
  expanded,
  title,
  icon,
  failed = false,
  onToggle,
  children,
}: {
  id: string;
  expanded: boolean;
  title: string;
  icon: ReactNode;
  failed?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const tone = failed
    ? 'text-destructive hover:bg-destructive/5 hover:text-destructive'
    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground';
  const rowClassName =
    'h-auto min-h-9 items-center gap-2 rounded-md px-0 py-1.5 text-left text-sm font-normal transition-[background-color,color] duration-200';

  const head = (
    <>
      {/*
        图标格子只负责对齐，不铺底色。时间线里的 marker 要用 bg-background 在连接线上开一个口
        （见 ProcessRailItem），顶行没有线穿过，同样铺底就只剩副作用：整行 hover 变色时，
        这块不透明的底会在 hover 色里挖出一个圆洞，看着像图标自带背景。
      */}
      {/* 保留标题列宽，图标左对齐回答正文，避免居中产生额外内缩。 */}
      <span className="flex size-6 shrink-0 items-center justify-start">{icon}</span>
      <span className="min-w-0 truncate">{title}</span>
    </>
  );
  const chevron = (
    <ChevronDown
      className={cn(
        // 箭头跟随 expanded 旋转，用 ease-out 曲线与 max-height 展开速度匹配
        'size-4 shrink-0 transition-transform duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        expanded && 'rotate-180',
      )}
      aria-hidden="true"
    />
  );

  return (
    <div className="relative z-10">
      <Button
        type="button"
        variant="ghost"
        aria-controls={id}
        aria-expanded={expanded}
        data-testid="process-toggle"
        className={cn(
          'grid w-full max-w-3xl grid-cols-[1.5rem_minmax(0,1fr)_1rem]',
          rowClassName,
          tone,
        )}
        onClick={onToggle}
      >
        {head}
        {chevron}
      </Button>

      <DisclosurePanel id={id} expanded={expanded}>
        {children}
      </DisclosurePanel>
    </div>
  );
}

/**
 * 渲染可自动跟随输出的过程滚动区。
 *
 * 滚动必须由整条时间线统一承载：交错之后思考被切成若干段，每段各自一个滚动条既滚不动
 * 也读不出先后。属性名沿用 data-reasoning-scroll，外部（含测试）据此定位这块滚动区。
 *
 * @param props 展开态、流式状态、触发重新贴底的内容指纹、跟随控制与时间线内容
 * @returns 过程内容滚动区
 */
export function ProcessScrollArea({
  expanded,
  streaming,
  watch,
  follow,
  children,
}: {
  expanded: boolean;
  streaming: boolean;
  watch: string;
  follow: ProcessFollow;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    // 跟随状态只在这里问一次：用户中途往回翻过，就不再把滚动位置抢回底部
    if (!follow.shouldFollow()) return;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [follow, watch, streaming]);

  useLayoutEffect(() => {
    if (expanded) return;
    const element = scrollRef.current;
    if (!element) return;
    /*
      收起时把阅读位置归零，下一次展开从头读。

      收起态不可见，归零在这里没有视觉代价；不归零的话，流式期间一路跟到底的 scrollTop
      会原样留着，用户再点开看到的是思考的**尾巴**——内容凭空从中间开始，像是随机停位。
      流式期间收起再展开也不受影响：下一帧增量到达时跟随会把它重新贴回底部。
    */
    element.scrollTop = 0;
  }, [expanded]);

  return (
    <div
      ref={scrollRef}
      data-reasoning-scroll
      onScroll={follow.onScroll}
      onWheel={follow.onWheel}
      onTouchMove={follow.onTouchMove}
      onKeyDown={follow.onKeyDown}
      className={cn(
        'max-w-2xl overflow-y-auto overscroll-contain pb-1 pr-2',
        /*
          流式期间压到 48（不占太多屏），结束后放到 96。直接切换是一次硬跳：实测 300px
          高的过程区会在一帧内从 192px 长到 300px，把下方正文整块顶下去——回答刚写完那一
          瞬间页面抖一下，就是这里。过渡让它长出来；与折叠动画同时发生也不打架（1fr 的
          目标值随内容走，实测无二次动画）。
        */
        'transition-[max-height] duration-300 ease-out motion-reduce:transition-none',
        streaming ? 'max-h-48' : 'max-h-96',
      )}
    >
      {children}
    </div>
  );
}

/**
 * 时间线上的一段思考文本。
 *
 * 思考里同样会出现 `[ref_N]` 角标——模型是一边读搜索结果一边想的，引用编号自然写进思考。
 * 不把来源传进去，这些角标既变不成链接，还会被裸数学识别当成下标公式渲染成一串斜体。
 *
 * @param props 思考文本、流式状态与本轮来源
 * @returns 走统一 Markdown 管线渲染的思考段
 */
export function ReasoningSegment({
  reasoning,
  streaming,
  citations = [],
}: {
  reasoning: string;
  streaming: boolean;
  citations?: Citation[];
}) {
  return (
    <MarkdownRenderer
      content={reasoning}
      variant="reasoning"
      streaming={streaming}
      citations={citations}
    />
  );
}

/*
  展开与收起用不同的曲线，这不是装饰。

  cubic-bezier(0.22,1,0.36,1) 极度前置：用在展开上是「迅速揭开、末端稳住」，手感利落；
  用在收起上就成了塌陷——实测一个 300px 高的过程区，头 30ms 就掉到 133px，下方正文被
  猛地拽上来一大截，看着正是「排版闪动一下」。收起换标准 ease-out，同样 220ms 收完，
  但前 30ms 只走 20px，读起来是收拢而不是被抽走。

  opacity 跟高度同曲线、同时长、不带延时：两层各走各的节奏时，内容会在容器还没收完时
  就已经透明，留一块空白在原地坍缩——那是同一个问题的另一半。
*/
const PANEL_DURATION_MS = 220;
const PANEL_EXPAND_CURVE = 'cubic-bezier(0.22,1,0.36,1)';
const PANEL_COLLAPSE_CURVE = 'cubic-bezier(0.4,0,0.2,1)';

/**
 * 折叠内容面板。
 *
 * 动画策略：grid-template-rows 0fr → 1fr。
 * - 比 max-height 方案更精确：高度精确等于内容高度，无「9999px → 0」的冗余计算；
 * - 配合 overflow-hidden 保证内容在折叠期间不外溢。
 */
export function DisclosurePanel({
  id,
  expanded,
  children,
}: {
  id: string;
  expanded: boolean;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.inert = !expanded;
    }
  }, [expanded]);

  const timing = `${PANEL_DURATION_MS}ms ${expanded ? PANEL_EXPAND_CURVE : PANEL_COLLAPSE_CURVE}`;

  return (
    <div
      id={id}
      aria-hidden={!expanded}
      style={{
        display: 'grid',
        gridTemplateRows: expanded ? '1fr' : '0fr',
        transition: `grid-template-rows ${timing}`,
      }}
    >
      <div
        ref={contentRef}
        className="min-h-0 overflow-hidden"
        style={{ opacity: expanded ? 1 : 0, transition: `opacity ${timing}` }}
      >
        {children}
      </div>
    </div>
  );
}
