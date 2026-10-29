/**
 * 为编辑器读取完整数学围栏；显示模式只由外层标记决定，正文美元符不参与 Markdown 转义。
 * @param source 从数学标记开始的 Markdown
 * @param display 是否读取双美元符的块级公式
 * @returns 现有 Mathematics 扩展接受的 token；未闭合或空公式不转换
 */
export function imageParseEditorMathToken(source: string, display: boolean) {
  const marker = source.match(/^\$+/)?.[0];
  if (!marker || (display ? marker.length !== 2 : marker.length === 2)) return undefined;
  let cursor = marker.length;
  while (cursor < source.length) {
    const close = source.indexOf('$', cursor);
    if (close < 0) return undefined;
    const run = source.slice(close).match(/^\$+/)?.[0] ?? '';
    if (run.length === marker.length) {
      const latex = source.slice(marker.length, close).trim();
      if (!latex) return undefined;
      return {
        type: display ? 'blockMath' : 'inlineMath',
        raw: source.slice(0, close + marker.length),
        latex,
      };
    }
    cursor = close + run.length;
  }
  return undefined;
}
