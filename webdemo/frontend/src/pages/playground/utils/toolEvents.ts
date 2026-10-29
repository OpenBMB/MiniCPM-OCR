import type { ToolStatusEvent } from '@/api/map/chat';

import type { ToolEvent, ToolEventStatus } from '../types';
import { citationURLKey, safeCitationHref } from './citations';

/** 单条回答最多保留的工具事件数量，避免异常工具循环放大消息体。 */
export const MAX_TOOL_EVENTS = 32;

/** 单条工具事件最多保留的来源地址数，与过程行上叠放图标的展示上限对齐。 */
export const MAX_EVENT_CITATION_URLS = 8;

/** 单条工具事件最多保留的查询词数量，进行中的搜索行只是就地预告，不是完整清单。 */
export const MAX_EVENT_QUERIES = 4;

/** 顶行最多列出的查询词数：收起态只有这一行，列全会把「正在搜索」本身挤出视野。 */
const MAX_TITLE_QUERIES = 2;

/** 顶行单个查询词的字符上限，模型偶尔会把整句话塞进 query。 */
const MAX_TITLE_QUERY_CHARS = 14;

/**
 * 把后端下发的 urls 收敛成可落库的来源地址。
 *
 * 只保留能安全打开的 http(s) 地址，并统一成 citationURLKey 归一化形式——渲染时要拿它去
 * join message.citations 取标题，两边键不一致就永远匹配不上。
 *
 * @param urls 工具事件原始地址
 * @returns 去重且截断后的地址；一个都不剩时返回 undefined（不返回空数组，见 upsertToolEvent 的合并语义）
 */
function normalizeEventUrls(urls?: string[]): string[] | undefined {
  if (!urls?.length) return undefined;
  const keys = new Set<string>();
  for (const url of urls) {
    if (!safeCitationHref(url)) continue;
    keys.add(citationURLKey(url));
    if (keys.size >= MAX_EVENT_CITATION_URLS) break;
  }
  return keys.size > 0 ? [...keys] : undefined;
}

/**
 * 收敛查询词：去空白、去重、截断。
 *
 * @param queries 工具事件原始查询词
 * @returns 截断后的查询词；一个都不剩时返回 undefined（空数组会「合法覆盖」掉首帧的值）
 */
function normalizeEventQueries(queries?: string[]): string[] | undefined {
  if (!queries?.length) return undefined;
  const seen = new Set<string>();
  for (const query of queries) {
    const trimmed = query.trim();
    if (!trimmed) continue;
    seen.add(trimmed);
    if (seen.size >= MAX_EVENT_QUERIES) break;
  }
  return seen.size > 0 ? [...seen] : undefined;
}

/** 将后端状态归一化为前端可渲染的工具事件状态。 */
function normalizeToolEventStatus(status?: string): ToolEventStatus {
  if (status === 'success' || status === 'failed' || status === 'interrupted') {
    return status;
  }
  return 'running';
}

/** 为没有 event_id 的旧 SSE 事件生成稳定兼容键。 */
export function toolEventKey(event: Pick<ToolStatusEvent, 'event_id' | 'step' | 'tool'>): string {
  if (event.event_id) return event.event_id;
  return `legacy:${event.step ?? 0}:${event.tool ?? 'unknown'}`;
}

/**
 * 将单个后端工具状态事件转换为前端摘要事件。
 * @param event 后端工具状态事件
 * @param reasoningOffset 该工具首帧到达时已产出的思考字符数，用作过程时间线的切分点
 */
export function toToolEvent(event: ToolStatusEvent, reasoningOffset?: number): ToolEvent {
  const queryCount = event.queries?.length;
  const queries = normalizeEventQueries(event.queries);
  const pageCount = event.urls?.length;
  const citationUrls = normalizeEventUrls(event.urls);
  return {
    eventId: toolEventKey(event),
    step: event.step ?? 0,
    tool: event.tool ?? 'unknown',
    status: normalizeToolEventStatus(event.status),
    ...(queryCount !== undefined ? { queryCount } : {}),
    ...(queries ? { queries } : {}),
    ...(event.result_count !== undefined ? { resultCount: event.result_count } : {}),
    ...(pageCount !== undefined ? { pageCount } : {}),
    ...(event.duration_ms !== undefined ? { durationMs: event.duration_ms } : {}),
    ...(event.message ? { message: event.message } : {}),
    ...(citationUrls ? { citationUrls } : {}),
    ...(reasoningOffset !== undefined ? { reasoningOffset } : {}),
  };
}

