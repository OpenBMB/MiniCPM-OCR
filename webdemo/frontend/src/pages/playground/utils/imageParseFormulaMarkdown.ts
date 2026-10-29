import { imageParseNodeText, imageParseSourceBlocks } from './imageParseEditorSource';
import type { ImageParseLayoutBlock } from './imageParseSample';

/** 比较公式时只忽略数学定界符、排版空白与 Markdown 转义。 */
export function comparableImageParseFormula(value: string): string {
  return value
    .replace(/^\s*\$\$([\s\S]*?)\$\$\s*$/, '$1')
    .replace(/\s+/g, '')
    .replace(/\\{2,}/g, '\\')
    .replace(/\\([{}])/g, '$1');
}

/**
 * 合并紧邻显示公式的同内容裸 LaTeX，保留规范的数学块与其它正文。
 * 多个原图公式块需要各自表示时不合并；重建映射必须使用返回的完整正文。
 * @param source 服务正文或旧缓存正文
 * @param blocks 原图识别块，用于区分重复表示与真正不同的原图区域
 * @returns 去除重复表示后的 Markdown
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
