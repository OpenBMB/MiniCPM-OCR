import { imageParseNodeText, imageParseSourceBlocks } from './imageParseEditorSource';
import type { ImageParseLayoutBlock } from './imageParseSample';

/** When comparing formulas, ignore only math delimiters, layout whitespace, and Markdown escaping. */
export function comparableImageParseFormula(value: string): string {
  return value
    .replace(/^\s*\$\$([\s\S]*?)\$\$\s*$/, '$1')
    .replace(/\s+/g, '')
    .replace(/\\{2,}/g, '\\')
    .replace(/\\([{}])/g, '$1');
}

/**
 * Merge bare LaTeX of the same content that sits next to a display formula, keeping well-formed math blocks and the other body text.
 * Do not merge when several original-image formula blocks each need their own representation; rebuilding the map must use the full body that is returned.
 * @param source service body or old cached body
 * @param blocks original-image recognition blocks, used to tell a repeated representation from a genuinely different original-image region
 * @returns Markdown with the duplicate representation removed
 */
export function deduplicateImageParseFormulaMarkdown(
  source: string,
  blocks: readonly ImageParseLayoutBlock[] = [],
): string {
  const nodes = imageParseSourceBlocks(source);
  const displays = new Map<string, number>();
  const originals = new Map<string, number>();
  for (const node of nodes) {
    if (node.type !== 'math') continue;
    const text = comparableImageParseFormula(imageParseNodeText(node));
    displays.set(text, (displays.get(text) ?? 0) + 1);
  }
  for (const block of blocks) {
    if (block.kind !== 'formula') continue;
    const text = comparableImageParseFormula(block.text);
    originals.set(text, (originals.get(text) ?? 0) + 1);
  }
  let markdown = '';
  let cursor = 0;
  for (let index = 1; index < nodes.length; index++) {
    const previous = nodes[index - 1];
    const node = nodes[index];
    if (previous.type !== 'math' || node.type !== 'paragraph') continue;
    const formula = comparableImageParseFormula(imageParseNodeText(previous));
    const start = previous.position?.end.offset;
    const end = node.position?.end.offset;
    if (
      !formula ||
      formula !== comparableImageParseFormula(imageParseNodeText(node)) ||
      (originals.get(formula) ?? 0) > (displays.get(formula) ?? 0) ||
      start === undefined ||
      end === undefined
    )
      continue;
    markdown += source.slice(cursor, start);
    cursor = end;
  }
  return markdown + source.slice(cursor);
}
