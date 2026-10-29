import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getImageParseExample } from '../imageParseExamples';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../request', () => ({ mapRequest: mocks.request }));

const capture = {
  resultIndex: 1,
  sourcePage: 1,
  model: 'minicpm-ocr',
  capturedAt: '2026-10-14T02:35:16Z',
  inputSha256: 'a'.repeat(64),
  response: { choices: [{ message: { content: '数据库正文' } }] },
};

describe('共享 OCR 案例数据库 API', () => {
  beforeEach(() => {
    mocks.request.mockReset().mockResolvedValue({ type: 'physics', captures: [capture] });
  });

  it('按固定案例类型和原件版本读取，透传取消信号', async () => {
    const signal = new AbortController().signal;
    await expect(getImageParseExample('physics', 'page:1', signal)).resolves.toEqual({
      type: 'physics',
      captures: [capture],
    });
    expect(mocks.request).toHaveBeenCalledWith('/image-parse/examples/physics?version=page%3A1', {
      signal,
    });
  });

  it.each([
    { type: 'property', captures: [capture] },
    { type: 'physics', captures: [] },
    { type: 'physics' },
    ...[
      { response: { map_ocr_source: { token: 'test-token' } } },
      { inputSha256: 'invalid' },
      { model: 'another-model' },
      { model: 'minicpm-ocr-stp' },
      { resultIndex: 1.5 },
      { sourcePage: 0 },
      { capturedAt: 'invalid' },
    ].map((invalid) => ({ type: 'physics', captures: [{ ...capture, ...invalid }] })),
  ])('拒绝无效响应 %#，不伪造结果', async (value) => {
    mocks.request.mockResolvedValueOnce(value);
    await expect(getImageParseExample('physics', 'page:1')).rejects.toThrow(
      'imageParseExampleInvalid',
    );
  });

  it('数据库请求失败时向上传递错误，不回退为模拟结果', async () => {
    mocks.request.mockRejectedValueOnce(new Error('unavailable'));
    await expect(getImageParseExample('physics', 'page:1')).rejects.toThrow('unavailable');
    expect(mocks.request).toHaveBeenCalledOnce();
  });
});
