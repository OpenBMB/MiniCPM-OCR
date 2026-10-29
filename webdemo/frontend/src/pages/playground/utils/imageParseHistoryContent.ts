import type { ImageParseSnapshot } from './imageParseHistoryTypes';

/**
 * 比较需要云端存档的内容；PDF 页结果是权威内容，当前页及本地裁图不触发整篇上传。
 * @param previous 上一次已观察的完整快照
 * @param next 当前完整快照
 * @returns 附件、模式及实际识别内容是否未变
 */
export function sameImageParseHistoryContent(
  previous: ImageParseSnapshot | null | undefined,
  next: ImageParseSnapshot | null | undefined,
): boolean {
  if (!previous || !next) return false;
  if (
    previous.attachment !== next.attachment ||
    previous.mode !== next.mode ||
    previous.source !== next.source
  )
    return false;
  if (!previous.pdf || !next.pdf)
    return (
      previous.pdf === next.pdf &&
      previous.rotation === next.rotation &&
      previous.markdown === next.markdown &&
      previous.layout === next.layout
    );
  if (previous.pdf.pages !== next.pdf.pages) return false;
  const before = previous.pdf.results;
  const after = next.pdf.results;
  if (before === after) return true;
  const pages = Object.keys(before);
  // 使用不可变结果的引用，避免滚动时序列化数百页正文或比较仅在客户端使用的裁图。
  return (
    pages.length === Object.keys(after).length &&
    pages.every((page) => {
      const left = before[Number(page)];
      const right = after[Number(page)];
      return !!right && left.result === right.result && left.error === right.error;
    })
  );
}
