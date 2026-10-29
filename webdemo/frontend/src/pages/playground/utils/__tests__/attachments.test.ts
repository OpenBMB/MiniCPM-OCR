/**
 * Unit tests for the attachments helpers: modality recognition + content-part mapping + size formatting.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Attachment } from '../../types';

class UploadError extends Error {
  code: string;
  details?: { obs_code?: string };

  constructor(
    code: string,
    message: string,
    extra?: { status?: number; details?: { obs_code?: string } },
  ) {
    super(message);
    this.code = code;
    this.details = extra?.details;
  }
}
import {
  attachmentToPart,
  detectKind,
  formatBytes,
  readFileAsAttachment,
  readPreviewAttachment,
} from '../attachments';

const upload = vi.hoisted(() => vi.fn());
const { config, uploadDirect } = vi.hoisted(() => ({ config: vi.fn(), uploadDirect: vi.fn() }));
vi.mock('@/api/map/assets', () => ({ mapAssetsApi: { upload } }));
vi.mock('@/api/map/fileUploads', () => ({
  fileUploadConfig: config,
  uploadPlaygroundFile: uploadDirect,
}));

describe('readFileAsAttachment cancellation', () => {
  const OCR_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/bmp', 'image/webp', 'image/tiff'];

  it('绑定项目走文件服务 SDK，保留文件 ID 且不调用旧上传入口', async () => {
    config.mockResolvedValue({ enabled: true, project_id: 'project-1' });
    uploadDirect.mockResolvedValue('f_test');
    upload.mockClear();
    const result = await readFileAsAttachment(
      new File(['hello'], 'hello.txt', { type: 'text/plain' }),
    );
    expect(result.attachment?.fileId).toBe('f_test');
    expect(uploadDirect).toHaveBeenCalledWith(expect.any(File), 'project-1', undefined);
    expect(upload).not.toHaveBeenCalled();
  });

  it('文件服务存储凭据异常时回退旧上传入口并保留返回链接', async () => {
    config.mockResolvedValue({ enabled: true, project_id: 'project-1' });
    uploadDirect.mockRejectedValue(
      new UploadError('PERMISSION_DENIED', '对象存储拒绝了表单上传（InvalidAccessKeyId）', {
        status: 403,
        details: { obs_code: 'InvalidAccessKeyId' },
      }),
    );
    upload.mockResolvedValue({
      url: '/api/assets/object/map-playground-fallback/dev/file/example',
      proxy_url: '/api/assets/object/map-playground-fallback/dev/file/example',
      public_url: 'https://platform-dev.modelbest.co/api/assets/public/example',
      key: 'map-playground-fallback/dev/file/example',
    });
    upload.mockClear();
    const result = await readFileAsAttachment(
      new File(['hello'], 'hello.txt', { type: 'text/plain' }),
    );
    expect(result).toMatchObject({
      ok: true,
      attachment: {
        publicUrl: 'https://platform-dev.modelbest.co/api/assets/public/example',
        objectKey: 'map-playground-fallback/dev/file/example',
      },
    });
    expect(upload).toHaveBeenCalledWith(expect.any(File), undefined);
  });

  it('文件服务业务校验失败时不回退到旧上传入口', async () => {
    config.mockResolvedValue({ enabled: true, project_id: 'project-1' });
    uploadDirect.mockRejectedValue(new UploadError('INVALID_ARGUMENT', '上传失败'));
    upload.mockClear();
    const result = await readFileAsAttachment(
      new File(['hello'], 'hello.txt', { type: 'text/plain' }),
    );
    expect(result).toMatchObject({ ok: false, error: '上传失败' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('旧上传入口也失败时返回实际错误', async () => {
    config.mockResolvedValue({ enabled: true, project_id: 'project-1' });
    uploadDirect.mockRejectedValue(new UploadError('UNAVAILABLE', '文件服务不可用'));
    upload.mockRejectedValue(new Error('旧上传入口失败'));
    const result = await readFileAsAttachment(
      new File(['hello'], 'hello.txt', { type: 'text/plain' }),
    );
    expect(result).toMatchObject({ ok: false, error: '旧上传入口失败' });
  });

  it('项目未绑定时保留旧资产上传行为', async () => {
    config.mockResolvedValue({ enabled: false });
    upload.mockResolvedValue({ url: '/api/assets/object/example', key: 'example' });
    const result = await readFileAsAttachment(
      new File(['hello'], 'hello.txt', { type: 'text/plain' }),
    );
    expect(result.attachment?.url).toBe('/api/assets/object/example');
  });

  it('allows OCR to override the local preview size limit', async () => {
    config.mockResolvedValue({ enabled: false });
    upload.mockResolvedValue({ url: '/api/assets/object/example', key: 'example' });
    const image = new File([new Uint8Array(9 * 1024 * 1024)], 'page.png', {
      type: 'image/png',
    });
    const options = { maxBytes: 10 * 1024 * 1024 };

    const result = await readFileAsAttachment(image, undefined, options);

    expect(result.ok).toBe(true);
    expect(upload).toHaveBeenCalledWith(image, undefined);
  });

  it('allows callers to keep a local copy when optional document upload is unavailable', async () => {
    upload.mockClear();
    config.mockRejectedValue(new Error('file service unavailable'));
    const pdf = new File(['%PDF-1.4'], 'document.pdf', { type: 'application/pdf' });

    const result = await readFileAsAttachment(pdf, undefined, {
      maxBytes: 10 * 1024 * 1024,
      allowLocalFallback: true,
    });

    expect(result.ok).toBe(true);
    expect(upload).not.toHaveBeenCalled();
    expect(result.attachment?.dataUrl).toMatch(/^data:application\/pdf;base64,/);
  });

  it('OCR 本地兜底时不访问旧上传入口', async () => {
    config.mockResolvedValue({ enabled: true, project_id: 'project-1' });
    uploadDirect.mockRejectedValue(new UploadError('UNAVAILABLE', '文件服务不可用'));
    upload.mockClear();

    const result = await readFileAsAttachment(
      new File(['image'], 'page.png', { type: 'image/png' }),
      undefined,
      { allowLocalFallback: true },
    );

    expect(result.ok).toBe(true);
    expect(result.attachment?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(upload).not.toHaveBeenCalled();
  });

  it('OCR 优先使用旧资产入口并保留签名链接', async () => {
    config.mockResolvedValue({ enabled: true, project_id: 'project-1' });
    upload.mockResolvedValue({
      url: '/api/assets/object/map/dev/image/example',
      proxy_url: '/api/assets/object/map/dev/image/example',
      public_url: 'https://platform-dev.modelbest.co/api/assets/public/example',
      key: 'map/dev/image/example',
    });
    uploadDirect.mockClear();

    const result = await readFileAsAttachment(
      new File(['image'], 'page.png', { type: 'image/png' }),
      undefined,
      { allowLocalFallback: true, preferLegacyUpload: true },
    );

    expect(result).toMatchObject({
      ok: true,
      attachment: {
        publicUrl: 'https://platform-dev.modelbest.co/api/assets/public/example',
        objectKey: 'map/dev/image/example',
      },
    });
    expect(upload).toHaveBeenCalledOnce();
    expect(uploadDirect).not.toHaveBeenCalled();
  });

  it('keeps the Playground 8 MiB default when no override is provided', async () => {
    const image = new File([new Uint8Array(9 * 1024 * 1024)], 'page.png', {
      type: 'image/png',
    });

    const result = await readPreviewAttachment(image);

    expect(result).toMatchObject({ ok: false, error: '图片过大（上限 8MB）' });
  });

  it('lets OCR restrict local preview to its own image whitelist', async () => {
    const bmp = new File(['bmp'], 'page.bmp', { type: 'image/bmp' });
    const tiff = new File(['tiff'], 'page.tiff', { type: 'image/tiff' });
    const gif = new File(['gif'], 'animated.gif', { type: 'image/gif' });

    await expect(
      readPreviewAttachment(bmp, undefined, { accept: OCR_IMAGE_TYPES }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      readPreviewAttachment(tiff, undefined, { accept: OCR_IMAGE_TYPES }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      readPreviewAttachment(gif, undefined, { accept: ['image/*'] }),
    ).resolves.toMatchObject({ ok: true });
    await expect(readPreviewAttachment(tiff)).resolves.toMatchObject({
      ok: false,
      error: '不支持的图片格式：image/tiff',
    });
  });

  it('图像解析演示只读本地文件，不向资产服务上传', async () => {
    upload.mockClear();
    const result = await readPreviewAttachment(
      new File(['pdf'], 'a.pdf', { type: 'application/pdf' }),
    );
    expect(result.ok).toBe(true);
    expect(result.attachment?.dataUrl).toMatch(/^data:application\/pdf;base64,/);
    expect(result.attachment?.url).toBeUndefined();
    expect(upload).not.toHaveBeenCalled();
  });

  it('cancels local file reading without starting a network upload', async () => {
    const controller = new AbortController();
    const pending = readFileAsAttachment(
      new File(['pdf'], 'a.pdf', { type: 'application/pdf' }),
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('does not read or upload when cancellation already occurred', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readFileAsAttachment(new File(['pdf'], 'a.pdf'), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(upload).not.toHaveBeenCalled();
  });
});

/** Build a test attachment */
function att(overrides: Partial<Attachment>): Attachment {
  return {
    id: 'a',
    kind: 'file',
    name: 'f',
    mime: 'application/pdf',
    size: 1,
    dataUrl: 'data:x;base64,AAA',
    ...overrides,
  };
}

