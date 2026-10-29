/**
 * 回答过程时间线的排序与取数纯函数。
 *
 * 用途：把「一整块流式思考文本」与「按到达顺序排列的工具事件」还原成模型真实的
 * 「思考 → 调工具 → 继续思考」单条时间线，并为工具行解析出就地展示的来源。
 */

import type { Citation, ToolEvent } from '../types';
import { citationURLKey } from './citations';

/** 归联网过程的工具名。 */
export const WEB_TOOLS = new Set(['web_search', 'web_extractor']);

/** 工具行与来源胶囊上最多叠放的站点图标数；多出来的不计数，那一叠只是「碰了这些站点」的示意。 */
export const MAX_ROW_FAVICONS = 4;

/** 工具行上最多内联展示的页面标题数，超出用 +N 表示。 */
export const MAX_ROW_TITLES = 3;

/** stagger 入场动画的单步延时与最大档位，避免来源多时最后一个要等好几秒。 */
export const STAGGER_STEP_MS = 60;
export const STAGGER_MAX_STEPS = 6;

/**
 * 判断工具是否为内置网页读取器（web_extractor）。
 * @param tool 工具名
 * @returns true 表示该工具用于读取网页正文而非搜索结果
 */
export function isReaderTool(tool: string | undefined): boolean {
  return tool === 'web_extractor';
}

/**
 * 判断工具是否为内置联网搜索（web_search）。
 * @param tool 工具名
 * @returns true 表示该工具产出的是搜索结果列表
 */
export function isSearchTool(tool: string | undefined): boolean {
  return tool === 'web_search';
}

/** 时间线上的一项：一段思考文本，或一次工具调用。 */
export type ProcessTimelineItem =
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'tool'; id: string; event: ToolEvent };

/** 时间线排序结果。 */
export interface ProcessTimeline {
  items: ProcessTimelineItem[];
  /**
   * 是否真正做到了交错。false 表示退化成「思考整块置顶 + 工具依次排下」——
   * 仍是一条线，只是分不出工具是在思考的哪一处插进来的。
   */
  interleaved: boolean;
}

/**
 * 把思考文本按工具事件的切分点切段，与工具行交错成一条时间线。
 *
 * 切分点是 `ToolEvent.reasoningOffset`（流式期间在 SSE 回调里累加得到的字符数）。
 * 传入的 `reasoning` 必须是**未 trim 的原文**：offset 是按原文累加的，先 trim 再按 offset
 * 切会整体错位（模型惯常在调工具前留一个换行，trim 掉之后显示长度反而短于 offset）。
 * 段内首尾空白由逐段 trim 收拾。
 *
 * 以下两种情况无法交错，退化为思考整块置顶：
 * - `reasoningRewritten`：展示层的 normalizeAssistantReply 改写过思考文本（清空或前置拼接
 *   正文里的残留 think 段），offset 全部错位；
 * - 任一事件缺 `reasoningOffset`：非流式回答一次性给全文，本次改动之前存下的历史消息同理。
 *
 * @param input 思考原文、按到达顺序的工具事件、是否被展示层改写过、是否押后未播到的工具行
 * @returns 时间线各项与是否真正交错
 */
