import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureImageParseFileReference } from '../imageParseFileReference';
import type { Attachment } from '../../types';

const { upload, assets } = vi.hoisted(() => ({ upload: vi.fn(), assets: vi.fn() }));
vi.mock('@/api/map/fileUploads', () => ({ uploadPlaygroundFile: upload }));
vi.mock('@/api/map/assets', () => ({ mapAssetsApi: { upload: assets } }));

const attachment: Attachment = {
  id: 'a',
  kind: 'image',
  name: 'page.png',
  mime: 'image/png',
  size: 1,
  dataUrl: 'data:image/png;base64,QQ==',
};

describe('OCR 只使用文件服务', () => {
  beforeEach(() => vi.resetAllMocks());

  it('旧资产链接不再作为识别输入，改用文件服务补传', async () => {
    upload.mockResolvedValue('file_new');
    await expect(
      ensureImageParseFileReference({
        attachment: { ...attachment, publicUrl: 'https://platform.invalid/asset' },
        projectId: 'project',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ fileId: 'file_new' });
    expect(upload).toHaveBeenCalledOnce();
    expect(assets).not.toHaveBeenCalled();
  });

  it('上传失败时不回退资产入口或内联图片', async () => {
    const cause = new Error('private detail');
    upload.mockRejectedValue(cause);
    await expect(
      ensureImageParseFileReference({
        attachment,
        projectId: 'project',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ message: 'imageParseFileReferenceUploadFailed', cause });
    expect(assets).not.toHaveBeenCalled();
  });

  it('原始 PDF 缺少 fileId 时读取原件补传一次，不生成页图', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['%PDF-original'], { type: 'application/pdf' }),
    });
    vi.stubGlobal('fetch', fetch);
    upload.mockResolvedValue('file_pdf');
    const signal = new AbortController().signal;
    try {
      await expect(
        ensureImageParseFileReference({
          attachment: {
            ...attachment,
            kind: 'file',
            name: 'original.pdf',
            mime: 'application/pdf',
            dataUrl: 'blob:original-pdf',
          },
          projectId: 'project',
          signal,
        }),
      ).resolves.toEqual({ fileId: 'file_pdf' });
      expect(fetch).toHaveBeenCalledExactlyOnceWith('blob:original-pdf', { signal });
      expect(upload).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ name: 'original.pdf', type: 'application/pdf' }),
        'project',
        signal,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('已有 PDF fileId 时不读取或重复上传原件', async () => {
    await expect(
      ensureImageParseFileReference({
        attachment: { ...attachment, kind: 'file', mime: 'application/pdf', fileId: 'file_pdf' },
        projectId: 'project',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ fileId: 'file_pdf' });
    expect(upload).not.toHaveBeenCalled();
  });
});
