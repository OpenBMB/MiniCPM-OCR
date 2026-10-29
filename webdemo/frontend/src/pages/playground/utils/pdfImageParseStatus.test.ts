import { describe, expect, it } from 'vitest';
import { pdfParseErrorKey } from './pdfImageParseStatus';

describe('pdfParseErrorKey', () => {
  it('preserves known OCR error keys for page-level display', () => {
    expect(pdfParseErrorKey(new Error('imageParseInvalidResult'))).toBe(
      'imageParseInvalidResult',
    );
    expect(pdfParseErrorKey(new Error('imageParseServiceUnavailable'))).toBe(
      'imageParseServiceUnavailable',
    );
  });

  it('does not expose arbitrary upstream error text', () => {
    expect(pdfParseErrorKey(new Error('private upstream detail'))).toBe(
      'imageParseRequestFailed',
    );
  });
});