describe('detectKind', () => {
  it('按 MIME 前缀归类，其余归为 file', () => {
    expect(detectKind('image/png')).toBe('image');
    expect(detectKind('video/mp4')).toBe('video');
    expect(detectKind('audio/mpeg')).toBe('audio');
    expect(detectKind('application/pdf')).toBe('file');
    expect(detectKind('')).toBe('file');
  });
});

describe('attachmentToPart', () => {
  it('image → image_url（保留完整 data URL）', () => {
    const part = attachmentToPart(
      att({ kind: 'image', mime: 'image/png', dataUrl: 'data:image/png;base64,IMG' }),
    );
    expect(part).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,IMG' } });
  });

  it('发送给模型时 image/file 优先使用平台公开代理 URL', () => {
    const publicUrl = 'https://platform-dev.modelbest.co/api/assets/public/token';
    const image = attachmentToPart(
      att({
        kind: 'image',
        mime: 'image/png',
        dataUrl: 'data:image/png;base64,IMG',
        url: 'https://assets.example/map/dev/image/a.png',
        publicUrl,
      }),
    );
    expect(image).toEqual({ type: 'image_url', image_url: { url: publicUrl } });
    const file = attachmentToPart(
      att({
        kind: 'file',
        name: 'a.pdf',
        mime: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,DOC',
        url: 'https://assets.example/map/dev/file/a.pdf',
        publicUrl,
      }),
    );
    expect(file).toEqual({ type: 'file', file: { filename: 'a.pdf', file_url: publicUrl } });
  });

  it('video → video_url', () => {
    const part = attachmentToPart(
      att({ kind: 'video', mime: 'video/mp4', dataUrl: 'data:video/mp4;base64,VID' }),
    );
    expect(part).toEqual({ type: 'video_url', video_url: { url: 'data:video/mp4;base64,VID' } });
  });

  it('audio → input_audio（裸 base64 + 由 MIME 推断 format）', () => {
    const mp3 = attachmentToPart(
      att({ kind: 'audio', mime: 'audio/mpeg', dataUrl: 'data:audio/mpeg;base64,SND' }),
    );
    expect(mp3).toEqual({ type: 'input_audio', input_audio: { data: 'SND', format: 'mp3' } });
    const wav = attachmentToPart(
      att({ kind: 'audio', mime: 'audio/wav', dataUrl: 'data:audio/wav;base64,W' }),
    );
    expect(wav).toEqual({ type: 'input_audio', input_audio: { data: 'W', format: 'wav' } });
  });

  it('file → file（filename + 完整 data URL）', () => {
    const part = attachmentToPart(
      att({
        kind: 'file',
        name: 'a.pdf',
        mime: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,DOC',
      }),
    );
    expect(part).toEqual({
      type: 'file',
      file: { filename: 'a.pdf', file_data: 'data:application/pdf;base64,DOC' },
    });
  });
});

describe('formatBytes', () => {
  it('按 B / KB / MB 友好显示', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
