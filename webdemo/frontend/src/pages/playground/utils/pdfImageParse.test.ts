import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageParseJob } from '@/api/map/imageParseJobs';
import type { Attachment } from '../types';
import { parsePdfPages } from './pdfImageParse';

const mocks = vi.hoisted(() => ({
  job: vi.fn(),
  ensure: vi.fn(),
  render: vi.fn(),
  crops: vi.fn(),
}));
vi.mock('@/api/map/imageParseJobs', () => ({ runImageParseJob: mocks.job }));
vi.mock('./imageParseFileReference', () => ({ ensureImageParseFileReference: mocks.ensure }));
vi.mock('./pdfPageImage', () => ({ renderPdfPageImage: mocks.render }));
vi.mock('./imageParseCrops', () => ({ imageParseCrops: mocks.crops }));

const attachment: Attachment = {
  id: 'original',
  kind: 'file',
  mime: 'application/pdf',
  name: 'original.pdf',
  dataUrl: 'blob:original',
  size: 1024,
  fileId: 'file-original',
};
const page = (index: number) => ({
  metadata: { page_index: index },
  choices: [{ message: { content: `page ${index}` } }],
  ocr: { mode: 'standard' as const, image_width: 100, image_height: 100, blocks: [] },
});
const job = (pages = [page(0), page(1), page(2)]): ImageParseJob => ({
  id: 'job-original',
  status: 'Success',
  pages_total: 3,
  pages_done: pages.length,
  pages,
});
const signal = () => new AbortController().signal;

