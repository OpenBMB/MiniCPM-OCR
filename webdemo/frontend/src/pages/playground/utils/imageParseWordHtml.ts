import {
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
  type ILevelsOptions,
} from 'docx';

import { imageParseTextLineBreaks } from './imageParseLineBreaks';

/** HTML 与 GFM 表格共用的 Word 单元格信息。 */
export interface ImageParseWordCell {
  children: Array<Paragraph | Table>;
  columnSpan?: number;
  rowSpan?: number;
}

/** HTML 列表与 Markdown 列表共用的编号定义。 */
export type ImageParseWordNumbering = Array<{ reference: string; levels: ILevelsOptions[] }>;

/** A4 页面扣除两侧各 1 英寸留白后的正文宽度，单位为 twip。 */
export const IMAGE_PARSE_WORD_WIDTH = 9026;

/** 保留安全链接为 Word 超链接，危险协议只保留可见文字。 */
export function imageParseWordLink(url: string, children: TextRun[]) {
  if (!/^(https?:\/\/|mailto:)/i.test(url)) return children;
  return [new ExternalHyperlink({ link: url, children })];
}

/**
 * 创建有明确列宽的可编辑表格；合并行列交由 docx 生成合法 OOXML。
 * @param rows 按阅读顺序排列的单元格
 * @returns 自适应正文宽度的 Word 表格
 */
export function imageParseWordTable(rows: ImageParseWordCell[][]): Table {
  const columns = Math.max(
    1,
    ...rows.map((row) => row.reduce((n, cell) => n + (cell.columnSpan ?? 1), 0)),
  );
  const widths = Array.from(
    { length: columns },
    (_, index) =>
      Math.floor(IMAGE_PARSE_WORD_WIDTH / columns) +
      (index < IMAGE_PARSE_WORD_WIDTH % columns ? 1 : 0),
  );
  return new Table({
    width: { size: IMAGE_PARSE_WORD_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map(
      (row) =>
        new TableRow({
          children: row.map(
            (cell) =>
              new TableCell({
                ...cell,
                children: cell.children.length ? cell.children : [new Paragraph('')],
                width: { size: widths[0] * (cell.columnSpan ?? 1), type: WidthType.DXA },
              }),
          ),
        }),
    ),
  });
}

const OMITTED_HTML = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'TEMPLATE']);
const BLOCK_HTML = /^(P|DIV|SECTION|ARTICLE|BLOCKQUOTE|H[1-6]|UL|OL|TABLE|PRE)$/;
const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

function htmlTextRuns(text: string, style: IRunOptions = {}) {
  return text
    .split('\n')
    .map((line, index) => new TextRun({ ...style, text: line, break: index ? 1 : undefined }));
}

function htmlRuns(node: Node, style: IRunOptions = {}): Array<TextRun | ExternalHyperlink> {
  if (node.nodeType === Node.TEXT_NODE) {
    const inCode = node.parentElement?.closest('code, pre') != null;
    const text = inCode
      ? (node.textContent ?? '')
      : imageParseTextLineBreaks(node.textContent ?? '', '\n');
    return htmlTextRuns(text, style);
  }
  if (!(node instanceof Element) || OMITTED_HTML.has(node.tagName)) return [];
  if (node.tagName === 'BR') return [new TextRun({ break: 1 })];
  if (node.tagName === 'IMG') return [new TextRun(node.getAttribute('alt') || '[image]')];
  const next: IRunOptions = {
    ...style,
    bold: style.bold || /^(STRONG|B|TH)$/.test(node.tagName),
    italics: style.italics || /^(EM|I)$/.test(node.tagName),
    strike: style.strike || /^(DEL|S)$/.test(node.tagName),
    font: /^(CODE|PRE)$/.test(node.tagName) ? 'Courier New' : style.font,
  };
  const children = [...node.childNodes].flatMap((child) => htmlRuns(child, next));
  if (node.tagName === 'A' && children.every((child) => child instanceof TextRun))
    return imageParseWordLink(node.getAttribute('href') ?? '', children);
  return children;
}

function htmlFlow(
  nodes: readonly Node[],
  numbering: ImageParseWordNumbering,
  level: number,
): Array<Paragraph | Table> {
  const result: Array<Paragraph | Table> = [];
  let inline: Array<TextRun | ExternalHyperlink> = [];
  const flush = () => {
    if (inline.length) result.push(new Paragraph({ children: inline }));
    inline = [];
  };
  for (const node of nodes) {
    if (node instanceof Element && BLOCK_HTML.test(node.tagName)) {
      flush();
      result.push(...htmlBlocks(node, numbering, level));
    } else if (node.textContent?.trim() || node instanceof Element) {
      inline.push(...htmlRuns(node));
    }
  }
  flush();
  return result;
}

function htmlBlocks(
  node: Node,
  numbering: ImageParseWordNumbering,
  level: number,
): Array<Paragraph | Table> {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.trim() ? [new Paragraph({ children: htmlRuns(node) })] : [];
  }
  if (!(node instanceof Element) || OMITTED_HTML.has(node.tagName)) return [];
  if (node instanceof HTMLTableElement) {
    const rows = [...node.rows].map((row) =>
      [...row.cells].map((cell) => ({
        columnSpan: cell.colSpan,
        rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
        children: htmlFlow([...cell.childNodes], numbering, level),
      })),
    );
    return rows.length ? [imageParseWordTable(rows)] : [];
  }
  if (/^(DIV|SECTION|ARTICLE|BODY)$/.test(node.tagName))
    return htmlFlow([...node.childNodes], numbering, level);
  const depth = /^H([1-6])$/.exec(node.tagName)?.[1];
  if (node.tagName === 'UL' || node instanceof HTMLOListElement) {
    const ordered = node instanceof HTMLOListElement;
    const listLevel = Math.min(level, 8);
    const reference = `ocr-list-${numbering.length}`;
    if (ordered)
      numbering.push({
        reference,
        levels: [
          {
            level: listLevel,
            format: LevelFormat.DECIMAL,
            text: `%${listLevel + 1}.`,
            start: node.start,
          },
        ],
      });
    return [...node.children].flatMap((item) => {
      const children = [...item.childNodes];
      const nested = children.filter(
        (child) => child instanceof Element && /^(UL|OL)$/.test(child.tagName),
      );
      return [
        new Paragraph({
          children: children
            .filter((child) => !nested.includes(child))
            .flatMap((child) => htmlRuns(child)),
          numbering: ordered ? { reference, level: listLevel } : undefined,
          bullet: ordered ? undefined : { level: listLevel },
        }),
        ...nested.flatMap((child) => htmlBlocks(child, numbering, level + 1)),
      ];
    });
  }
  return [
    new Paragraph({
      children: htmlRuns(node),
      heading: depth ? HEADINGS[Number(depth) - 1] : undefined,
    }),
  ];
}

/**
 * 解析 OCR 的 HTML 片段；DOM 仅在脱离页面的文档中读取，不执行脚本或加载远程媒体。
 * @param html 原始 HTML 块
 * @returns 可编辑表格与正文段落
 */
export function imageParseHtmlToWord(
  html: string,
  numbering: ImageParseWordNumbering,
): Array<Paragraph | Table> {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return htmlFlow([...document.body.childNodes], numbering, 0);
}

/** 转换 Markdown 内嵌 HTML，保留显式换行且不执行脚本。 */
export function imageParseHtmlWordRuns(html: string, style: IRunOptions) {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return [...document.body.childNodes].flatMap((node) => htmlRuns(node, style));
}
