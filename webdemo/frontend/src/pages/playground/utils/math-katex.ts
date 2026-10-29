/**
 * Bare math-expression recognition and KaTeX syntax checks.
 *
 * Purpose: recognize model math output that has no delimiters, and let KaTeX decide whether a command or environment is supported.
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

/** Turn a bare math block in ordinary text into a block formula; formulas that already use dollar signs do not enter this function. */
export function wrapBareMath(text: string): string {
  const withBracketedMath = wrapBracketedMath(text, isBareMath);
  const blocks = withBracketedMath.split(/(\n[ \t]*\n+)/);
  return blocks
    .map((block, index) => {
      if (index % 2 === 1 || !block.trim()) return block;
      // An all-English or all-numeric table can also pass KaTeX checks, so table rows must be protected first, or the whole table would be turned into a formula by mistake.
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
 * Turn an explicit math expression the model wrapped in backticks by mistake into an inline formula.
 *
 * Accept only content KaTeX can parse completely, and that contains an explicit command, a Unicode math operator, or at least two kinds of math structure;
 * a single variable, a path, a command, and ordinary code keep Markdown code semantics.
 */
export function normalizeInlineCodeMath(codeSpan: string): string {
  return normalizeMarkdownInlineCodeMath(codeSpan, isBareMath);
}

/** Turn any complete bare environment that KaTeX supports into a block formula. */
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

/** Find the next fully paired LaTeX environment, supporting nested environments. */
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
 * Whether a piece of text is a tool-call or attribute marker the model emitted, rather than a formula.
 *
 * Small models emit tool calls as body text (measured 2026-09-21 on MiniCPM5-2B:
 * `name="weather_search"> name="location">Beijing`). The `=`, `>`, and `_` in such a fragment
 * are taken as relations and subscripts, and KaTeX happens to parse it, so the whole fragment is rendered as a serif formula.
 * The HTML-tag guard in isBareMath does not stop it — the fragment has no `<` at all.
 */
function isToolCallMarkup(value: string): boolean {
  // A formula basically contains no ASCII double quotes; write inches or arcminutes explicitly inside $...$.
  if (value.includes('"')) return true;
  // Attribute assignment of the form key="value" / key='value'.
  if (/[A-Za-z_][\w-]*\s*=\s*["'][^"']*["']/.test(value)) return true;
  // A snake_case identifier: a real subscript is almost always a single character (x_1, F_{net}); two or more letters on each side looks more like code.
  if (/[A-Za-z]{2,}_[A-Za-z]{2,}/.test(value)) return true;
  return false;
}

/**
 * Whether a line is made only of Markdown marker characters and contains nothing being operated on.
 *
 * `---` and `***` are thematic breaks; `---` and `===` right after a paragraph are a setext heading underline; a lone `-`, `+`, or `>`
 * is an empty list item or an empty quote. The `-`, `*`, and `=` in these lines are taken as operators and relations, and KaTeX happens to parse them,
 * so a thematic break is rendered as a string of serif minus signs, and a setext heading is split into "paragraph + formula".
 * A real formula contains at least one letter, digit, or command being operated on, so excluding the whole class does not cause false misses.
 */
function isMarkdownPunctuationLine(value: string): boolean {
  return /^[-*_=+>][-*_=+>\t ]*$/.test(value);
}

/** Whether a standalone piece of content has clear math features and can be parsed completely by KaTeX. */
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
  // Starting with a LaTeX command or environment is a clear formula intent and does not use the tool-call heuristic; everything else excludes marker fragments first.
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
 * Validate complete syntax with the KaTeX public API; preview and formula editing share the safe config and a bounded cache.
 * @param value LaTeX without math delimiters
 * @returns whether it can be parsed safely as a formula
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

/** Mask text-command arguments such as `\text{...}`, so Chinese inside a formula is not treated as external explanatory text. */
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

/** Find the right brace that matches the given left brace. */
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

/** While a streaming-output group is still unclosed, keep plain text, so a KaTeX error is not shown briefly. */
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

/** Keep whitespace on both sides of the original string, and replace only the effective content in the middle. */
function preserveOuterWhitespace(value: string, transform: (content: string) => string): string {
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  return `${leading}${transform(value.slice(leading.length, value.length - trailing.length))}${trailing}`;
}

/** Build a block formula that remark-math can recognize. */
function wrapDisplayMath(value: string): string {
  return `$$\n${value.trim()}\n$$`;
}

/** Exclude Markdown table rows, while still allowing absolute-value formulas such as `|x|`. */
function isMarkdownTableRow(value: string): boolean {
  return /^\s*\|.*\|\s*$/.test(value) && (value.match(/\|/g)?.length ?? 0) >= 3;
}

/** Exclude common non-math literals, such as dates, that look like expressions. */
function isCommonNonMathLiteral(value: string): boolean {
  return /^\d{4}-\d{1,2}-\d{1,2}$/.test(value) || /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value);
}

/**
 * Exclude web-search citation markers. They look like subscripts but are not formulas.
 *
 * The prompt requires the model to follow a claim with `[ref_N]`, and for several sources the model also groups them as `[ref_3, ref_5]`. These markers
 * happen to pass every bare-math check: `_` hits hasScript, `ref` is only three letters and passes
 * allIdentifiersShortOrMath, and KaTeX can parse `ref_1` as a subscript. wrapBracketedMath then
 * eats the brackets as formula delimiters, and the body is left with one italic subscript — the marker is gone, and so is the source.
 *
 * Whether a marker can be rewritten into a link depends on whether the source has arrived (see citationMarkers). Mid-stream, when the number cannot find a source,
 * or when reasoning text has no source to look up, it arrives here as bare text. Whether it was rewritten is a separate question, but it is never
 * a formula, so this guard stays on the math side as a fallback and does not depend on the upstream rewrite succeeding.
 */
function isCitationMarker(value: string): boolean {
  // Allow an optional outer pair of brackets: wrapBracketedMath is given the body inside the brackets, while a line on its own still carries the brackets.
  return /^\[?\s*ref_\d{1,3}(?:\s*[,，、;；]\s*ref_\d{1,3})*\s*\]?$/.test(value);
}

/** Whether the character at the current position is escaped by an odd number of backslashes. */
function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}
