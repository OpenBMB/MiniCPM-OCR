import { useMemo } from 'react';

import { normalizeMathDelimiters, prepareDocumentMath } from '../utils/math';
import { imageParseDocumentBlocks } from '../utils/imageParseDocumentBlocks';
import { unservedImagePlaceholderOffsets } from '../utils/imageParseCrops';
import type { ImageParseTextRange } from '../utils/imageParseBlocks';
import type { ImageParseLinkedRange } from '../utils/imageParseHighlight';

interface UseMarkdownPreparationOptions {
  /** 原始正文；OCR 范围与编辑块仍以它为权威偏移量。 */
  sourceContent: string;
  /** 实际进入 Markdown/数学规范化的文本；对话场景可能已注入引用角标链接。 */
  renderContent: string;
  /** 对话场景是否推断裸公式。 */
  detectBareMath: boolean;
  /** 是否生成编辑范围。 */
  editableBlocks: boolean;
  /** 单块高亮范围。 */
  highlightRange?: ImageParseTextRange;
  /** OCR 联动范围。 */
  linkedRanges?: readonly ImageParseLinkedRange[];
}

/**
 * 缓存 Markdown 预处理；文档范围复用一次规范化映射，不按块重扫文本。
 *
 * `sourceContent` 与 `renderContent` 在 OCR 文档中相同；在对话正文中，引用角标可能先被改写成
 * Markdown 链接。范围映射只在文档场景实际使用，此时两个内容保持一致。
 */
export function useMarkdownPreparation({
  sourceContent,
  renderContent,
  detectBareMath,
  editableBlocks,
  highlightRange,
  linkedRanges,
}: UseMarkdownPreparationOptions) {
  const documentMath = useMemo(
    () => (detectBareMath ? undefined : prepareDocumentMath(renderContent)),
    [detectBareMath, renderContent],
  );
  const normalized = useMemo(
    () => documentMath?.content ?? normalizeMathDelimiters(renderContent, { detectBareMath }),
    [detectBareMath, documentMath, renderContent],
  );
  const editBlocks = useMemo(
    () =>
      editableBlocks
        ? imageParseDocumentBlocks(sourceContent, normalized, detectBareMath)
        : [],
    [detectBareMath, editableBlocks, normalized, sourceContent],
  );
  const normalizedRanges = useMemo(() => {
    const mapOffset = (offset: number) =>
      documentMath
        ? documentMath.mapOffset(offset)
        : normalizeMathDelimiters(renderContent.slice(0, offset), { detectBareMath }).length;
    const mapRange = (range: ImageParseTextRange) => ({
      start: mapOffset(range.start),
      end: mapOffset(range.end),
    });
    return {
      normalizedRange: highlightRange ? mapRange(highlightRange) : undefined,
      normalizedLinkedRanges: linkedRanges?.map(({ id, range }) => ({
        id,
        range: mapRange(range),
      })),
    };
  }, [detectBareMath, documentMath, highlightRange, linkedRanges, renderContent]);
  const placeholderOffsets = useMemo(
    () => unservedImagePlaceholderOffsets(normalized),
    [normalized],
  );
  return { normalized, editBlocks, placeholderOffsets, ...normalizedRanges };
}