/**
 * 将工具状态追加或合并到事件列表。
 * @param events 当前事件列表
 * @param incoming 后端工具状态事件
 * @param reasoningOffset 思考切分点，仅在该事件首次出现时采用
 * @returns 不超过上限且保持时间顺序的事件列表
 */
export function upsertToolEvent(
  events: ToolEvent[],
  incoming: ToolStatusEvent,
  reasoningOffset?: number,
): ToolEvent[] {
  const nextEvent = toToolEvent(incoming, reasoningOffset);
  const index = events.findIndex((event) => event.eventId === nextEvent.eventId);
  if (index < 0) {
    return [...events, nextEvent].slice(-MAX_TOOL_EVENTS);
  }

  const current = events[index];
  const merged: ToolEvent = {
    ...current,
    ...nextEvent,
    queryCount: nextEvent.queryCount ?? current.queryCount,
    queries: nextEvent.queries ?? current.queries,
    resultCount: nextEvent.resultCount ?? current.resultCount,
    pageCount: nextEvent.pageCount ?? current.pageCount,
    durationMs: nextEvent.durationMs ?? current.durationMs,
    message: nextEvent.message ?? current.message,
    // 地址取"有就覆盖、没有就留着"：web_extractor 的 running 与 success 两帧都带 urls，
    // 而 normalizeEventUrls 在一个都不剩时给 undefined，不会拿空值抹掉首帧的结果。
    citationUrls: nextEvent.citationUrls ?? current.citationUrls,
    // 切分点必须锚在工具"开始"的那一刻，所以 current 优先：success 帧比 running 帧晚几秒，
    // 用它重算会把这期间流出的思考错划到工具行之前。
    reasoningOffset: current.reasoningOffset ?? nextEvent.reasoningOffset,
  };
  const result = [...events];
  result[index] = merged;
  return result;
}

/**
 * 取出当前进行中的搜索查询词，供过程区顶行做动态摘要。
 *
 * 顶行是收起态唯一在场的进度通道，而一轮搜索几秒起步。期间它若一直是静态的「正在搜索」，
 * 用户无从判断是真在跑还是卡住了——展开态的工具行早就把查询词逐个显示了（见 ProcessToolRow
 * 的 RunningQueries），收起时这条信息却整个消失，只剩一个转圈图标。
 *
 * 不按工具名过滤：带 queries 的只有搜索类工具（web_extractor 的 running 帧带的是 urls），
 * 用字段在不在判断既够用，也不必让本模块反向依赖 answerTimeline 的 WEB_TOOLS。
 *
 * @param events 当前工具事件列表
 * @returns 去首尾空白、按长度截断后的查询词；没有进行中的搜索时返回空数组
 */
export function runningSearchQueries(events: ToolEvent[]): string[] {
  const queries: string[] = [];
  for (const event of events) {
    if (event.status !== 'running') continue;
    for (const query of event.queries ?? []) {
      const trimmed = query.trim();
      if (!trimmed) continue;
      queries.push(
        trimmed.length > MAX_TITLE_QUERY_CHARS
          ? `${trimmed.slice(0, MAX_TITLE_QUERY_CHARS)}…`
          : trimmed,
      );
      if (queries.length >= MAX_TITLE_QUERIES) return queries;
    }
  }
  return queries;
}

/** 将生命周期结束时仍运行的事件统一落为指定终态。 */
export function finalizeToolEvents(
  events: ToolEvent[],
  status: Extract<ToolEventStatus, 'failed' | 'interrupted'>,
): ToolEvent[] {
  return events.map((event) => (event.status === 'running' ? { ...event, status } : event));
}
