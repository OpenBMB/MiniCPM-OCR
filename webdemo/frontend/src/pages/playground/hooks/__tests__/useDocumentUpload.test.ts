/** Remote-upload validation, retry, cancellation, and stale-response isolation, none of which touch the real asset service. */
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadAttachmentResult } from '../../utils/attachments';
import { useDocumentUpload } from '../useDocumentUpload';

const read = vi.hoisted(() => vi.fn());
const readPreview = vi.hoisted(() => vi.fn());
const uploadDocument = vi.hoisted(() => vi.fn());
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../utils/attachments', () => ({
  readFileAsAttachment: read,
  readPreviewAttachment: readPreview,
}));
vi.mock('../../utils/imageParseUpload', () => ({
  uploadImageParseDocument: uploadDocument,
}));

function renderUpload(onReady: Parameters<typeof useDocumentUpload>[0], previewOnly = false) {
  const client = new QueryClient();
  return renderHook(({ scope }) => useDocumentUpload(onReady, scope, undefined, previewOnly), {
    initialProps: { scope: 'initial-project' },
    wrapper: ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client }, children),
  });
}

const file = new File(['%PDF-1.4'], 'document.pdf', { type: 'application/pdf' });
const completed: ReadAttachmentResult = {
  ok: true,
  attachment: {
    id: 'a',
    kind: 'file',
    mime: 'application/pdf',
    name: file.name,
    size: file.size,
    dataUrl: '',
  },
};

describe('useDocumentUpload', () => {
  beforeEach(() => {
    read.mockReset();
    readPreview.mockReset();
    uploadDocument.mockReset();
  });

  it('previews locally without uploading when no model is connected', async () => {
    readPreview.mockResolvedValue(completed);
    const ready = vi.fn();
    const { result } = renderUpload(ready, true);
    await act(() => result.current.upload(file));
    expect(readPreview).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(ready).toHaveBeenCalledWith(completed.attachment);
  });

  it.each([
    [new File([], 'empty.pdf', { type: 'application/pdf' }), 'documentEmptyFile'],
    [new File(['x'], 'script.html', { type: 'text/html' }), 'imageParseOnlyImage'],
    [
      new File([new Uint8Array(64 * 1024 * 1024 + 1)], 'large.pdf', { type: 'application/pdf' }),
      'documentFileTooLarge',
    ],
  ])('rejects invalid documents before network access', async (invalid, error) => {
    const ready = vi.fn();
    const { result } = renderUpload(ready);
    await act(() => result.current.upload(invalid));
    expect(result.current.error).toBe(error);
    expect(read).not.toHaveBeenCalled();
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });

  it('normalizes and uploads OCR PDF files with a stable file ID', async () => {
    const uploaded: ReadAttachmentResult = {
      ok: true,
      attachment: {
        ...completed.attachment!,
        dataUrl: 'data:application/pdf;base64,AAA',
        fileId: 'file_pdf',
      },
    };
    uploadDocument.mockResolvedValue(uploaded);
    const ready = vi.fn();
    const { result } = renderUpload(ready);
    await act(() => result.current.upload(new File(['%PDF'], 'document.PDF')));
    expect(uploadDocument.mock.calls[0][0].type).toBe('application/pdf');
    expect(uploadDocument).toHaveBeenCalledWith(
      expect.anything(),
      {
        maxBytes: 64 * 1024 * 1024,
        accept: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/bmp', 'image/webp'],
      },
      expect.any(AbortSignal),
    );
    expect(read).not.toHaveBeenCalled();
    expect(readPreview).not.toHaveBeenCalled();
    expect(ready).toHaveBeenCalledWith(uploaded.attachment);
  });

  it('uses the OCR 64 MiB limit for direct images without changing Playground defaults', async () => {
    const imageResult: ReadAttachmentResult = {
      ok: true,
      attachment: {
        id: 'image',
        kind: 'image',
        mime: 'image/png',
        name: 'page.png',
        size: 3,
        dataUrl: 'data:image/png;base64,AAA',
      },
    };
    uploadDocument.mockResolvedValue(imageResult);
    const ready = vi.fn();
    const { result } = renderUpload(ready);
    const image = new File(['abc'], 'page.png', { type: 'image/png' });

    await act(() => result.current.upload(image));

    expect(uploadDocument).toHaveBeenCalledWith(
      image,
      {
        maxBytes: 64 * 1024 * 1024,
        accept: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/bmp', 'image/webp'],
      },
      expect.any(AbortSignal),
    );
    expect(ready).toHaveBeenCalledWith(imageResult.attachment);
  });

  it('retains failed files for retry and clears the error on success', async () => {
    uploadDocument
      .mockResolvedValueOnce({ ok: false, error: 'offline' })
      .mockResolvedValueOnce(completed);
    const ready = vi.fn();
    const { result } = renderUpload(ready);
    await act(() => result.current.upload(file));
    expect(result.current.error).toBe('documentUploadFailed');
    expect(result.current.file).toBe(file);
    await act(async () => {
      result.current.retry();
    });
    expect(uploadDocument).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeUndefined();
    expect(ready).toHaveBeenCalledOnce();
  });

  it('ignores a completed response after cancellation', async () => {
    let resolve: (value: ReadAttachmentResult) => void = () => undefined;
    uploadDocument.mockImplementation(
      () =>
        new Promise<ReadAttachmentResult>((done) => {
          resolve = done;
        }),
    );
    const ready = vi.fn();
    const { result } = renderUpload(ready);
    let pending: Promise<unknown>;
    await act(async () => {
      pending = result.current.upload(file);
    });
    const signal = uploadDocument.mock.calls[0][2] as AbortSignal;
    act(() => result.current.cancel());
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve(completed);
      await pending;
    });
    expect(ready).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });

  it('cancels old uploads when the account or project scope changes', async () => {
    let resolve!: (value: ReadAttachmentResult) => void;
    uploadDocument.mockImplementation(
      () =>
        new Promise<ReadAttachmentResult>((done) => {
          resolve = done;
        }),
    );
    const ready = vi.fn();
    const { result, rerender } = renderUpload(ready);
    await act(async () => {
      void result.current.upload(file);
    });
    const signal = uploadDocument.mock.calls[0][2] as AbortSignal;
    await act(async () => {
      rerender({ scope: 'other-project' });
    });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve(completed);
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.file).toBeUndefined();
    expect(ready).not.toHaveBeenCalled();
  });

  it('aborts work when the workspace unmounts', async () => {
    uploadDocument.mockImplementation(() => new Promise(() => undefined));
    const { result, unmount } = renderUpload(vi.fn());
    await act(async () => {
      void result.current.upload(file);
    });
    const signal = uploadDocument.mock.calls[0][2] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
