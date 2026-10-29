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

/** Word cell info shared by HTML and GFM tables. */
export interface ImageParseWordCell {
  children: Array<Paragraph | Table>;
  columnSpan?: number;
  rowSpan?: number;
}

/** Numbering definition shared by HTML lists and Markdown lists. */
export type ImageParseWordNumbering = Array<{ reference: string; levels: ILevelsOptions[] }>;

/** Body width of an A4 page after 1 inch of margin on each side, in twips. */
export const IMAGE_PARSE_WORD_WIDTH = 9026;

/** Keep a safe link as a Word hyperlink; a dangerous scheme keeps only the visible text. */
export function imageParseWordLink(url: string, children: TextRun[]) {
  if (!/^(https?:\/\/|mailto:)/i.test(url)) return children;
  return [new ExternalHyperlink({ link: url, children })];
}

/**
 * Create an editable table with explicit column widths; merged rows and columns are left to docx to emit legal OOXML.
 * @param rows cells in reading order
 * @returns a Word table that fits the body width
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
 * Parse an OCR HTML fragment; the DOM is read only in a document detached from the page, and does not run scripts or load remote media.
 * @param html original HTML block
 * @returns editable tables and body paragraphs
 */
export function imageParseHtmlToWord(
  html: string,
  numbering: ImageParseWordNumbering,
): Array<Paragraph | Table> {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return htmlFlow([...document.body.childNodes], numbering, 0);
}

/** Convert HTML embedded in Markdown, keeping explicit line breaks and not running scripts. */
export function imageParseHtmlWordRuns(html: string, style: IRunOptions) {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return [...document.body.childNodes].flatMap((node) => htmlRuns(node, style));
}
