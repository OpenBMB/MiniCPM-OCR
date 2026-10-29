import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { BizError } from '@map/types';

import { runImageParseJob } from '../imageParseJobs';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../request', () => ({ mapRequest: mocks.request }));

const running = { id: 'job/one', status: 'Running', pages_done: 0, pages_total: 2 };
const success = { ...running, status: 'Success', pages_done: 2 };
const input = {
  model: ' minicpm-ocr-aio ',
  task: 'standard' as const,
  fileId: ' file-original ',
  upright: false,
  recognizeSeal: true,
};
let queryClient: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.request.mockReset();
  queryClient = new QueryClient();
});

afterEach(() => {
  queryClient.clear();
  vi.useRealTimers();
});

describe('MAP OCR jobs', () => {
  it('posts only the original file reference and polls once per second until terminal', async () => {
    const progress = vi.fn();
    const partial = { ...running, pages_done: 1, pages: [] };
    mocks.request
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(partial)
      .mockResolvedValueOnce(success);
    const promise = runImageParseJob({
      ...input,
      queryClient,
      signal: new AbortController().signal,
      onProgress: progress,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const [path, init] = mocks.request.mock.calls[0]!;
    expect(path).toBe('/image-parse/jobs');
    expect(JSON.parse(init.body)).toEqual({
      model: 'minicpm-ocr-aio',
      task: 'standard',
      file_id: 'file-original',
      upright: false,
      recognize_seal: true,
      recognize_chart: true,
    });
    expect(init.signal).toBeUndefined();
    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.request).toHaveBeenLastCalledWith('/image-parse/jobs/job%2Fone', {
      signal: expect.any(AbortSignal),
    });
    expect(progress.mock.calls.map(([job]) => job.pages_done)).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toEqual(success);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.request).toHaveBeenCalledTimes(3);
    expect(progress.mock.calls.map(([job]) => job.status)).toEqual([
      'Running',
      'Running',
      'Success',
    ]);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('supports KIE PDF references and keeps the original zero-based retry index', async () => {
    mocks.request.mockResolvedValueOnce(success);
    await runImageParseJob({
      ...input,
      queryClient,
      task: 'kie',
      fields: [' 发票号码 ', '金额'],
      pageIndex: 9,
      signal: new AbortController().signal,
    });
    expect(JSON.parse(mocks.request.mock.calls[0]![1].body)).toEqual({
      model: 'minicpm-ocr-aio',
      task: 'kie',
      file_id: 'file-original',
      fields: ['发票号码', '金额'],
      page_index: 9,
      upright: false,
      recognize_seal: true,
    });
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it('waits for a task ID and DELETEs it when cancelled during create', async () => {
    let created!: (job: typeof running) => void;
    mocks.request
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            created = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const controller = new AbortController();
    const promise = runImageParseJob({ ...input, queryClient, signal: controller.signal });
    const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    created(running);
    await rejected;
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request).toHaveBeenLastCalledWith('/image-parse/jobs/job%2Fone', {
      method: 'DELETE',
    });
  });

  it('aborts the active GET and DELETEs without reusing an aborted signal', async () => {
    let getSignal: AbortSignal | undefined;
    mocks.request
      .mockResolvedValueOnce(running)
      .mockImplementationOnce((_path, init) => {
        getSignal = init.signal;
        return new Promise(() => {});
      })
      .mockResolvedValueOnce(undefined);
    const controller = new AbortController();
    const progress = vi.fn();
    const promise = runImageParseJob({
      ...input,
      queryClient,
      signal: controller.signal,
      onProgress: progress,
    });
    const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(getSignal?.aborted).toBe(false);
    controller.abort();
    await rejected;
    expect(getSignal?.aborted).toBe(true);
    expect(mocks.request).toHaveBeenLastCalledWith('/image-parse/jobs/job%2Fone', {
      method: 'DELETE',
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(progress).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledTimes(3);
  });

  it('preserves timeout reasons and tolerates a failed cancellation request', async () => {
    mocks.request.mockResolvedValueOnce(running).mockRejectedValueOnce(new Error('offline'));
    const controller = new AbortController();
    const promise = runImageParseJob({ ...input, queryClient, signal: controller.signal });
    const rejected = expect(promise).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new DOMException('Timeout', 'TimeoutError'));
    await rejected;
    expect(mocks.request.mock.calls[1]![1].method).toBe('DELETE');
  });

  it.each([
    ['Failed', 'imageParseModerated', 'imageParseModerated'],
    ['Failed', { message: 'private upstream URL' }, 'imageParseRequestFailed'],
    ['Cancelled', undefined, 'imageParseStopped'],
  ])('stops on %s and exposes stable errors only', async (status, error, message) => {
    const progress = vi.fn();
    mocks.request.mockResolvedValueOnce({ ...running, status, error });
    await expect(
      runImageParseJob({
        ...input,
        queryClient,
        signal: new AbortController().signal,
        onProgress: progress,
      }),
    ).rejects.toThrow(message);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledOnce();
  });

  it('cancels a still-running job if polling fails', async () => {
    mocks.request
      .mockResolvedValueOnce(running)
      .mockRejectedValueOnce(new BizError(50002, 'private upstream URL'))
      .mockResolvedValueOnce(undefined);
    const promise = runImageParseJob({
      ...input,
      queryClient,
      signal: new AbortController().signal,
    });
    const rejected = expect(promise).rejects.toThrow('imageParseRequestFailed');
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(mocks.request).toHaveBeenLastCalledWith('/image-parse/jobs/job%2Fone', {
      method: 'DELETE',
    });
  });

  it.each([
    { model: '' },
    { fileId: '' },
    { pageIndex: -1 },
    { pageIndex: 0.5 },
    { task: 'kie' as const, fields: ['重复', '重复'] },
  ])('rejects invalid inputs before creating a job: %j', async (invalid) => {
    await expect(
      runImageParseJob({
        ...input,
        ...invalid,
        queryClient,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/^imageParse/);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('does not create a job for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runImageParseJob({
        ...input,
        queryClient,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('accepts MAP ocr_uuid IDs without imposing a hex format', async () => {
    mocks.request
      .mockResolvedValueOnce({ ...running, id: 'ocr_1234-abcd' })
      .mockResolvedValueOnce({ ...success, id: 'ocr_1234-abcd' });
    const promise = runImageParseJob({
      ...input,
      queryClient,
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toMatchObject({ id: 'ocr_1234-abcd' });
    expect(mocks.request).toHaveBeenLastCalledWith('/image-parse/jobs/ocr_1234-abcd', {
      signal: expect.any(AbortSignal),
    });
  });

  it('rejects malformed job responses instead of polling indefinitely', async () => {
    mocks.request
      .mockResolvedValueOnce({ ...running, status: 'Unknown' })
      .mockResolvedValueOnce(undefined);
    await expect(
      runImageParseJob({
        ...input,
        queryClient,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('imageParseInvalidResult');
  });
});
