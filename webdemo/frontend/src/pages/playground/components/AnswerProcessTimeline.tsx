/**
 * 回答过程时间线。
 *
 * 用途：把一次回答的全过程——思考、联网搜索、读网页、查时间——还原成**一条**交错的时间线。
 * 模型的真实执行是「思考 → 调工具 → 继续思考」的单一流程，界面也就只给一个折叠区：
 * 顶行报「已思考（用时 N 秒）」，展开后思考段与工具行按发生顺序穿插在同一条 marker 列上。
 *
 * 来源不在这里收口：正文下方的来源胶囊统一通往来源抽屉，顶行不再兼任第二个跳转入口。
 */

import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, CircleAlert, LoaderCircle } from 'lucide-react';

import { cn } from '@map/ui';

import type { Citation, SearchProgressStep, ToolEvent } from '../types';
import { useAnswerProcessDisclosure } from '../hooks/useAnswerProcessDisclosure';
import {
  WEB_TOOLS,
  buildProcessTimeline,
  citationIndex,
  isSearchTool,
  toolRowCitations,
} from '../utils/answerTimeline';
import { runningSearchQueries } from '../utils/toolEvents';
import { ProcessBullet, ProcessRailItem } from './AnswerProcessSteps';
import { ProcessDisclosure, ProcessScrollArea, ReasoningSegment } from './AnswerProcessDisclosure';
import { ProcessToolRow } from './ProcessToolRow';

interface AnswerProcessTimelineProps {
  /** 模型思考内容（已过展示层改写）。 */
  reasoning: string;
  /** 当前模型是否允许展示思考内容。 */
  showReasoning?: boolean;
  /** 展示层是否改写过思考文本；改写过就无法交错，退化为思考整块置顶。 */
  reasoningRewritten?: boolean;
  /** 是否仍在流式生成。 */
  streaming?: boolean;
  /** 本轮全部工具调用事件，按到达顺序。 */
  toolEvents?: ToolEvent[];
  /** 整条消息的来源，供工具行就地展示站点图标与页面标题。 */
  citations?: Citation[];
  /** 是否已开启联网但还没有任何工具事件（首帧之前的空档）。 */
  searching?: boolean;
  /** 后端下发的过程阶段，失败态可能先于工具事件到达。 */
  searchStep?: SearchProgressStep;
  /** 最近一次执行的工具名，用于判定失败归属。 */
  searchActiveTool?: string;
  /** 后端下发的失败原因，失败态直接当标题用。 */
  searchStatus?: string;
  /** 打开来源抽屉；给了才把搜索行做成可点。 */
  onOpenSources?: () => void;
  /** 是否已经有回答正文，用于绘制过程与答案的分隔。 */
  hasAnswer?: boolean;
}

/**
 * 渲染回答的过程时间线。
 * @param props 思考内容、工具事件、来源与流式状态
 * @returns 可折叠的过程时间线；没有过程数据时不渲染
 */
