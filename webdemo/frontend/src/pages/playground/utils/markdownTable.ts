import { imageParseNodeText, imageParseSourceBlocks } from './imageParseEditorSource';
import { replaceImageParseTextLineBreaks } from './imageParseLineBreaks';

/** Two-dimensional text grid of one table; a merged cell keeps its text only at the top-left position. */
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
 * Extract GFM and HTML tables with a mature Markdown AST, excluding examples inside code blocks.
 * @param markdown original or edited document; an HTML table with merged cells does not need to be downgraded
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

/** Export a document table as TSV; newlines and quotes follow spreadsheet field-escaping rules. */
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
 * Export a document table as an HTML table: Feishu and Word restore cells only when they receive `text/html`,
 * and plain text pastes as lines of text.
 * Header information is already lost at extraction time (both GFM tables and HTML tables are left as a two-dimensional grid), so everything is emitted as `td`.
 * An empty paragraph is inserted between tables, so Word does not merge adjacent tables into one.
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
