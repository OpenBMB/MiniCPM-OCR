import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamTextQueue } from '../streamTextQueue';

describe('createStreamTextQueue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('按小段逐步释放内容，并在完成时等待队列排空', () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const drained = vi.fn();
    const queue = createStreamTextQueue((_kind, delta) => emitted.push(delta));

    queue.enqueue('content', '你好');
    expect(emitted).toEqual([]);
    expect(drained).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);
    expect(emitted).toEqual(['你']);
    expect(drained).not.toHaveBeenCalled();

    queue.finish(drained);
    expect(emitted).toEqual(['你', '好']);
    expect(drained).toHaveBeenCalledOnce();
  });

  it('取消时清空未展示内容，避免错误收尾后继续刷旧内容', () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const queue = createStreamTextQueue((_kind, delta) => emitted.push(delta));

    queue.enqueue('content', '待撤回内容');
    queue.cancel();
    vi.advanceTimersByTime(1000);

    expect(emitted).toEqual([]);
  });

  it('正常收尾时立即合并剩余尾部并触发完成回调', () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const drained = vi.fn();
    const queue = createStreamTextQueue((_kind, delta) => emitted.push(delta));

    queue.enqueue('content', 'a'.repeat(20_000));
    queue.finish(drained);

    expect(emitted).toEqual(['a'.repeat(20_000)]);
    expect(drained).toHaveBeenCalledOnce();
    vi.runOnlyPendingTimers();
    expect(drained).toHaveBeenCalledOnce();
  });
});
