import { regenerateImageParseV4 } from '@/api/map/imageParseV2';
import { type ImageParseSource } from '@/api/map/imageParseSource';
import type { ImageParseLayoutBlock } from './imageParseSample';

interface BlockGenerationInput {
  source?: ImageParseSource;
  /** Document-parsing model ID visible to the current logged-in user. */
  model: string;
  /** Plaintext secret of the currently selected API Key; passed in memory only and not persisted to disk. */
  secret: string;
  documentDataUrl: string;
  mime: string;
  pageIndex: number;
}

/** Real v4 uses only a whole-page reference issued by the server; without proof of origin it must be explicitly unavailable. */
export function imageParseBlockGenerator(
  input: BlockGenerationInput,
  original: ImageParseLayoutBlock,
  blockId: string,
  signal: AbortSignal,
) {
  return async (attempt: number, currentBest: ImageParseLayoutBlock) => {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
    if (!input.source) throw new Error('imageParseRegenerateSourceMissing');
    if (input.pageIndex !== input.source.pageIndex)
      throw new Error('imageParseRegenerateSourceInvalid');
    return regenerateImageParseV4(input.source, original, requestSignal, input.model, input.secret);
  };
}
