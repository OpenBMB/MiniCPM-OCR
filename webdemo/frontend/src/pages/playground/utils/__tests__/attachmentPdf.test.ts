import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readPdfAttachment } from '../attachmentPdf';

const { config, uploadDirect } = vi.hoisted(() => ({
  config: vi.fn(),
  uploadDirect: vi.fn(),
}));

vi.mock('@/api/map/fileUploads', () => ({
  fileUploadConfig: config,
  uploadPlaygroundFile: uploadDirect,
}));

const options = { maxBytes: 20 * 1024 * 1024, allowLocalFallback: true };

beforeEach(() => {
  vi.clearAllMocks();
});

function pdf() {
  return new File(['%PDF-1.4'], 'large.pdf', { type: 'application/pdf' });
}

describe('OCR 大 PDF 附件读取', () => {
  it('文件服务可用时先上传并使用 Blob URL，不把大文件转成 base64', async () => {
    config.mockResolvedValue({ enabled: true, project_id: 'project-1' });
    uploadDirect.mockResolvedValue('f_large_pdf');
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:large-pdf');
    vi.stubGlobal(
      'FileReader',
      class UnexpectedFileReader {
        constructor() {
          throw new Error('大 PDF 上传路径不应读取 data URL');
        }
      },
    );

    try {
      const result = await readPdfAttachment(pdf(), options);

      expect(result).toMatchObject({
        ok: true,
        attachment: { fileId: 'f_large_pdf', dataUrl: 'blob:large-pdf' },
      });
      expect(uploadDirect).toHaveBeenCalledWith(expect.any(File), 'project-1', undefined);
    } finally {
      vi.unstubAllGlobals();
      createObjectURL.mockRestore();
    }
  });

  it('文件服务上传失败时仍按 OCR 本地策略回退 Blob URL', async () => {
    config.mockResolvedValue({ enabled: true, project_id: 'project-1' });
    uploadDirect.mockRejectedValue(new Error('upload failed'));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('unused');

    try {
      const result = await readPdfAttachment(pdf(), options);

      expect(result.ok).toBe(true);
      expect(result.attachment?.fileId).toBeUndefined();
      expect(result.attachment?.dataUrl).toBe('unused');
    } finally {
      createObjectURL.mockRestore();
    }
  });

  it('文件服务未启用时也使用 Blob URL，不把大 PDF 转成 base64', async () => {
    config.mockResolvedValue({ enabled: false });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-pdf');
    vi.stubGlobal(
      'FileReader',
      class UnexpectedFileReader {
        constructor() {
          throw new Error('本地 PDF 预览不应读取 data URL');
        }
      },
    );

    try {
      const result = await readPdfAttachment(pdf(), options);

      expect(result).toMatchObject({
        ok: true,
        attachment: { dataUrl: 'blob:local-pdf' },
      });
      expect(uploadDirect).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      createObjectURL.mockRestore();
    }
  });

  it('超出大小上限时直接失败，不访问文件服务', async () => {
    const large = new File([new Uint8Array(2)], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(large, 'size', { value: options.maxBytes + 1 });

    const result = await readPdfAttachment(large, options);

    expect(result).toMatchObject({ ok: false, error: '文件过大（上限 20MB）' });
    expect(config).not.toHaveBeenCalled();
    expect(uploadDirect).not.toHaveBeenCalled();
  });
});
