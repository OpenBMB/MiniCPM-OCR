import {
  Document,
  FootnoteReferenceRun,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TextRun,
  type ExternalHyperlink,
  type IRunOptions,
} from 'docx';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { Root, RootContent, PhrasingContent, Definition, FootnoteDefinition } from 'mdast';

import { imageParseTextLineBreaks } from './imageParseLineBreaks';
import { normalizeMathDelimiters } from './math';
import {
  imageParseHtmlToWord,
  imageParseHtmlWordRuns,
  imageParseWordLink,
  imageParseWordTable,
  type ImageParseWordNumbering,
} from './imageParseWordHtml';

const PARSER = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

interface WordContext {
  definitions: Map<string, Definition>;
  numbering: ImageParseWordNumbering;
  footnoteIds: Map<string, number>;
}

function textRuns(text: string, style: IRunOptions = {}): TextRun[] {
  return text
    .split('\n')
    .map((line, index) => new TextRun({ ...style, text: line, break: index ? 1 : undefined }));
}

function inlineRuns(
  nodes: readonly PhrasingContent[],
  context: WordContext,
  style: IRunOptions = {},
): Array<TextRun | ExternalHyperlink | FootnoteReferenceRun> {
  return nodes.flatMap((node): Array<TextRun | ExternalHyperlink | FootnoteReferenceRun> => {
    if (node.type === 'break') return [new TextRun({ break: 1 })];
    if (node.type === 'image' || node.type === 'imageReference')
      return textRuns(node.alt || '[image]', style);
    if (node.type === 'html') return imageParseHtmlWordRuns(node.value, style);
    if (node.type === 'footnoteReference') {
      const id = context.footnoteIds.get(node.identifier);
      return id ? [new FootnoteReferenceRun(id)] : textRuns(`[^${node.identifier}]`, style);
    }
    if (node.type === 'link' || node.type === 'linkReference') {
      const url = node.type === 'link' ? node.url : context.definitions.get(node.identifier)?.url;
      const children = inlineRuns(node.children, context, style);
      return url && children.every((child) => child instanceof TextRun)
        ? imageParseWordLink(url, children)
        : children;
    }
    if (node.type === 'strong') return inlineRuns(node.children, context, { ...style, bold: true });
    if (node.type === 'emphasis')
      return inlineRuns(node.children, context, { ...style, italics: true });
    if (node.type === 'delete')
      return inlineRuns(node.children, context, { ...style, strike: true });
    if (node.type === 'text') return textRuns(imageParseTextLineBreaks(node.value, '\n'), style);
    if ('value' in node)
      return textRuns(
        node.value,
        node.type === 'inlineCode' ? { ...style, font: 'Courier New' } : style,
      );
    return [];
  });
}

function wordBlocks(
  nodes: readonly RootContent[],
  context: WordContext,
  level = 0,
): Array<Paragraph | Table> {
  return nodes.flatMap((node): Array<Paragraph | Table> => {
    switch (node.type) {
      case 'definition':
        return [];
      case 'heading':
        return [
          new Paragraph({
            children: inlineRuns(node.children, context),
            heading: HEADINGS[node.depth - 1],
          }),
        ];
      case 'paragraph':
      case 'tableCell':
        return [new Paragraph({ children: inlineRuns(node.children, context) })];
      case 'code':
        return [new Paragraph({ children: textRuns(node.value, { font: 'Courier New' }) })];
      case 'math':
        // 保留 LaTeX 原文，避免把不支持的公式转换成错误的数学表达式。
        return [new Paragraph({ children: textRuns(node.value) })];
      case 'html':
        return imageParseHtmlToWord(node.value, context.numbering);
      case 'table':
        return [
          imageParseWordTable(
            node.children.map((row, index) =>
              row.children.map((cell) => ({
                children: [
                  new Paragraph({
                    children: inlineRuns(cell.children, context, { bold: index === 0 }),
                  }),
                ],
              })),
            ),
          ),
        ];
      case 'blockquote':
      case 'listItem':
        return wordBlocks(node.children, context, level);
      case 'list': {
        const reference = `ocr-list-${context.numbering.length}`;
        const listLevel = Math.min(level, 8);
        if (node.ordered) {
          context.numbering.push({
            reference,
            levels: [
              {
                level: listLevel,
                format: LevelFormat.DECIMAL,
                text: `%${listLevel + 1}.`,
                start: node.start ?? 1,
              },
            ],
          });
        }
        return node.children.flatMap((item) => {
          let first = true;
          return item.children.flatMap((child) => {
            if (child.type === 'list') return wordBlocks([child], context, level + 1);
            if (child.type !== 'paragraph') return wordBlocks([child], context, level);
            const children = inlineRuns(child.children, context);
            if (first && item.checked !== undefined && item.checked !== null)
              children.unshift(new TextRun(item.checked ? '[x] ' : '[ ] '));
            const paragraph = new Paragraph({
              children,
              numbering: first && node.ordered ? { reference, level: listLevel } : undefined,
              bullet: first && !node.ordered ? { level: listLevel } : undefined,
            });
            first = false;
            return [paragraph];
          });
        });
      }
      default:
        return [];
    }
  });
}

/**
 * 将当前 Markdown 草稿导出为真实 DOCX，保留标题、正文格式、列表和可编辑表格。
 * @param markdown 点击下载时的当前正文；公式保留 LaTeX，远程图片不自动请求
 * @returns 可直接交给浏览器下载的 Word 文件
 */
export async function createImageParseWordBlob(markdown: string): Promise<Blob> {
  const tree = PARSER.parse(normalizeMathDelimiters(markdown, { detectBareMath: false })) as Root;
  const definitions = tree.children.filter(
    (node): node is FootnoteDefinition => node.type === 'footnoteDefinition',
  );
  const context: WordContext = {
    definitions: new Map(
      tree.children
        .filter((node): node is Definition => node.type === 'definition')
        .map((node) => [node.identifier, node]),
    ),
    numbering: [],
    footnoteIds: new Map(definitions.map((node, index) => [node.identifier, index + 1])),
  };
  const children = wordBlocks(tree.children, context);
  const footnotes = Object.fromEntries(
    definitions.map((node) => [
      context.footnoteIds.get(node.identifier)!,
      {
        children: wordBlocks(node.children, context).filter(
          (block): block is Paragraph => block instanceof Paragraph,
        ),
      },
    ]),
  );
  const document = new Document({
    creator: 'MAP',
    numbering: { config: context.numbering },
    footnotes,
    styles: {
      default: {
        document: {
          run: { font: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Microsoft YaHei' }, size: 22 },
          paragraph: { spacing: { after: 160, line: 276 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: children.length ? children : [new Paragraph('')],
      },
    ],
  });
  return Packer.toBlob(document);
}