export function AnswerProcessTimeline({
  reasoning,
  showReasoning = true,
  reasoningRewritten = false,
  streaming = false,
  toolEvents = [],
  citations = [],
  searching = false,
  searchStep,
  searchActiveTool,
  searchStatus,
  onOpenSources,
  hasAnswer = false,
}: AnswerProcessTimelineProps) {
  const { t } = useTranslation('playground');
  const panelId = useId();

  /*
    交给时间线的是**未 trim 的原文**：工具事件的 reasoningOffset 按原文字符数累加，先 trim
    再按 offset 切会整体错位——模型惯常在调工具前留一个换行，trim 掉之后显示长度反而短于
    offset，下面「等播到再出行」的判断就永远等不到。段内空白由 buildProcessTimeline 逐段收拾。
  */
  const rawReasoning = showReasoning ? reasoning : '';
  const hasReasoning = Boolean(rawReasoning.trim());
  const failedEvents = toolEvents.filter((event) => event.status === 'failed');
  /*
    只有联网工具失败才让整行转红、标题换成失败原因。datetime 这类工具挂掉只是思考里的一个
    子步骤没成，回答本身照常生成——整条标红会让用户以为整个回答都不可信。

    searchStep / searchActiveTool 是全工具共用字段，失败帧可能先于工具事件到达（甚至在
    「刚开联网就失败」时根本没有工具事件，所以它也要计入 hasProcess）。归属以最近一次
    工具为准，否则「查时间失败」会被报成「联网搜索失败」。
  */
  const stepFailedIsWeb =
    searchStep === 'failed' && (!searchActiveTool || WEB_TOOLS.has(searchActiveTool));
  const webFailed = stepFailedIsWeb || failedEvents.some((event) => WEB_TOOLS.has(event.tool));
  const anyFailed = webFailed || failedEvents.length > 0;
  const interrupted = toolEvents.some((event) => event.status === 'interrupted');
  // 已经报失败就不再转圈：失败帧到达后 searching 常常还挂着，图标会一直转
  const running =
    !webFailed &&
    (toolEvents.some((event) => event.status === 'running') || (searching && streaming));
  const webRunning =
    toolEvents.some((event) => event.status === 'running' && WEB_TOOLS.has(event.tool)) ||
    (searching && streaming && !toolEvents.some((event) => event.status === 'running'));
  /*
    本轮是否真的联网取回了证据。判据是「有成功的联网工具调用」，而不是「联网开关开着」：
    开关只代表用户允许联网，模型完全可以判断不需要而一次都不调，那种回答与纯思考没有区别，
    却会被标成「已联网」——这比不标更糟，用户会以为答案有外部依据。
  */
  const webSearched = toolEvents.some(
    (event) => WEB_TOOLS.has(event.tool) && event.status === 'success',
  );
  const webSearchCount = toolEvents.filter(
    (event) => isSearchTool(event.tool) && event.status === 'success',
  ).length;
  const hasProcess = hasReasoning || toolEvents.length > 0 || (searching && streaming) || webFailed;

  const timeline = useMemo(
    () =>
      buildProcessTimeline({
        reasoning: rawReasoning,
        toolEvents,
        reasoningRewritten,
        holdUnplayed: streaming,
      }),
    [rawReasoning, toolEvents, reasoningRewritten, streaming],
  );
  const index = useMemo(() => citationIndex(citations), [citations]);
  /*
    整个过程只有一段思考、且不会再长出别的行时不画项目符号。marker 列的意义是让多行对齐成
    一条线；只剩一行时它退化成「一个元素的项目符号」——没有下一项可对齐，也没有连接线可挂，
    剩下的只是一个指向空处的圆点。

    判据里带上 toolEvents / searching：流式期间工具行可能正被播放队列押着（见
    buildProcessTimeline 的 holdUnplayed），此刻 items 也只有一项，但行马上就会出现——
    按当下项数决定就会让圆点凭空冒出来一次。

    列宽保留（marker 传 null，而不是绕开 ProcessRailItem）：正文要继续与顶行标题左对齐，
    去掉这一列会让它整块左移到图标那一列，读起来像与顶行平级，而不是顶行展开出的内容。
  */
  const soleReasoning =
    timeline.items.length === 1 &&
    timeline.items[0]?.kind === 'reasoning' &&
    toolEvents.length === 0 &&
    !(searching && streaming);

  const disclosure = useAnswerProcessDisclosure({
    streaming,
    hasProcess,
    failed: anyFailed || interrupted,
  });

  if (!hasProcess) return null;

  const title = timelineTitle({
    t,
    webFailed,
    searchStatus,
    running,
    webRunning,
    streaming,
    hasReasoning,
    webSearched,
    toolCount: toolEvents.length,
    webSearchCount,
    searchQueries: runningSearchQueries(toolEvents),
  });

  return (
    <section
      className={cn('relative mb-2', hasAnswer && 'pb-0.5')}
      aria-label={title}
      aria-live={streaming || anyFailed ? 'polite' : undefined}
      aria-busy={streaming || undefined}
    >
      <ProcessDisclosure
        id={panelId}
        expanded={disclosure.expanded}
        title={title}
        icon={
          <TimelineIcon
            running={running || streaming}
            failed={anyFailed}
            tone={webFailed ? 'destructive' : 'muted'}
          />
        }
        failed={webFailed}
        onToggle={disclosure.toggle}
      >
        <ProcessScrollArea
          expanded={disclosure.expanded}
          streaming={streaming}
          watch={`${rawReasoning.length}:${timeline.items.length}`}
          follow={disclosure.follow}
        >
          <ol>
            {timeline.items.map((item, itemIndex) => {
              const last = itemIndex === timeline.items.length - 1;
              if (item.kind === 'reasoning') {
                return (
                  <ProcessRailItem
                    key={item.id}
                    marker={soleReasoning ? null : <ProcessBullet />}
                    last={last}
                  >
                    <ReasoningSegment
                      reasoning={item.text}
                      streaming={streaming}
                      citations={citations}
                    />
                  </ProcessRailItem>
                );
              }
              return (
                <ProcessToolRow
                  key={item.id}
                  event={item.event}
                  citations={toolRowCitations(item.event, index, citations)}
                  onOpenSources={onOpenSources}
                  last={last}
                />
              );
            })}
          </ol>
        </ProcessScrollArea>
      </ProcessDisclosure>
    </section>
  );
}

