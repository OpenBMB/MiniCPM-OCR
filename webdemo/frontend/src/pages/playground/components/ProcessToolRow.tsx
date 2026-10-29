/**
 * 过程时间线上的一次工具调用。
 *
 * 用途：把工具行从「元数据清单」改成「内容行」——搜索行报搜到了多少网页并叠放站点图标，
 * 读页行就地列出读了哪几篇，进行中就地显示正在搜什么。单步耗时与关键词计数一律不展示：
 * 它们对用户没有决策价值，耗时只在过程区顶部报一次总数。
 */

import { useTranslation } from 'react-i18next';
import { BookOpen, CircleAlert, Clock, Search, Wrench } from 'lucide-react';

import { cn } from '@map/ui';

import type { Citation, ToolEvent } from '../types';
import {
  STAGGER_CLASS_NAME,
  isReaderTool,
  isSearchTool,
  staggerStyle,
} from '../utils/answerTimeline';
import { ProcessRailItem } from './AnswerProcessSteps';
import { InlineSourceLinks } from './InlineSourceLinks';
import { StackedFavicons } from './StackedFavicons';

interface ProcessToolRowProps {
  /** 本次工具调用。 */
  event: ToolEvent;
  /** 该行要就地展示的来源（已由 toolRowCitations 解析好）。 */
  citations: Citation[];
  /** 打开来源抽屉；给了才把搜索行的「搜索到 N 个网页 + 站点图标」整块做成可点。 */
  onOpenSources?: () => void;
  /** 是否为时间线最后一项。 */
  last?: boolean;
}

/**
 * 渲染一条工具行。
 * @param event 工具事件
 * @param citations 该行的来源
 * @param onOpenSources 打开来源抽屉
 * @param last 是否为时间线最后一项
 * @returns 工具行
 */
export function ProcessToolRow({
  event,
  citations,
  onOpenSources,
  last = false,
}: ProcessToolRowProps) {
  const { t } = useTranslation('playground');
  const failed = event.status === 'failed';
  const running = event.status === 'running';
  const label = toolLabel(event, citations, t);
  // 搜索完成的那一行：文案与图标合成一个通往来源抽屉的入口
  const searchDone = isSearchTool(event.tool) && !running && !failed;

  return (
    <ProcessRailItem
      marker={<ToolMarker event={event} />}
      last={last}
      tone={failed ? 'destructive' : 'default'}
    >
      <span className="break-words">
        {searchDone ? (
          <SourcesTrigger label={label} citations={citations} onOpen={onOpenSources} />
        ) : (
          label
        )}
        {running && event.queries?.length ? <RunningQueries queries={event.queries} /> : null}
        {isReaderTool(event.tool) ? (
          <InlineSourceLinks
            citations={citations}
            linkLabel={(title) => `${title}，${t('openSource')}`}
            overflowLabel={(count) => t('moreSources', { count })}
          />
        ) : null}
      </span>
      {failed && event.message ? (
        <span className="mt-0.5 block break-words text-xs leading-5">{event.message}</span>
      ) : null}
    </ProcessRailItem>
  );
}

/**
 * 搜索行的可点区域：主文案 + 那一叠站点图标整块通往来源抽屉。
 *
 * 这一行本来就是「这一步碰了这些网页」的摘要，点它去看是哪些网页是最短的路径——否则用户
 * 得先无视眼前这一叠图标，再翻到回答末尾去找胶囊。没有来源或上层没给回调时退回纯文本，
 * 不做一个点了没反应的按钮。
 */
