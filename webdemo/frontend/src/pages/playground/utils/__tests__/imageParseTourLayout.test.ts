import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackImageParseTourLayout } from '../imageParseTourLayout';

describe('文档解析引导动态定位', () => {
  let element: HTMLElement;
  let rect: DOMRect;
  let frame: FrameRequestCallback | undefined;
  let active: boolean;
  const refresh = vi.fn();
  const instance = {
    isActive: () => active,
    getActiveElement: () => element,
    refresh,
  };
  const tick = () => {
    const callback = frame!;
    frame = undefined;
    callback(0);
  };

  beforeEach(() => {
    element = document.createElement('div');
    document.body.append(element);
    rect = new DOMRect(100, 80, 160, 32);
    frame = undefined;
    active = true;
    refresh.mockClear();
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => rect);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      frame = undefined;
    });
  });
  afterEach(() => {
    element.remove();
    vi.restoreAllMocks();
  });

  it('初次刷新后布局不变时不重复刷新，位置和尺寸变化时才更新', () => {
    const stop = trackImageParseTourLayout(instance);
    expect(refresh).toHaveBeenCalledOnce();
    tick();
    tick();
    expect(refresh).toHaveBeenCalledOnce();
    rect = new DOMRect(60, 120, 160, 32);
    tick();
    expect(refresh).toHaveBeenCalledTimes(2);
    rect = new DOMRect(60, 120, 180, 44);
    tick();
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
  });

  it('关闭时取消检测帧，迟到的回调也不重新刷新或继续调度', () => {
    const stop = trackImageParseTourLayout(instance);
    const pending = frame!;
    stop();
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
    rect = new DOMRect(60, 120, 160, 32);
    pending(0);
    expect(refresh).toHaveBeenCalledOnce();
    expect(frame).toBeUndefined();
  });

  it.each(['closed', 'detached', 'next-step'])('%s 后停止检测旧目标', (reason) => {
    trackImageParseTourLayout(instance);
    if (reason === 'closed') active = false;
    if (reason === 'detached') element.remove();
    if (reason === 'next-step')
      vi.spyOn(instance, 'getActiveElement').mockReturnValue(document.createElement('div'));
    tick();
    expect(frame).toBeUndefined();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('居中的完成提示不需要持续检测占位元素', () => {
    element.id = 'driver-dummy-element';
    trackImageParseTourLayout(instance);
    expect(refresh).toHaveBeenCalledOnce();
    expect(frame).toBeUndefined();
  });
});
