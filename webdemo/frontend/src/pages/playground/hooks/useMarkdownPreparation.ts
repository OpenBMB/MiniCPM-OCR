import { useMemo } from 'react';

import { normalizeMathDelimiters, prepareDocumentMath } from '../utils/math';
import { imageParseDocumentBlocks } from '../utils/imageParseDocumentBlocks';
import { unservedImagePlaceholderOffsets } from '../utils/imageParseCrops';
import type { ImageParseTextRange } from '../utils/imageParseBlocks';
import type { ImageParseLinkedRange } from '../utils/imageParseHighlight';

interface UseMarkdownPreparationOptions {
  /** Original body; OCR ranges and edit blocks still use it as the authoritative offset. */
  sourceContent: string;
  /** Text that actually enters Markdown and math normalization; a chat scene may already have injected citation-marker links. */
  renderContent: string;
  /** Whether the chat scene infers bare formulas. */
  detectBareMath: boolean;
  /** Whether to generate edit ranges. */
  editableBlocks: boolean;
  /** Highlight range of a single block. */
  highlightRange?: ImageParseTextRange;
  /** OCR linked range. */
  linkedRanges?: readonly ImageParseLinkedRange[];
}

/**
 * Cache Markdown preprocessing; a document range reuses one normalization map and does not rescan the text per block.
 *
 * `sourceContent` and `renderContent` are the same in an OCR document; in chat body text, citation markers may first be rewritten as
 * Markdown links. The range map is actually used only in the document scene, where the two contents stay consistent.
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