function SourcesTrigger({
  label,
  citations,
  onOpen,
}: {
  label: string;
  citations: Citation[];
  onOpen?: () => void;
}) {
  const { t } = useTranslation('playground');
  const stack = <StackedFavicons citations={citations} className="ml-2" />;
  if (!onOpen || citations.length === 0) {
    return (
      <>
        {label}
        {stack}
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      /* 图标是 aria-hidden 的装饰，可读名字只能由文案给，再补一句去向 */
      aria-label={`${label}，${t('openReferences')}`}
      data-testid="tool-row-sources"
      className={cn(
        '-mx-1 -my-0.5 inline-flex max-w-full items-center rounded px-1 py-0.5 text-left align-middle',
        'transition-colors duration-200',
        /*
          hover 只让文字变深，不铺背景：这一行是时间线里的一段行内文字，给它一块底色会在
          marker 列旁边凭空多出一个方块，把「一条线」读成「一张卡片」。文字由 muted 提到
          foreground 已经足够表明可点，负边距与 px/py 留着是给 focus ring 让位。
        */
        'hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
    >
      <span className="truncate">{label}</span>
      {stack}
    </button>
  );
}

/** 进行中的搜索词：紧跟主文案逐个淡入，完成后被「搜索到 N 个网页」取代。 */
function RunningQueries({ queries }: { queries: string[] }) {
  return (
    <span className="text-foreground/70">
      {queries.map((query, index) => (
        <span
          key={query}
          style={staggerStyle(index)}
          className={cn(STAGGER_CLASS_NAME, 'ml-2 inline-block max-w-48 truncate align-bottom')}
        >
          {query}
        </span>
      ))}
    </span>
  );
}

/**
 * 工具行 marker：失败告警，其余按工具语义给固定图标。
 *
 * 进行中**不转圈**。转圈只留过程区顶行那一枚：顶行在收起态也在场，且开了联网到首个工具帧
 * 到达之间还有一段时间线为空的空档，动效必须由它承担。两处同时转就是同一件事报两遍，
 * 各转各的更乱。进行中的那一行靠文案区分——`搜索 <关键词>` 对 `搜索到 N 个网页`，
 * 图标反而因此在「进行中 → 完成」之间保持同一枚，不在收尾那一刻跳一下形。
 */
function ToolMarker({ event }: { event: ToolEvent }) {
  if (event.status === 'failed') {
    return <CircleAlert className="size-4 text-destructive" aria-hidden="true" />;
  }
  if (event.status === 'interrupted') {
    return <CircleAlert className="size-4 text-muted-foreground/60" aria-hidden="true" />;
  }
  // 进行中的这一行用 primary 着色，让「现在在跑哪一步」仍然一眼可辨
  const className =
    event.status === 'running' ? 'size-4 text-primary' : 'size-4 text-muted-foreground/70';
  if (isSearchTool(event.tool)) return <Search className={className} aria-hidden="true" />;
  if (isReaderTool(event.tool)) return <BookOpen className={className} aria-hidden="true" />;
  if (event.tool === 'datetime') return <Clock className={className} aria-hidden="true" />;
  return <Wrench className={className} aria-hidden="true" />;
}

/**
 * 生成工具行主文案。
 *
 * 完成态优先报「成果数量」而不是工具名：用户关心的是搜到/读了多少，而不是调用了哪个函数。
 * 数量拿不到时（旧消息、后端没给计数）退回工具名，不编造数字。
 *
 * @param event 工具事件
 * @param citations 该行的来源，用于计数兜底
 * @param t i18n 翻译函数
 * @returns 主文案
 */
function toolLabel(
  event: ToolEvent,
  citations: Citation[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (isSearchTool(event.tool)) {
    if (event.status === 'running') return t('toolEventSearch');
    const count = event.resultCount ?? citations.length;
    return count > 0 ? t('searchedPages', { count }) : t('toolEventSearch');
  }
  if (isReaderTool(event.tool)) {
    if (event.status === 'running') return t('toolEventRead');
    const count = event.pageCount ?? citations.length;
    return count > 0 ? t('browsedPages', { count }) : t('toolEventRead');
  }
  if (event.tool === 'datetime') return t('toolEventDatetime');
  return event.tool;
}
