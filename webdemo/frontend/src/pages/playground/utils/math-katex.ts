/**
 * 裸数学表达式识别与 KaTeX 语法校验。
 *
 * 用途：识别未加定界符的模型数学输出，并由 KaTeX 判断命令与环境是否受支持。
 */

import katex from 'katex';

import {
  hasMarkdownAsteriskEmphasis,
  normalizeInlineCodeMath as normalizeMarkdownInlineCodeMath,
  splitDollarMath,
  wrapBracketedMath,
} from './math-markdown';
import { SAFE_KATEX_OPTIONS } from './math-options';

const KATEX_CACHE_LIMIT = 512;
const KATEX_MAX_INPUT_LENGTH = 20_000;
const KATEX_VALIDITY_CACHE = new Map<string, boolean>();
const TEXT_COMMAND_PATTERN =
  /\\(?:text|textrm|textsf|texttt|textnormal|textbf|textit|emph|operatorname|mathrm|mathbf|mathsf|mathtt|mathit)\*?\s*\{/g;
const COMMON_MATH_IDENTIFIERS = new Set([
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'log',
  'ln',
  'lim',
  'max',
  'min',
  'det',
  'exp',
  'mod',
  'gcd',
  'lcm',
]);
const PROSE_IDENTIFIERS = new Set([
  'active',
  'and',
  'are',
  'else',
  'for',
  'given',
  'if',
  'is',
  'latest',
  'let',
  'or',
  'price',
  'production',
  'status',
  'then',
  'version',
  'when',
  'where',
  'with',
]);

/** 把普通文本中的裸数学块补成块级公式，已有美元符公式不会进入此函数。 */
export function wrapBareMath(text: string): string {
  const withBracketedMath = wrapBracketedMath(text, isBareMath);
  const blocks = withBracketedMath.split(/(\n[ \t]*\n+)/);
  return blocks
    .map((block, index) => {
      if (index % 2 === 1 || !block.trim()) return block;
      // 全英文/数字表格也可能通过 KaTeX 校验，必须先保护表格行，避免整表误转成公式。
      if (!block.split('\n').some(isMarkdownTableRow) && isBareMath(block.trim())) {
        return preserveOuterWhitespace(block, wrapDisplayMath);
      }

      const withEnvironments = wrapSupportedEnvironments(block);
      return splitDollarMath(withEnvironments)
        .map((segment) => {
          if (segment.protected) return segment.value;
          return segment.value
            .split('\n')
            .map((line) =>
              isBareMath(line.trim()) ? preserveOuterWhitespace(line, wrapDisplayMath) : line,
            )
            .join('\n');
        })
        .join('');
    })
    .join('');
}

/**
 * 把模型误用反引号包裹的明确数学表达式转换为行内公式。
 *
 * 仅接受 KaTeX 可完整解析，且包含显式命令、Unicode 数学运算符或至少两类数学结构的内容；
 * 单个变量、路径、命令和普通代码继续保留 Markdown 代码语义。
 */
export function normalizeInlineCodeMath(codeSpan: string): string {
  return normalizeMarkdownInlineCodeMath(codeSpan, isBareMath);
}

/** 将完整且受 KaTeX 支持的任意裸环境转换为块级公式。 */
function wrapSupportedEnvironments(text: string): string {
  let cursor = 0;
  let output = '';
  while (cursor < text.length) {
    const range = findNextEnvironment(text, cursor);
    if (!range) return output + text.slice(cursor);
    output += text.slice(cursor, range.start);
    const environment = text.slice(range.start, range.end);
    if (!isSupportedKatex(environment)) {
      output += environment;
      cursor = range.end;
      continue;
    }
    if (output && !output.endsWith('\n')) output += '\n';
    output += wrapDisplayMath(environment);
    if (range.end < text.length && text[range.end] !== '\n') output += '\n';
    cursor = range.end;
  }
  return output;
}

/** 查找下一个配对完整的 LaTeX 环境，支持环境嵌套。 */
function findNextEnvironment(
  text: string,
  from: number,
): { start: number; end: number } | undefined {
  const tokenPattern = /\\(begin|end)\{([^{}\s]+)\}/g;
  tokenPattern.lastIndex = from;
  let token = tokenPattern.exec(text);
  while (token && token[1] !== 'begin') token = tokenPattern.exec(text);
  if (!token) return undefined;

  const start = token.index;
  const stack = [token[2]];
  while ((token = tokenPattern.exec(text))) {
    const [, kind, name] = token;
    if (kind === 'begin') {
      stack.push(name);
      continue;
    }
    if (stack[stack.length - 1] !== name) return undefined;
    stack.pop();
    if (stack.length === 0) return { start, end: tokenPattern.lastIndex };
  }
  return undefined;
}

/**
 * 判断一段文本是否为模型吐出的工具调用/属性标记，而不是公式。
 *
 * 小模型会把工具调用当正文输出（2026-09-21 实测 MiniCPM5-2B：
 * `name="weather_search"> name="location">Beijing`）。这类残片里的 `=`、`>`、`_`
 * 会被当成关系符和下标，KaTeX 又恰好能解析成功，于是整段被渲染成衬线公式。
 * isBareMath 里的 HTML 标签护栏拦不住它——残片里根本没有 `<`。
 */
function isToolCallMarkup(value: string): boolean {
  // 公式基本不含 ASCII 双引号；英寸/角分等写法请显式用 $...$ 包裹。
  if (value.includes('"')) return true;
  // key="value" / key='value' 形态的属性赋值。
  if (/[A-Za-z_][\w-]*\s*=\s*["'][^"']*["']/.test(value)) return true;
  // snake_case 标识符：真实下标几乎都是单字符（x_1、F_{net}），两侧各两个以上字母的更像代码。
  if (/[A-Za-z]{2,}_[A-Za-z]{2,}/.test(value)) return true;
  return false;
}

/**
 * 判断一行是否只由 Markdown 标记符号组成，不含任何被运算的内容。
 *
 * `---`、`***` 是分割线，`---`、`===` 紧跟段落时是 setext 标题下划线，落单的 `-`、`+`、`>`
 * 是空列表项或空引用。这些行里的 `-`、`*`、`=` 会被当成运算符和关系符，KaTeX 又恰好能解析成功，
 * 于是分割线被渲染成一串衬线减号，setext 标题也被拆成「段落 + 公式」两块。
 * 真实公式至少含一个被运算的字母、数字或命令，整类排除不会误伤。
 */
function isMarkdownPunctuationLine(value: string): boolean {
  return /^[-*_=+>][-*_=+>\t ]*$/.test(value);
}

/** 判断一段独占内容是否具备明确数学特征且能被 KaTeX 完整解析。 */
export function isBareMath(value: string): boolean {
  if (!value || value.length > KATEX_MAX_INPUT_LENGTH || value.includes('$')) return false;
  if (isMarkdownPunctuationLine(value)) return false;
  if (hasMarkdownAsteriskEmphasis(value)) return false;
  if (value.includes('://') || /<\/?[A-Za-z][^>]*>/.test(value)) return false;
  if (/^(?:\/|\.{1,2}\/|[A-Za-z]:[\\/])/.test(value)) return false;
  if (/^(?: {0,3})(?:#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(value)) return false;
  if (isMarkdownTableRow(value) || isCommonNonMathLiteral(value)) return false;
  if (isCitationMarker(value)) return false;
  if (!hasBalancedBraces(value)) return false;

  const textMasked = maskTextCommandArguments(value);
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(textMasked)) {
    return false;
  }

  const hasCommand = /\\[A-Za-z@]+/.test(value);
  const startsWithCommand = /^\\[A-Za-z@]+/.test(value);
  const hasEnvironment = /\\begin\{[^{}\s]+\}/.test(value);
  const hasRelation = /[=<>≤≥≠≈≃≅∝∈∉⊂⊃⊆⊇→←↔⇒⇐⇔]/.test(value);
  const hasScript = /[_^]/.test(value);
  const hasOperator = /[+\-*/×÷±∓·⋅∘∑∏∫√]/.test(value);
  const hasFunctionShape = /(?:^|[^A-Za-z])[A-Za-z]\s*\([^)]*\)/.test(value);
  const identifiers = textMasked
    .replace(/\\(?:begin|end)\{[^{}]+\}/g, ' ')
    .replace(/\\[A-Za-z@]+|\\./g, ' ')
    .match(/[A-Za-z]+/g);
  const normalizedIdentifiers = (identifiers ?? []).map((identifier) => identifier.toLowerCase());
  const containsProseIdentifier = normalizedIdentifiers.some((identifier) =>
    PROSE_IDENTIFIERS.has(identifier),
  );
  const allIdentifiersShortOrMath = normalizedIdentifiers.every(
    (identifier) => identifier.length <= 3 || COMMON_MATH_IDENTIFIERS.has(identifier),
  );

  const hasMathStructure = hasRelation || hasScript || hasOperator || hasFunctionShape;
  if (!hasEnvironment && !startsWithCommand && !hasMathStructure && !hasCommand) return false;
  // 以 LaTeX 命令或环境开头是明确的公式意图，不套用工具调用启发式；其余内容一律先排除标记残片。
  if (!startsWithCommand && !hasEnvironment && isToolCallMarkup(textMasked)) return false;
  if (containsProseIdentifier) return false;
  if (
    !startsWithCommand &&
    !hasEnvironment &&
    !allIdentifiersShortOrMath &&
    !hasScript &&
    !hasOperator &&
    !hasFunctionShape
  ) {
    return false;
  }
  return isSupportedKatex(value);
}

/**
 * 用 KaTeX 公共 API 校验完整语法，预览与公式编辑共用安全配置和有界缓存。
 * @param value 不带数学定界符的 LaTeX
 * @returns 是否可以安全解析为公式
 */
export function isSupportedKatex(value: string): boolean {
  const cached = KATEX_VALIDITY_CACHE.get(value);
  if (cached !== undefined) return cached;
  let valid = true;
  try {
    katex.renderToString(value, {
      ...SAFE_KATEX_OPTIONS,
      displayMode: true,
      output: 'mathml',
      throwOnError: true,
    });
  } catch {
    valid = false;
  }
  if (KATEX_VALIDITY_CACHE.size >= KATEX_CACHE_LIMIT) {
    const oldest = KATEX_VALIDITY_CACHE.keys().next().value as string | undefined;
    if (oldest) KATEX_VALIDITY_CACHE.delete(oldest);
  }
  KATEX_VALIDITY_CACHE.set(value, valid);
  return valid;
}

/** 屏蔽 `\text{...}` 等文本命令参数，使公式内中文不会被当作外部说明文字。 */
function maskTextCommandArguments(value: string): string {
  const chars = value.split('');
  TEXT_COMMAND_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TEXT_COMMAND_PATTERN.exec(value))) {
    const open = match.index + match[0].lastIndexOf('{');
    const close = findClosingBrace(value, open);
    if (close < 0) break;
    for (let index = open + 1; index < close; index += 1) {
      if (chars[index] !== '\n') chars[index] = ' ';
    }
    TEXT_COMMAND_PATTERN.lastIndex = close + 1;
  }
  return chars.join('');
}

