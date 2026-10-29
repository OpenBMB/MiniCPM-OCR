import { describe, expect, it } from 'vitest';
import { trimEmptyPdfRevision } from './pdfPreviewSource';

const bytes = (value: string) => new TextEncoder().encode(value);

function appendEmptyRevision(previous: string): string {
  const previousXref = previous.indexOf('xref');
  const offset = bytes(previous).length;
  return `${previous}xref\ntrailer\n<</Size 4 /Prev ${previousXref}>>\nstartxref\n${offset}\n%%EOF\n`;
}

describe('trimEmptyPdfRevision', () => {
  it('removes an empty trailing xref revision while keeping the last complete revision', () => {
    const previous = '%PDF-1.7\nxref\n0 1\n0000000000 65535 f\ntrailer\n<</Size 4>>\nstartxref\n9\n%%EOF\n\n';
    const damaged = bytes(appendEmptyRevision(previous));
    expect(trimEmptyPdfRevision(damaged)).toEqual(bytes(previous));
  });

  it('leaves an ordinary PDF and unrelated trailing data unchanged', () => {
    const source = bytes('%PDF-1.7\nxref\n0 1\n0000000000 65535 f\ntrailer\n<</Size 4>>\nstartxref\n9\n%%EOF\n');
    expect(trimEmptyPdfRevision(source)).toBe(source);
    const incomplete = bytes(`${new TextDecoder().decode(source)}xref\ntrailer\n<</Size 4>>\nstartxref\n${source.length}\n%%EOF\n`);
    expect(trimEmptyPdfRevision(incomplete)).toBe(incomplete);
  });

  it('does not truncate when xref offsets or the previous revision are inconsistent', () => {
    const previous = '%PDF-1.7\nxref\n0 1\n0000000000 65535 f\ntrailer\n<</Size 4>>\nstartxref\n9\n%%EOF\n';
    const damaged = bytes(appendEmptyRevision(previous));
    const wrongOffset = bytes(new TextDecoder().decode(damaged).replace(/startxref\n\d+\n%%EOF\n$/, 'startxref\n9999\n%%EOF\n'));
    expect(trimEmptyPdfRevision(wrongOffset)).toBe(wrongOffset);
    const wrongPrev = bytes(new TextDecoder().decode(damaged).replace(/\/Prev \d+/, '/Prev 9999'));
    expect(trimEmptyPdfRevision(wrongPrev)).toBe(wrongPrev);
  });
});
