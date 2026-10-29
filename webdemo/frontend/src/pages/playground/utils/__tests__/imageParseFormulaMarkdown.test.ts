import { describe, expect, it } from 'vitest';

import { deduplicateImageParseFormulaMarkdown } from '../imageParseFormulaMarkdown';
import { IMAGE_PARSE_SAMPLE_BLOCKS } from './imageParseSampleFixtures';
import { sanitizeImageParseSnapshot } from '../imageParseHistorySnapshot';

const formula = String.raw`failstone(p,q)=\left\{\begin{array}{ll}1&(p=q)\\1+failstone(p-q,p)&(p>q)\end{array}\right.`;
const display = `$$\n${formula}\n$$`;

describe('OCR 公式去重', () => {
  it('只去掉紧邻显示公式的重复裸 LaTeX，保留前后正文', () => {
    expect(deduplicateImageParseFormulaMarkdown(`前文\n\n${display}\n\n${formula}\n\n后文`)).toBe(
      `前文\n\n${display}\n\n后文`,
    );
  });

  it.each([
    `${display}\n\n公式说明\n\n${formula}`,
    `${display}\n\n不同公式`,
    `${display}\n\n\`\`\`latex\n${formula}\n\`\`\``,
    `${display}\n\n${display}`,
  ])('不同内容、原文示例和不同公式块保持不变：%s', (source) => {
    expect(deduplicateImageParseFormulaMarkdown(source)).toBe(source);
  });

  it('两个原图公式区域不能合并为一块', () => {
    const block = { ...IMAGE_PARSE_SAMPLE_BLOCKS[0], kind: 'formula' as const, text: formula };
    const source = `${display}\n\n${formula}`;
    expect(deduplicateImageParseFormulaMarkdown(source, [block, block])).toBe(source);
  });

  it('旧 PDF 缓存的重复公式合并后重新映射，不修改输入', () => {
    const markdown = `${display}\n\n${formula}`;
    const cached = {
      attachment: {
        id: 'pdf',
        kind: 'file',
        name: 'scan.pdf',
        mime: 'application/pdf',
        size: 12,
        dataUrl: 'data:application/pdf;base64,AAA',
      },
      mode: 'high-precision',
      pdf: {
        page: 1,
        pages: 1,
        results: {
          1: {
            result: {
              markdown,
              blocks: [
                {
                  ...IMAGE_PARSE_SAMPLE_BLOCKS[0],
                  id: 'formula',
                  kind: 'formula',
                  status: 'ok',
                  text: formula,
                  markdown: formula,
                  markdownStart: display.length + 2,
                  markdownEnd: markdown.length,
                },
              ],
            },
          },
        },
      },
    };
    const safe = sanitizeImageParseSnapshot(cached);
    expect(safe?.markdown).toBe(display);
    expect(safe?.layout[0]).toMatchObject({
      id: 'formula',
      markdown: display,
      markdownStart: 0,
      markdownEnd: display.length,
    });
    expect(cached.pdf.results[1].result.markdown).toBe(markdown);
  });
});
