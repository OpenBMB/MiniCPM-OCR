/**
 * 引用角标 → Markdown 链接的预处理。
 *
 * 用途：模型被提示"在论断后紧跟 `[ref_N]` 角标"，实际输出里还会混进裸 `[N]`（中文模型的
 * 普遍先验）。在 Markdown 解析前把两种角标都改写成指向对应来源的链接，正文渲染侧就只需
 * 处理 `a` 一种情况，无需在 p/li/td 的 children 里遍历文本节点。
 *
 * 编号一律按后端下发的 ref 查，而不是按 citations 数组下标：数组是跨轮累积并去重的，
 * 后端每轮又会按相关性重排结果，两者只在单轮搜索时碰巧对齐。
 */

import type { Citation } from '../types';
import { safeCitationHref } from './citations';

/**
 * 代码区段：围栏代码块与行内代码。
 *
 * 围栏用 ```` ```…``` ```` / `~~~…~~~`，收尾允许命中字符串结尾——流式期间围栏尚未闭合时，
 * 应当把剩余全文都视为代码，避免代码里的 `[1]` 被改写成链接。
 */
const CODE_SEGMENT = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g;

/**
 * 引用角标：`[ref_N]`（提示词要求的形态）或裸 `[N]`（模型不听话时的兜底）。
 *
 * 一个方括号里允许多个编号（`[ref_3, ref_5]`）：提示词只要求「论断后紧跟角标」，从没规定
 * 一处只能引一个来源，模型把多来源合写进一个方括号是常态。不认这种形态的代价不只是少个
 * 链接——残留的裸角标会掉进裸数学识别，`ref_3, ref_5` 正好满足下标特征，方括号被当成公式
 * 定界符吃掉，正文里只剩一串斜体（数学侧的兜底见 math-katex 的 isCitationMarker）。
 *
 * 位数放到 3 与后端 hostedRefMarkerRe 对齐；放宽不会增加误伤，因为编号必须能在
 * ref 表里查到才改写（见 resolveCitation），查不到的一律原样留着。
 * 半截的 `[1` 天然不匹配，流式下无需额外防御。
 */
const CITATION_MARKER = /\[(?:ref_)?\d{1,3}(?:\s*[,，、;；]\s*(?:ref_)?\d{1,3})*\]/g;

/** 从角标内部逐个取编号，顺序与模型书写顺序一致。 */
const MARKER_NUMBER = /(?:ref_)?(\d{1,3})/g;

/** 紧挨角标左侧时说明这是下标取值（如 `arr[1]`）而非引用，不应改写。 */
const IDENTIFIER_CHAR = /[A-Za-z0-9_$\]]/;

/** 左侧紧邻的同形角标，用于把 `[1][2]` 这类连续角标当成一串整体判定归属。 */
const TRAILING_MARKER = /\[(?:ref_)?\d{1,3}(?:\s*[,，、;；]\s*(?:ref_)?\d{1,3})*\]$/;

/**
 * 把正文中的引用角标改写为指向来源的 Markdown 链接。
 *
 * 仅在编号能查到来源时改写，因此流式期间来源尚未到达的角标会保持原样，
 * 等来源送达后的下一次渲染再变成链接。
 *
 * @param markdown 模型输出的 Markdown 原文
 * @param citations 本轮回答已收到的来源
 * @returns 角标已替换为 Markdown 链接的文本；无来源时原样返回
 */
export function linkifyCitationMarkers(markdown: string, citations: Citation[]): string {
  if (!markdown || citations.length === 0) return markdown;
  if (!markdown.includes('[')) return markdown;

  const byRef = new Map<number, Citation>();
  for (const citation of citations) {
    if (citation.ref && !byRef.has(citation.ref)) byRef.set(citation.ref, citation);
  }

  // 按代码区段切分：split 带捕获组时，奇数下标即分隔符本身（代码），保持原样不动。
  return markdown
    .split(CODE_SEGMENT)
    .map((segment, index) =>
      index % 2 === 1 ? segment : linkifySegment(segment, citations, byRef),
    )
    .join('');
}

