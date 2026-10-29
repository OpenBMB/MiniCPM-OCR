/** 修复已知的空增量更新交叉引用尾部；正常 PDF 保留原始字节。 */
export function trimEmptyPdfRevision(data: Uint8Array): Uint8Array {
  // 只检查文件末尾：扫描正文可能误认图像流中的 xref/%%EOF 为结构标记。
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
