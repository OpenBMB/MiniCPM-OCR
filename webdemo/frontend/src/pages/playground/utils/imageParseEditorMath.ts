/**
 * Read a complete math fence for the editor; display mode is decided only by the outer marker, and dollar signs in the body do not take part in Markdown escaping.
 * @param source Markdown starting at the math marker
 * @param display whether to read a block formula delimited by double dollar signs
 * @returns a token the existing Mathematics extension accepts; an unclosed or empty formula is not converted
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
