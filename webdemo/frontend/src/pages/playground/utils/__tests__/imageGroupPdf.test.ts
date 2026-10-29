import { afterEach, describe, expect, it, vi } from 'vitest';

import { pdfFromJpegs, prepareDocumentFiles } from '../imageGroupPdf';

function imageFile(name: string, type = 'image/png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function pdfFile(name = 'document.pdf'): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, {
    type: 'application/pdf',
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pdfFromJpegs', () => {
  it('按 JPEG 页数生成带 xref 的 PDF 骨架', () => {
    const bytes = pdfFromJpegs([
      { bytes: new Uint8Array([1, 2]), width: 1000, height: 2000 },
      { bytes: new Uint8Array([3, 4]), width: 800, height: 600 },
    ]);
    const text = new TextDecoder('latin1').decode(bytes);

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    // Preview renders at 2x; page size is half the pixel dimensions.
    expect(text).toContain('/MediaBox [0 0 500 1000]');
    expect(text).toContain('/MediaBox [0 0 400 300]');
    expect(text).toContain('/DCTDecode');
    expect(text).toContain('xref');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('没有页面时拒绝生成', () => {
    expect(() => pdfFromJpegs([])).toThrow('documentEmptyFile');
  });
});

describe('prepareDocumentFiles', () => {
  it('单个文件保持原文件，不额外转换', () => {
    const file = imageFile('page.png');
    expect(prepareDocumentFiles([file])).toEqual({ ok: true, file });
  });

  it('浏览器未标注 MIME 时按扩展名补全', () => {
    const prepared = prepareDocumentFiles([imageFile('SCAN.PNG', '')]);
    expect(prepared).not.toBeInstanceOf(Promise);
    if (prepared instanceof Promise || !prepared.ok) throw new Error('expected sync file');
    expect(prepared.file.type).toBe('image/png');
  });

  it('空选择返回空文件错误', () => {
    expect(prepareDocumentFiles([])).toEqual({ ok: false, error: 'documentEmptyFile' });
  });

  it('多份 PDF 或 PDF 与图片混选时拒绝，避免静默丢弃文件', () => {
    expect(prepareDocumentFiles([pdfFile('a.pdf'), pdfFile('b.pdf')])).toEqual({
      ok: false,
      error: 'documentOnePdf',
    });
    expect(prepareDocumentFiles([pdfFile(), imageFile('page.png')])).toEqual({
      ok: false,
      error: 'documentOnePdf',
    });
  });

  it('多张图片的合计大小超过 64 MiB 时拒绝，不能只看单文件大小', () => {
    const first = imageFile('1.png');
    const second = imageFile('2.png');
    Object.defineProperty(first, 'size', { value: 34 * 1024 * 1024 });
    Object.defineProperty(second, 'size', { value: 31 * 1024 * 1024 });

    expect(prepareDocumentFiles([first, second])).toEqual({
      ok: false,
      error: 'documentFileTooLarge',
    });
  });

  it('多张图片合成后的 PDF 超过 64 MiB 时拒绝，不能只看原始图片合计大小', async () => {
    const bitmap = { width: 10, height: 10, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(new Blob([new Uint8Array([9])], { type: 'image/jpeg' })),
    );
    const OriginalFile = globalThis.File;
    class OversizedFile extends OriginalFile {
      constructor(
        parts: BlobPart[],
        name: string,
        options?: { type?: string; lastModified?: number },
      ) {
        super(parts, name, options);
        Object.defineProperty(this, 'size', { value: 64 * 1024 * 1024 + 1 });
      }
    }
    vi.stubGlobal('File', OversizedFile);

    const result = await prepareDocumentFiles([imageFile('1.png'), imageFile('2.png')]);

    expect(result).toEqual({ ok: false, error: 'documentFileTooLarge' });
  });

  it('接受 GIF 等浏览器图片格式', () => {
    const gif = imageFile('animated.gif', 'image/gif');
    expect(prepareDocumentFiles([gif])).toEqual({ ok: true, file: gif });
  });

  it('多张图片按顺序合成一份 PDF，并释放位图', async () => {
    const close = vi.fn();
    const bitmap = { width: 3000, height: 2000, close };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(new Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' })),
    );

    const result = await prepareDocumentFiles([imageFile('1.png'), imageFile('2.png')]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.type).toBe('application/pdf');
    expect(result.file.name).toBe('1 等2张.pdf');
    expect(context.drawImage).toHaveBeenCalledTimes(2);
    // When the long edge exceeds the limit, scale down proportionally.
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 2000, 1333);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('图片解码失败时返回上传错误', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));

    await expect(prepareDocumentFiles([imageFile('1.png'), imageFile('2.png')])).resolves.toEqual({
      ok: false,
      error: 'documentUploadFailed',
    });
  });
});
