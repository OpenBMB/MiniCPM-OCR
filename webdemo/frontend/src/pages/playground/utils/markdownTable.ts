import { imageParseNodeText, imageParseSourceBlocks } from './imageParseEditorSource';
import { replaceImageParseTextLineBreaks } from './imageParseLineBreaks';

/** 一张表的二维文字网格；合并单元格只在左上位置保留文字。 */
export type MarkdownTable = string[][];

function htmlTables(value: string): MarkdownTable[] {
  const fragment = new DOMParser().parseFromString(value, 'text/html');
  fragment.querySelectorAll('script, style').forEach((element) => element.remove());
  return [...fragment.querySelectorAll('table')].map((table) => {
    const rows = [...table.rows];
    const grid: string[][] = rows.map(() => []);
    rows.forEach((row, rowIndex) => {
      let column = 0;
      [...row.cells].forEach((cell) => {
        while (grid[rowIndex][column] !== undefined) column += 1;
        const clone = cell.cloneNode(true) as HTMLElement;
        replaceImageParseTextLineBreaks(clone);
        clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
        clone.querySelectorAll('p, div').forEach((block) => block.append('\n'));
        const text = clone.textContent?.trim() ?? '';
        const colspan = Math.min(Math.max(1, cell.colSpan), 512);
        const rowspan = cell.rowSpan === 0 ? rows.length - rowIndex : Math.max(1, cell.rowSpan);
        for (let r = rowIndex; r < Math.min(rows.length, rowIndex + rowspan); r += 1) {
          for (let c = column; c < column + colspan; c += 1) {
            grid[r][c] = r === rowIndex && c === column ? text : '';
          }
        }
        column += colspan;
      });
    });
    const width = Math.max(0, ...grid.map((row) => row.length));
    return grid.map((row) => Array.from({ length: width }, (_, column) => row[column] ?? ''));
  });
}

/**
 * 使用成熟 Markdown AST 抽取 GFM 与 HTML 表格，排除代码块内的示例。
 * @param markdown 原始或编辑后的文档，HTML 合并表格无需降级
 */
export function extractMarkdownTables(markdown: string): MarkdownTable[] {
  return imageParseSourceBlocks(markdown).flatMap((block) => {
    if (block.type === 'table') {
      return [
        (block.children ?? []).map((row) =>
          (row.children ?? []).map((node) => imageParseNodeText(node)),
        ),
      ];
    }
    if (block.type === 'html') return htmlTables(block.value ?? '');
    return [];
  });
}

function tsvCell(value: string) {
  return /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 将文档表格导出为 TSV；换行和引号遵循表格软件的字段转义规则。 */
export function markdownTablesToTsv(markdown: string): string {
  return extractMarkdownTables(markdown)
    .map((table) => table.map((row) => row.map(tsvCell).join('\t')).join('\n'))
    .join('\n\n');
}

function htmlCell(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, '<br>');
}

/**
 * 将文档表格导出为 HTML 表格：飞书、Word 只有拿到 `text/html` 才会还原出单元格，
 * 纯文本粘过去只会退化成一行行文字。
 * 表头信息在抽取阶段已经丢失（GFM 表与 HTML 表都只剩二维网格），因此统一输出 `td`。
 * 多张表之间插入空段落，避免 Word 把相邻表格合并成一张。
 */
export function markdownTablesToHtml(markdown: string): string {
  return extractMarkdownTables(markdown)
    .map(
      (table) =>
        `<table><tbody>${table
          .map((row) => `<tr>${row.map((cell) => `<td>${htmlCell(cell)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
    )
    .join('<p><br></p>');
}
