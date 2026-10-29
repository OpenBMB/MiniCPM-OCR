import { regenerateImageParseV4 } from '@/api/map/imageParseV2';
import { type ImageParseSource } from '@/api/map/imageParseSource';
import type { ImageParseLayoutBlock } from './imageParseSample';

interface BlockGenerationInput {
  source?: ImageParseSource;
  /** 当前登录用户可见的文档解析模型 ID。 */
  model: string;
  /** 当前选中 API Key 的明文密钥；仅内存传递，不落盘。 */
  secret: string;
  documentDataUrl: string;
  mime: string;
  pageIndex: number;
}

/** 真实 v4 只使用服务端签发的整页引用；没有来源证明时必须显式不可用。 */
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