/** 找到指定左花括号对应的右花括号。 */
function findClosingBrace(value: string, open: number): number {
  let depth = 0;
  for (let index = open; index < value.length; index += 1) {
    if (isEscaped(value, index)) continue;
    if (value[index] === '{') depth += 1;
    if (value[index] === '}') depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

/** 流式输出分组尚未闭合时保持纯文本，避免短暂显示 KaTeX 错误。 */
function hasBalancedBraces(value: string): boolean {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (isEscaped(value, index)) continue;
    if (value[index] === '{') depth += 1;
    if (value[index] === '}') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** 保留原字符串两侧空白，仅替换中间有效内容。 */
function preserveOuterWhitespace(value: string, transform: (content: string) => string): string {
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  return `${leading}${transform(value.slice(leading.length, value.length - trailing.length))}${trailing}`;
}

/** 生成 remark-math 可识别的块级公式。 */
function wrapDisplayMath(value: string): string {
  return `$$\n${value.trim()}\n$$`;
}

/** 排除 Markdown 表格行，同时允许 `|x|` 这类绝对值公式。 */
function isMarkdownTableRow(value: string): boolean {
  return /^\s*\|.*\|\s*$/.test(value) && (value.match(/\|/g)?.length ?? 0) >= 3;
}

/** 排除日期等外形类似算式的常见非数学字面量。 */
function isCommonNonMathLiteral(value: string): boolean {
  return /^\d{4}-\d{1,2}-\d{1,2}$/.test(value) || /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value);
}

/**
 * 排除联网搜索的引用角标，它长得像下标但不是公式。
 *
 * 提示词要求模型在论断后紧跟 `[ref_N]`，多来源时模型还会合写成 `[ref_3, ref_5]`。这类角标
 * 会把裸数学识别的每一道判据都恰好走通：`_` 命中 hasScript，`ref` 只有三个字母、过得了
 * allIdentifiersShortOrMath，KaTeX 又能把 `ref_1` 当下标解析成功。于是 wrapBracketedMath
 * 把方括号当成公式定界符吃掉，正文里只剩一个斜体下标——角标没了，来源也没了。
 *
 * 角标能否改写成链接取决于来源是否已到达（见 citationMarkers），流式途中、编号查不到来源、
 * 或思考文本里没有来源可查时，它都会以裸文本形态走到这里。改写与否是另一回事，但它在任何
 * 情况下都不是公式，所以这道护栏留在数学侧兜底，不依赖上游是否改写成功。
 */
function isCitationMarker(value: string): boolean {
  // 允许可选的外层方括号：wrapBracketedMath 传进来的是括号内的 body，而独占一行时整行仍带括号。
  return /^\[?\s*ref_\d{1,3}(?:\s*[,，、;；]\s*ref_\d{1,3})*\s*\]?$/.test(value);
}

/** 判断当前位置字符是否被奇数个反斜杠转义。 */
function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}