export function buildProcessTimeline(input: {
  reasoning: string;
  toolEvents: ToolEvent[];
  reasoningRewritten?: boolean;
  /** 流式期间传 true：切分点还没被播放队列播到的工具行先不出现，见循环内注释。 */
  holdUnplayed?: boolean;
}): ProcessTimeline {
  const { reasoning, toolEvents, reasoningRewritten = false, holdUnplayed = false } = input;
  const canInterleave =
    !reasoningRewritten &&
    toolEvents.length > 0 &&
    toolEvents.every((event) => event.reasoningOffset !== undefined);

  if (!canInterleave) {
    const items: ProcessTimelineItem[] = [];
    pushReasoning(items, reasoning, 0);
    for (const event of toolEvents) {
      items.push({ kind: 'tool', id: event.eventId, event });
    }
    return { items, interleaved: false };
  }

  const items: ProcessTimelineItem[] = [];
  // 单游标推进即可：后端 emit 从不设 event_id，toolEventKey 走 legacy:step:tool 兜底，
  // 所以 toolEvents 的数组顺序就是到达顺序，不需要再按 step 分组。
  // 下界取 cursor 保证单调（同一 step 的多个工具共用一个切点时不会回退）。
  let cursor = 0;
  for (const event of toolEvents) {
    const target = event.reasoningOffset ?? 0;
    /*
      流式期间「还没播到的」工具行先押着不出。offset 记的是 SSE 到达那一刻**已 enqueue**
      的字符数，而这里的 reasoning 是过了 16ms 播放队列的**已显示**文本，两者差着整个积压。
      不押的话下面的 clamp 会把切点按显示长度往前拽，工具行就抢在它上方那段思考播完之前
      先冒出来——读起来是「话没说完先跳出一行」。押到播到为止，顺序才与模型真实执行一致。

      工具事件按到达顺序单调，所以第一个没播到的就可以整体 break。
    */
    if (holdUnplayed && target > reasoning.length) break;
    const offset = clamp(target, cursor, reasoning.length);
    if (offset > cursor) {
      pushReasoning(items, reasoning.slice(cursor, offset), cursor);
      cursor = offset;
    }
    items.push({ kind: 'tool', id: event.eventId, event });
  }
  if (cursor < reasoning.length) {
    pushReasoning(items, reasoning.slice(cursor), cursor);
  }
  return { items, interleaved: true };
}

/**
 * 追加一段思考。
 *
 * 纯空白不单独成段（否则时间线上会留一个空项），段内首尾空白也一并去掉：切出来的段常以
 * 换行开头，而首行缩进 4 个空格会被 markdown 当成代码块。
 */
function pushReasoning(items: ProcessTimelineItem[], text: string, offset: number): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  items.push({ kind: 'reasoning', id: `reasoning:${offset}`, text: trimmed });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 为来源建立按归一化 URL 检索的索引，供工具行按 citationUrls 取标题。
 * @param citations 整条消息的来源
 * @returns 归一化 URL → 来源
 */
export function citationIndex(citations: Citation[]): Map<string, Citation> {
  return new Map(citations.map((citation) => [citationURLKey(citation.url), citation]));
}

/**
 * 取某个工具行上要展示的来源。
 *
 * web_extractor 的事件自带 urls，能精确对上它读了哪几页；web_search 的事件后端一个 url
 * 都不发（只有 queries 与 result_count），所以退回整条消息的来源——单次搜索时两者等价，
 * 多次搜索时各行会展示同一批图标，这是已知且可接受的近似。
 *
 * @param event 工具事件
 * @param index citationIndex 建好的索引
 * @param allCitations 整条消息的来源，供 web_search 兜底
 * @returns 该行的来源；匹配不到标题时至少保留地址，供 favicon 使用
 */
export function toolRowCitations(
  event: ToolEvent,
  index: Map<string, Citation>,
  allCitations: Citation[],
): Citation[] {
  if (event.citationUrls?.length) {
    return event.citationUrls.map((url) => index.get(url) ?? { url });
  }
  return isSearchTool(event.tool) ? allCitations : [];
}

/**
 * 按下标给出递增入场延时，超过档位上限后不再增加。
 * @param index 元素下标
 * @returns 可直接用于 style 的 animationDelay
 */
export function staggerStyle(index: number): { animationDelay: string } {
  return { animationDelay: `${Math.min(index, STAGGER_MAX_STEPS) * STAGGER_STEP_MS}ms` };
}

/**
 * stagger 入场动画的 class。
 * fill-mode-both 必须带上：否则延时期间元素以终态显示，等到动画真正开始才跳回起点，
 * 逐个冒出的观感会变成「先全部出现再闪一下」。
 */
export const STAGGER_CLASS_NAME =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-both';