/**
 * 按角标编号找对应来源。
 *
 * 后端一旦下发过 ref，编号就只认 ref 表：查不到说明模型编了个不存在的号，
 * 此时宁可留着裸文本，也不能退回数组下标——那恰好会把无效角标指向一条无关来源。
 * 整批都没有 ref 才说明对接的是老后端，此时数组下标是唯一可用的口径。
 */
function resolveCitation(
  citations: Citation[],
  byRef: Map<number, Citation>,
  index: number,
): Citation | undefined {
  if (byRef.size > 0) return byRef.get(index);
  return citations[index - 1];
}

/** 改写单个非代码区段中的角标。 */
function linkifySegment(
  segment: string,
  citations: Citation[],
  byRef: Map<number, Citation>,
): string {
  return segment.replace(CITATION_MARKER, (match: string, offset: number) => {
    const before = chainLeadingChar(segment, offset);
    // `![1]` 是图片语法
    if (before === '!') return match;
    // `arr[1]` 是下标取值。这道判据只对裸角标生效：`ref_` 前缀本身已经消歧，而英文正文里
    // 「论断紧跟角标」必然写成 blue[ref_1] 这种形状，按标识符一刀切会把英文回答的角标整批吞掉。
    if (!match.startsWith('[ref_') && before !== undefined && IDENTIFIER_CHAR.test(before)) {
      return match;
    }

    const after = segment.slice(offset + match.length);
    // `[1](…)` 已是链接，`[1]: …` 是链接引用定义，都不能再包一层
    if (after.startsWith('(') || after.startsWith(':')) return match;

    return linkifyMarker(match, citations, byRef);
  });
}

/**
 * 把一个角标改写成相邻的 Markdown 链接，`[ref_3, ref_5]` 这类合写会展开成多个。
 *
 * 任一编号查不到来源、或地址不可安全嵌入就整体放弃：半改写会把 `[ref_3, ref_5]` 变成
 * 「一个链接 + 一截裸文本」，读者无从判断后半截是没搜到还是渲染坏了，不如整条留作原文。
 *
 * @param match 匹配到的完整角标文本
 * @param citations 本轮回答已收到的来源
 * @param byRef 按后端下发 ref 建立的来源索引
 * @returns 改写后的链接串；任一编号不可解析时原样返回
 */
function linkifyMarker(match: string, citations: Citation[], byRef: Map<number, Citation>): string {
  const links: string[] = [];
  for (const [, digits] of match.matchAll(MARKER_NUMBER)) {
    const index = Number(digits);
    const citation = resolveCitation(citations, byRef, index);
    if (!citation) return match;
    const destination = markdownDestination(citation.url);
    if (!destination) return match;
    links.push(`[${index}](${destination})`);
  }
  return links.length > 0 ? links.join('') : match;
}

/**
 * 取角标所在「连续角标串」左侧第一个字符。
 *
 * `]` 本身在 IDENTIFIER_CHAR 里（为挡住 `arr[1]`），若直接看前一个字符，`[1][2]` 的第二个角标
 * 会被误判成下标链。先把左侧连续的同形角标逐个剥掉，再用串首前的字符决定整串是引用还是下标：
 * `两处都提到[1][2]` 剥到「到」→ 是引用；`arr[1][2]` 剥到「r」→ 是下标。
 *
 * @param segment 当前非代码区段
 * @param offset 本次匹配在区段中的起始位置
 * @returns 串首左侧字符；角标位于区段开头时返回 undefined
 */
function chainLeadingChar(segment: string, offset: number): string | undefined {
  let start = offset;
  let trailing = TRAILING_MARKER.exec(segment.slice(0, start));
  while (trailing) {
    start -= trailing[0].length;
    trailing = TRAILING_MARKER.exec(segment.slice(0, start));
  }
  return start > 0 ? segment[start - 1] : undefined;
}

/**
 * 生成可安全嵌入 Markdown 链接的目标地址。
 * 含空白或括号的地址必须用尖括号包裹，否则 Markdown 解析会在第一个 `)` 处截断。
 */
function markdownDestination(url: string): string | undefined {
  if (!safeCitationHref(url)) return undefined;
  if (url.includes('<') || url.includes('>')) return undefined;
  return /[\s()]/.test(url) ? `<${url}>` : url;
}