describe('original PDF async jobs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.ensure.mockResolvedValue({ fileId: 'file-original' });
    mocks.job.mockImplementation(async ({ onProgress }) => {
      onProgress(job());
      return job();
    });
  });

  it('submits the original attachment once without rendering, per-page uploads or eager crops', async () => {
    const onOpen = vi.fn();
    const onPage = vi.fn();
    await parsePdfPages(
      attachment.dataUrl,
      'standard',
      'ocr-model',
      'project-1',
      signal(),
      onOpen,
      onPage,
      undefined,
      undefined,
      undefined,
      false,
      true,
      attachment,
    );
    expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith({
      attachment,
      projectId: 'project-1',
      signal: expect.any(AbortSignal),
    });
    expect(mocks.job).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        task: 'standard',
        model: 'ocr-model',
        fileId: 'file-original',
        upright: false,
        recognizeSeal: true,
      }),
    );
    expect(mocks.job.mock.calls[0]![0]).not.toHaveProperty('pageIndex');
    expect(mocks.job.mock.calls[0]![0]).not.toHaveProperty('image');
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(3);
    expect(onPage.mock.calls.map(([index]) => index)).toEqual([1, 2, 3]);
    expect(onPage.mock.calls[0]![1]).toMatchObject({ result: { markdown: 'page 0' } });
    expect(onPage.mock.calls[0]![1]).not.toHaveProperty('crops');
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.crops).not.toHaveBeenCalled();
  });

  it('uses metadata indexes, publishes running prefixes and ignores repeated pages', async () => {
    const onPage = vi.fn();
    mocks.job.mockImplementation(async ({ onProgress }) => {
      onProgress({ ...job([page(1)]), status: 'Running' });
      expect(onPage.mock.calls.map(([index]) => index)).toEqual([2]);
      onProgress({ ...job([page(1), page(0)]), status: 'Running' });
      onProgress(job([page(1), page(0), page(2)]));
      return job();
    });
    await parsePdfPages('pdf', 'standard', 'ocr', 'project', signal(), vi.fn(), onPage);
    expect(onPage.mock.calls.map(([index]) => index)).toEqual([2, 1, 3]);
    expect(mocks.ensure.mock.calls[0]![0].attachment).toMatchObject({
      kind: 'file',
      mime: 'application/pdf',
      dataUrl: 'pdf',
    });
    expect(mocks.ensure).toHaveBeenCalledOnce();
  });

  it('retries one page against the original file_id using its zero-based page_index', async () => {
    mocks.job.mockResolvedValue(job([page(8)]));
    const onPage = vi.fn();
    const onOpen = vi.fn();
    await parsePdfPages(
      'pdf',
      'standard',
      'ocr',
      'project',
      signal(),
      onOpen,
      onPage,
      9,
      undefined,
      undefined,
      true,
      false,
      attachment,
    );
    expect(mocks.job.mock.calls[0]![0]).toMatchObject({
      fileId: 'file-original',
      pageIndex: 8,
      recognizeSeal: true,
    });
    expect(onPage).toHaveBeenCalledExactlyOnceWith(
      9,
      expect.objectContaining({
        result: expect.objectContaining({ markdown: 'page 8' }),
      }),
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('resume resubmits one original task but skips completed pages in local presentation only', async () => {
    const priority = vi.fn().mockReturnValue(3);
    const onPage = vi.fn();
    await parsePdfPages(
      'pdf',
      'scored',
      'ocr',
      'project',
      signal(),
      vi.fn(),
      onPage,
      undefined,
      priority,
      new Set([1, 3]),
    );
    expect(mocks.job).toHaveBeenCalledOnce();
    expect(mocks.job.mock.calls[0]![0]).not.toHaveProperty('pageIndex');
    expect(mocks.job.mock.calls[0]![0]).not.toHaveProperty('skipPages');
    expect(onPage.mock.calls.map(([index]) => index)).toEqual([2]);
    expect(priority).not.toHaveBeenCalled();
  });

  it('retains completed pages and reports a stable job failure for remaining pages', async () => {
    mocks.job.mockImplementation(async ({ onProgress }) => {
      onProgress({ ...job([page(0)]), status: 'Running' });
      throw new Error('imageParseModerated');
    });
    const onPage = vi.fn();
    await expect(
      parsePdfPages('pdf', 'standard', 'ocr', 'project', signal(), vi.fn(), onPage),
    ).rejects.toThrow('imageParseModerated');
    expect(onPage.mock.calls).toEqual([
      [1, expect.objectContaining({ result: expect.objectContaining({ markdown: 'page 0' }) })],
      [2, { error: 'imageParseModerated' }],
      [3, { error: 'imageParseModerated' }],
    ]);
  });

  it('isolates an invalid OCR page and preserves the other completed results', async () => {
    mocks.job.mockResolvedValue(
      job([page(0), { ...page(1), choices: [{ message: { content: '' } }] }, page(2)]),
    );
    const onPage = vi.fn();
    await parsePdfPages('pdf', 'standard', 'ocr', 'project', signal(), vi.fn(), onPage);
    expect(onPage.mock.calls[1]).toEqual([2, { error: 'imageParseEmptyResponse' }]);
    expect(onPage.mock.calls[2]![1].result.markdown).toBe('page 2');
  });

  it('rejects a successful job that omits a PDF page and marks the page for retry', async () => {
    mocks.job.mockResolvedValue(job([page(0)]));
    const onPage = vi.fn();

    await expect(
      parsePdfPages('pdf', 'standard', 'ocr', 'project', signal(), vi.fn(), onPage),
    ).rejects.toThrow('imageParseInvalidResult');
    expect(onPage.mock.calls).toEqual([
      [1, expect.objectContaining({ result: expect.objectContaining({ markdown: 'page 0' }) })],
      [2, { error: 'imageParseInvalidResult' }],
      [3, { error: 'imageParseInvalidResult' }],
    ]);
  });

  it('does not misattribute a retry response to another original page', async () => {
    mocks.job.mockResolvedValue(job([page(0)]));
    const onPage = vi.fn();
    await expect(
      parsePdfPages('pdf', 'standard', 'ocr', 'project', signal(), vi.fn(), onPage, 9),
    ).rejects.toThrow('imageParseInvalidResult');
    expect(onPage).toHaveBeenCalledExactlyOnceWith(9, { error: 'imageParseInvalidResult' });
  });

  it('marks a successful single-page retry with no page payload as invalid', async () => {
    mocks.job.mockResolvedValue({ ...job([]), pages_total: 1, pages_done: 0 });
    const onPage = vi.fn();

    await expect(
      parsePdfPages('pdf', 'standard', 'ocr', 'project', signal(), vi.fn(), onPage, 2),
    ).rejects.toThrow('imageParseInvalidResult');
    expect(onPage).toHaveBeenCalledExactlyOnceWith(2, { error: 'imageParseInvalidResult' });
  });

  it('stops publishing progress after abort', async () => {
    const controller = new AbortController();
    const onPage = vi.fn();
    mocks.job.mockImplementation(async ({ onProgress, signal: jobSignal }) => {
      expect(jobSignal).toBe(controller.signal);
      controller.abort();
      onProgress(job());
      jobSignal.throwIfAborted();
    });
    await expect(
      parsePdfPages('pdf', 'standard', 'ocr', 'project', controller.signal, vi.fn(), onPage),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(onPage).not.toHaveBeenCalled();
  });

  it('does not upload or create a task when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      parsePdfPages('pdf', 'standard', 'ocr', 'project', controller.signal, vi.fn(), vi.fn()),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.job).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5])(
    'rejects invalid one-based retry page %s before creating a task',
    async (index) => {
      await expect(
        parsePdfPages('pdf', 'standard', 'ocr', 'project', signal(), vi.fn(), vi.fn(), index),
      ).rejects.toThrow('documentPdfFailed');
      expect(mocks.job).not.toHaveBeenCalled();
    },
  );

  it('accepts 500-page tasks and rejects progress above the PDF limit', async () => {
    mocks.job.mockResolvedValue({
      ...job(Array.from({ length: 500 }, (_, index) => page(index))),
      pages_total: 500,
    });
    const onOpen = vi.fn();
    await parsePdfPages('pdf', 'standard', 'ocr', 'project', signal(), onOpen, vi.fn());
    expect(onOpen).toHaveBeenCalledWith(500);
    mocks.job.mockResolvedValue({ ...job(), pages_total: 501 });
    await expect(
      parsePdfPages('pdf', 'standard', 'ocr', 'project', signal(), vi.fn(), vi.fn()),
    ).rejects.toThrow('imageParsePdfTooManyPages');
  });

  it('submits KIE PDF fields in a single file_id task and streams page results', async () => {
    const onPage = vi.fn();
    await parsePdfPages(
      'blob:contract',
      'kie',
      'minicpm-ocr-1.0',
      'project',
      signal(),
      vi.fn(),
      onPage,
      undefined,
      undefined,
      undefined,
      true,
      true,
      attachment,
      { fields: ['合同编号'] },
    );
    expect(mocks.job).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        task: 'kie',
        model: 'minicpm-ocr-1.0',
        fileId: 'file-original',
        fields: ['合同编号'],
      }),
    );
    expect(onPage.mock.calls.map(([index]) => index)).toEqual([1, 2, 3]);
  });
});
