import type { ImageParseSnapshot } from './imageParseHistoryTypes';

/**
 * Compare content that needs a cloud archive; PDF page results are the authoritative content, and the current page and local crops do not trigger a full-document upload.
 * @param previous last full snapshot that was observed
 * @param next current full snapshot
 * @returns whether the attachment, mode, and actual recognition content are unchanged
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
  // Use the reference of the immutable result, so scrolling does not serialize hundreds of pages of body text or compare crops used only on the client.
  return (
    pages.length === Object.keys(after).length &&
    pages.every((page) => {
      const left = before[Number(page)];
      const right = after[Number(page)];
      return !!right && left.result === right.result && left.error === right.error;
    })
  );
}