/**
 * 顶行图标。
 *
 * 它与标题分开着色：标题是 muted 的状态说明，图标用 primary 把「这里发生过一段过程」
 * 标出来——整行都灰下去的话，折叠状态下过程区会整个从视野里消失。
 *
 * 转圈只有这一枚：顶行在收起态也在场，且「开了联网到首个工具帧到达」之间还有一段
 * 时间线为空的空档，动效必须由它承担。工具行因此不转圈（见 ProcessToolRow.ToolMarker），
 * 两处同时转是同一件事报两遍，各转各的更乱。
 *
 * 完成态不按「联网过没有」换图标：一列回答里每条顶行的图标都不同会让这一竖排变成
 * 杂色噪点，反而更难扫。联不联网由标题的文字区分（见 timelineTitle），那是同一行里
 * 本来就要读的内容，不必再占一个视觉通道。
 */
function TimelineIcon({
  running,
  failed,
  tone,
}: {
  running: boolean;
  failed: boolean;
  tone: 'destructive' | 'muted';
}) {
  if (failed) {
    return (
      <CircleAlert
        className={cn(
          'size-4 shrink-0',
          tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
        )}
        aria-hidden="true"
      />
    );
  }
  if (running) {
    return (
      <LoaderCircle
        className="size-4 shrink-0 text-primary motion-safe:animate-spin"
        aria-hidden="true"
      />
    );
  }
  return <Brain className="size-4 shrink-0 text-primary" aria-hidden="true" />;
}

/**
 * 生成顶行标题。
 *
 * 完成态只报「做了什么」，不带耗时：总耗时在正文下方的指标行里已经有一份（见
 * utils/metrics.ts），顶行再报一遍是同一个数出现两处，而且它是这一行里唯一会变的字，
 * 眼睛会先去读那个数字，反而盖住「做了什么」。总工具数同理不报；但成功搜索超过一次时
 * 报搜索次数，用户不需要展开就能知道模型分几轮取证。一次搜索本身无需重复“1 次”。
 *
 * 进行中的联网则相反，顶行要带上当前的查询词：它在这一档里是唯一会变的字，而这正是需要的——
 * 一轮搜索几秒起步，收起态除了顶行没有别的进度通道，静态文案挂在那里与卡死无从区分。
 * 完成态忌讳「唯一会变的数字」是因为那时已无进度可言，两者不冲突。
 *
 * 联网与纯思考必须分开报，这不是措辞偏好：纯思考是模型拿自己权重里的知识作答，联网是它
 * 真去外部取了证据回来，两者的可信度来源不同。都写成「已思考」会让用户无法判断这个答案
 * 该不该自己再核一遍——而这恰恰是他看过程区的原因。
 *
 * @param searchQueries 进行中的搜索查询词（已截断），空数组表示还没拿到
 * @returns 顶行标题文案
 */
function timelineTitle({
  t,
  webFailed,
  searchStatus,
  running,
  webRunning,
  streaming,
  hasReasoning,
  webSearched,
  webSearchCount,
  toolCount,
  searchQueries,
}: {
  t: (key: string, options?: Record<string, unknown>) => string;
  webFailed: boolean;
  searchStatus?: string;
  running: boolean;
  webRunning: boolean;
  streaming: boolean;
  hasReasoning: boolean;
  webSearched: boolean;
  webSearchCount: number;
  toolCount: number;
  searchQueries: string[];
}): string {
  if (webFailed) return searchStatus || t('searchStepFailed');
  if (running) {
    if (!webRunning) return t('toolsInProgress');
    // 查询词要到模型把 tool_call 参数生成完才随 running 帧到达，在那之前只能报静态文案。
    if (searchQueries.length === 0) return t('searchingPages');
    return t('searchingPagesQuery', { query: searchQueries.join(t('queryJoiner')) });
  }
  if (streaming) return t('reasoningInProgress');
  if (webSearched) {
    // 多轮搜索时报次数；单轮保持原文案，避免收起态被无信息量的“1 次”占宽。
    if (webSearchCount > 1) {
      return t(hasReasoning ? 'searchedAndReasonedCount' : 'searchedCompleteCount', {
        count: webSearchCount,
      });
    }
    // 联网了但没思考（思考深度关闭）仍要报联网：证据来源比「思考过」更值得留在收起态。
    return t(hasReasoning ? 'searchedAndReasoned' : 'searchedComplete');
  }
  if (hasReasoning) return t('reasoningComplete');
  return t('processUsingTools', { count: toolCount });
}
