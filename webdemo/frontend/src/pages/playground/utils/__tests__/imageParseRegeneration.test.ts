import { describe, expect, it, vi } from 'vitest';

import { IMAGE_PARSE_SAMPLE_BLOCKS } from './imageParseSampleFixtures';
import { optimizeImageParseBlock, imageParseTextDifference } from '../imageParseRegeneration';

const original = { ...IMAGE_PARSE_SAMPLE_BLOCKS[2], confidence: 0.4 };

describe('块级重生成择优边界', () => {
  it('服务端已经完成五轮且仍低于复核阈值时只请求一次', async () => {
    const generate = vi.fn(async () => ({
      markdown: '服务端最优',
      text: '裸文本',
      confidence: 0.7,
      roundsUsed: 5,
      priorScore: 0.4,
      stopReason: 'exhausted',
      exhausted: true,
    }));
    const result = await optimizeImageParseBlock(original, generate, new AbortController().signal);
    expect(generate).toHaveBeenCalledOnce();
    expect(result.rounds).toBe(5);
    expect(result.best.text).toBe('裸文本');
    expect(result.optimization).toMatchObject({ priorScore: 0.4, exhausted: true });
  });

  it('再次优化低于当前最佳但不低于首次结果时保留当前最佳', async () => {
    const best = { ...original, markdown: '已采纳', confidence: 0.9 };
    const generate = vi.fn(async () => ({ markdown: '候选', confidence: 0.7, roundsUsed: 2 }));
    const result = await optimizeImageParseBlock(
      original,
      generate,
      new AbortController().signal,
      best,
    );
    expect(generate).toHaveBeenCalledOnce();
    expect(result.best).toBe(best);
    expect(result.improved).toBe(false);
  });

  it('最多五轮，保留最高真实分数，不采纳退化或相同分数', async () => {
    const scores = [0.3, 0.6, 0.5, 0.6, 0.7];
    const generate = vi.fn(async () => ({
      markdown: `结果 ${scores.length}`,
      confidence: scores.shift()!,
    }));
    const result = await optimizeImageParseBlock(original, generate, new AbortController().signal);
    expect(generate).toHaveBeenCalledTimes(5);
    expect(result.best.confidence).toBe(0.7);
    expect(result.original).toEqual(original);
    expect(result.improved).toBe(true);
  });

  it('达到 0.8 停止，严格低于阈值才继续', async () => {
    const generate = vi.fn(async () => ({ markdown: '新结果', confidence: 0.8 }));
    const result = await optimizeImageParseBlock(original, generate, new AbortController().signal);
    expect(generate).toHaveBeenCalledOnce();
    expect(result.rounds).toBe(1);
  });

  it('没有提升保留原结果，未知或非法分数不接受', async () => {
    const generate = vi.fn(async () => ({ markdown: '退化', confidence: 0.2 }));
    expect(
      (await optimizeImageParseBlock(original, generate, new AbortController().signal)).best,
    ).toEqual(original);
    await expect(
      optimizeImageParseBlock(
        original,
        async () => ({ markdown: '无分数', confidence: Number.NaN }),
        new AbortController().signal,
      ),
    ).rejects.toThrow('imageParseInvalidResult');
  });

  it('取消后不启动后续轮次', async () => {
    const controller = new AbortController();
    const generate = vi.fn(async () => {
      controller.abort();
      return { markdown: '取消返回', confidence: 0.7 };
    });
    await expect(optimizeImageParseBlock(original, generate, controller.signal)).rejects.toThrow();
    expect(generate).toHaveBeenCalledOnce();
  });

  it('后续轮次失败仍保留已获得的更优候选', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ markdown: '已提升', confidence: 0.7 })
      .mockRejectedValueOnce(new Error('network failure'));
    const result = await optimizeImageParseBlock(original, generate, new AbortController().signal);
    expect(result.best.markdown).toBe('已提升');
    expect(result.error).toBe('imageParseRegenerateFailed');
    expect(result.improved).toBe(true);
  });

  it.each([
    { markdown: '无效分数', confidence: Number.NaN },
    { markdown: '', confidence: 0.9 },
  ])('后续无效候选不丢弃已验证的提升：%j', async (candidate) => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ markdown: '已提升', confidence: 0.7 })
      .mockResolvedValueOnce(candidate);
    const result = await optimizeImageParseBlock(original, generate, new AbortController().signal);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.best.markdown).toBe('已提升');
    expect(result.best.confidence).toBe(0.7);
    expect(result.rounds).toBe(1);
    expect(result.error).toBe('imageParseInvalidResult');
    expect(result.improved).toBe(true);
  });
});

describe('双版本内容差异', () => {
  it('保留公共前后文，仅标记不同片段', () => {
    expect(imageParseTextDifference('金额 99 元', '金额 996 元')).toEqual({
      prefix: '金额 99',
      before: '',
      after: '6',
      suffix: ' 元',
    });
    expect(imageParseTextDifference('相同', '相同')).toEqual({
      prefix: '相同',
      before: '',
      after: '',
      suffix: '',
    });
  });
});
