/** Repair a known empty incremental-update cross-reference trailer; a normal PDF keeps its original bytes. */
export function trimEmptyPdfRevision(data: Uint8Array): Uint8Array {
  // Check only the end of the file: scanning the body could mistake xref/%%EOF inside an image stream for a structure marker.
  const tailStart = Math.max(0, data.length - 2048);
  const tail = new TextDecoder('latin1').decode(data.subarray(tailStart));
  const lastPointer = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if (!lastPointer) return data;

  const offset = Number(lastPointer[1]);
  if (!Number.isSafeInteger(offset) || offset < tailStart || offset >= data.length) return data;
  const revision = tail.slice(offset - tailStart);
  const empty = /^xref\s+trailer\s*<<[\s\S]*?>>\s*startxref\s+(\d+)\s+%%EOF\s*$/.exec(revision);
  if (!empty || Number(empty[1]) !== offset) return data;

  const previousPointer = /\/Prev\s+(\d+)(?=[\s/>])/.exec(revision);
  const previous = Number(previousPointer?.[1]);
  if (!Number.isSafeInteger(previous) || previous < 0 || previous >= offset) return data;
  const before = new TextDecoder('latin1').decode(data.subarray(Math.max(0, offset - 128), offset));
  if (!new RegExp(`startxref\\s+${previous}\\s+%%EOF\\s*$`).test(before)) return data;
  if (new TextDecoder('latin1').decode(data.subarray(previous, previous + 4)) !== 'xref')
    return data;

  return data.slice(0, offset);
}
