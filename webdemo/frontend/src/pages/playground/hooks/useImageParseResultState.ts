import { useMemo } from 'react';

import type { useImageParse } from './useImageParse';
import { useImageParseDraft } from './useImageParseDraft';
import { useImageParseDownload } from './useImageParseDownload';
import { imageParseBlockRanges } from '../utils/imageParseBlocks';
import { imageParseQuality } from '../utils/imageParseQuality';
import {
  imageParseSealDisplayCrops,
  imageParseSealDisplayResult,
} from '../utils/imageParseSealDisplay';

/**
 * 连接结果草稿、原图定位范围和下载数据，确保导出使用当前编辑内容。
 * @param parse 当前识别结果
 * @param examplePageKey 共享案例的逐页身份
 * @returns 草稿、定位范围、质量摘要与下载操作
 */
export function useImageParseResultState(
  parse: ReturnType<typeof useImageParse>,
  examplePageKey?: string,
) {
  const baseRanges = useMemo(
    () => imageParseBlockRanges(parse.markdown, parse.layout),
    [parse.markdown, parse.layout],
  );
  const draft = useImageParseDraft(parse.markdown, examplePageKey ?? parse.resultKey, baseRanges);
  const ranges = draft.ranges;
  const linkedRanges = useMemo(() => [...ranges].map(([id, range]) => ({ id, range })), [ranges]);
  const preview = useMemo(
    () =>
      imageParseSealDisplayResult(
        { markdown: draft.value, blocks: parse.layout },
        parse.recognizeSeal,
        parse.recognizeChart,
        ranges,
      ),
    [draft.value, parse.layout, parse.recognizeChart, parse.recognizeSeal, ranges],
  );
  const previewRanges = useMemo(
    () => imageParseBlockRanges(preview.markdown, preview.blocks),
    [preview.markdown, preview.blocks],
  );
  const previewLinkedRanges = useMemo(
    () => [...previewRanges].map(([id, range]) => ({ id, range })),
    [previewRanges],
  );
  const previewCrops = useMemo(
    () =>
      imageParseSealDisplayCrops(
        parse.layout,
        parse.crops ?? [],
        parse.recognizeSeal,
        parse.recognizeChart,
      ),
    [parse.crops, parse.layout, parse.recognizeChart, parse.recognizeSeal],
  );
  const quality = useMemo(() => imageParseQuality(parse.layout), [parse.layout]);
  const download = useImageParseDownload({
    markdown: draft.value,
    blocks: parse.layout,
    rotation: parse.rotation,
    ranges,
    edited: draft.manuallyEdited ?? draft.dirty,
    name: parse.attachment?.name,
    page: parse.pdf?.page,
    disabled: parse.loading,
  });
  return {
    draft,
    ranges,
    linkedRanges,
    preview,
    previewRanges,
    previewLinkedRanges,
    previewCrops,
    quality,
    download,
  };
}
