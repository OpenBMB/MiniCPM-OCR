import { useMemo } from 'react';

import type { ImageParseLayoutBlock } from '../utils/imageParseSample';
import {
  imageParseServerDisplayAngle,
  restoreImageParseBlocksToOriginal,
} from '../utils/imageParseRotation';
import type { useImageParse } from './useImageParse';
import { useImageParseSelection } from './useImageParseSelection';

/** 工作台区块选择：保留逐页框数据，跨页点击绑定目标结果身份而不是当前页同名块。 */
export function useImageParseWorkspaceSelection(
  parse: ReturnType<typeof useImageParse>,
  enabled: boolean,
  linked: boolean,
) {
  const selection = useImageParseSelection(parse.resultKey, enabled, linked);
  const results = parse.pdf?.results;
  const pageBlocks = useMemo(
    () =>
      results
        ? Object.fromEntries(
            Object.entries(results).map(([page, value]) => [
              page,
              restoreImageParseBlocksToOriginal(value.result?.blocks ?? [], value.result?.rotation),
            ]),
          )
        : undefined,
    [results],
  ) satisfies Readonly<Record<number, readonly ImageParseLayoutBlock[]>> | undefined;
  const pageServerAngles = useMemo(
    () =>
      results
        ? Object.fromEntries(
            Object.entries(results).map(([page, value]) => [
              page,
              imageParseServerDisplayAngle(value.result?.rotation),
            ]),
          )
        : undefined,
    [results],
  ) satisfies Readonly<Record<number, number>> | undefined;
  return {
    ...selection,
    pageBlocks,
    pageServerAngles,
    hover(id: string | undefined, page?: number) {
      selection.hover(id, page === undefined ? parse.resultKey : parse.resultKeyForPage(page));
    },
    selectResult(id: string, page?: number) {
      selection.select(
        id,
        'result',
        page === undefined ? parse.resultKey : parse.resultKeyForPage(page),
      );
      if (page !== undefined) parse.pdf?.setPage(page);
    },
    selectOrigin(id: string, page?: number) {
      if (page !== undefined && parse.pdf) {
        selection.select(id, 'origin', parse.resultKeyForPage(page));
        parse.pdf.setPage(page);
      } else selection.select(id, 'origin');
    },
  };
}
