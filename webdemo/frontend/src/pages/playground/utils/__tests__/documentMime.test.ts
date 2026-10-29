import { describe, expect, it } from 'vitest';
import { resolveDocumentMime, withResolvedDocumentMime } from '../documentMime';

describe('documentMime', () => {
  it.each([
    ['scan.pdf', 'application/pdf'],
    ['scan.png', 'image/png'],
    ['scan.jpg', 'image/jpeg'],
    ['scan.jpeg', 'image/jpeg'],
    ['scan.webp', 'image/webp'],
    ['scan.gif', 'image/gif'],
    ['scan.avif', 'image/avif'],
    ['scan.heic', 'image/heic'],
    ['scan.heif', 'image/heif'],
    ['scan.ico', 'image/x-icon'],
    ['scan.bmp', 'image/bmp'],
    ['scan.tif', 'image/tiff'],
    ['scan.tiff', 'image/tiff'],
  ])('按扩展名补全 %s', (name, mime) => {
    const file = new File(['x'], name, { type: '' });
    expect(resolveDocumentMime(file)).toBe(mime);
    expect(withResolvedDocumentMime(file).type).toBe(mime);
  });

  it('已标注的类型保持不变', () => {
    const file = new File(['x'], 'scan.png', { type: 'image/jpeg' });
    expect(withResolvedDocumentMime(file)).toBe(file);
  });

  it('无法识别的扩展名保持空类型，交给上传校验拒绝', () => {
    const file = new File(['x'], 'scan.unknown', { type: '' });
    expect(resolveDocumentMime(file)).toBe('');
    expect(withResolvedDocumentMime(file)).toBe(file);
  });
});
