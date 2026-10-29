import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@map/store';
import type { Config, Driver, DriverHook } from 'driver.js';

const driverMock = vi.hoisted(() => {
  const drive = vi.fn();
  const destroy = vi.fn();
  const moveNext = vi.fn();
  const configs: Config[] = [];
  const instances: Driver[] = [];
  return { drive, destroy, moveNext, configs, instances };
});

vi.mock('driver.js', () => ({
  driver: (config: Config) => {
    driverMock.configs.push(config);
    let active = false;
    let index = 0;
    const instance = {
      drive: (startIndex = 0) => {
        active = true;
        index = startIndex;
        driverMock.drive();
      },
      destroy: () => {
        if (!active) return;
        active = false;
        driverMock.destroy();
        config.onDestroyed?.(undefined, {}, { config, state: {}, driver: instance, index });
      },
      isActive: () => active,
      getConfig: () => config,
      getActiveIndex: () => index,
      setConfig: (next: Config) => {
        Object.assign(config, next);
      },
      moveNext: () => {
        index++;
        driverMock.moveNext();
      },
      movePrevious: () => {
        index--;
      },
    } as Driver;
    driverMock.instances.push(instance);
    return instance;
  },
}));

vi.mock('driver.js/dist/driver.css', () => ({}));
vi.mock('../../utils/imageParseTourStyles.css', () => ({}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { IMAGE_PARSE_TOUR_ID, useImageParseTour } from '../useImageParseTour';

const USER_ID = 'tour-user';
const SEEN_TOUR_ID = JSON.stringify([IMAGE_PARSE_TOUR_ID, USER_ID]);

function useTour(options: Partial<Parameters<typeof useImageParseTour>[0]> = {}) {
  return useImageParseTour({
    userId: USER_ID,
    enabled: true,
    ...options,
  });
}

function tourContext(index = driverMock.instances.length - 1): Parameters<DriverHook>[2] {
  return {
    config: driverMock.configs[index],
    state: {},
    driver: driverMock.instances[index],
    index: driverMock.instances[index].getActiveIndex(),
  };
}

function closeTour(index = driverMock.instances.length - 1) {
  const config = driverMock.configs[index];
  (config.onDestroyStarted ?? config.onDestroyed)?.(undefined, {}, tourContext(index));
}

function setSeenTours(seenTours: string[]) {
  useAppStore.setState({
    playground: { ...useAppStore.getState().playground, seenTours },
  });
}

describe('文档解析新手引导', () => {
  beforeEach(() => {
    driverMock.drive.mockClear();
    driverMock.destroy.mockClear();
    driverMock.moveNext.mockClear();
    driverMock.configs.length = 0;
    driverMock.instances.length = 0;
    setSeenTours([]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('首次访问自动显示五步引导', async () => {
    renderHook(() => useTour());

    await waitFor(() => expect(driverMock.drive).toHaveBeenCalledTimes(1));
    expect(IMAGE_PARSE_TOUR_ID).toBe('image-parse');
    expect(driverMock.configs[0]).toMatchObject({ stagePadding: 4, stageRadius: 6 });
    const steps = driverMock.configs[0].steps!;
    expect(steps).toHaveLength(5);
    expect(steps.map((step) => step.element).filter(Boolean)).toEqual([
      '[data-tour="image-parse-examples"]',
      '[data-tour="image-parse-recognition-settings"]',
      '[data-tour="image-parse-confidence-toggle"]',
      '[data-edit-block]',
      '[data-pane="markdown"]',
    ]);
  });

  it('同一用户看过历史版本后，引导版本升级不再次自动弹出', () => {
    vi.useFakeTimers();
    setSeenTours([JSON.stringify(['image-parse:v5', USER_ID])]);
    renderHook(() => useTour());

    act(() => vi.advanceTimersByTime(500));
    expect(driverMock.drive).not.toHaveBeenCalled();
  });

  it('第一步选择平台示例，示例就绪后自动进入下一步', async () => {
    const { rerender } = renderHook(({ hasDocument }) => useTour({ hasDocument }), {
      initialProps: { hasDocument: false },
    });

    await waitFor(() => expect(driverMock.drive).toHaveBeenCalledOnce());
    const step = driverMock.configs[0].steps![0];
    expect(step.element).toBe('[data-tour="image-parse-examples"]');
    expect(driverMock.moveNext).not.toHaveBeenCalled();

    rerender({ hasDocument: true });
    await waitFor(() => expect(driverMock.moveNext).toHaveBeenCalledOnce());
    expect(driverMock.instances[0].getActiveIndex()).toBe(1);
  });

  it('已有文档时跳过平台示例，直接从识别设置开始', async () => {
    renderHook(() => useTour({ hasDocument: true }));

    await waitFor(() => expect(driverMock.drive).toHaveBeenCalledOnce());
    const steps = driverMock.configs[0].steps!;
    expect(steps).toHaveLength(4);
    expect(steps[0]?.element).toBe('[data-tour="image-parse-recognition-settings"]');
  });

  it('设置步骤拉远说明卡并临时隐藏遮罩，普通步骤恢复默认', async () => {
    renderHook(() => useTour({ hasDocument: true }));
    await waitFor(() => expect(driverMock.drive).toHaveBeenCalledOnce());
    const config = driverMock.configs[0];
    const settingsTrigger = document.createElement('button');
    settingsTrigger.dataset.tour = 'image-parse-recognition-settings';
    const regularTarget = document.createElement('div');
    document.body.append(settingsTrigger, regularTarget);

    act(() => {
      config.onHighlightStarted?.(settingsTrigger, config.steps?.[0] ?? {}, tourContext());
    });
    expect(document.body).toHaveClass('map-tour-settings-showcase');
    expect(driverMock.instances[0].getConfig().popoverOffset).toBe(200);
    expect(driverMock.configs[0].steps).toHaveLength(4);

    act(() => {
      config.onHighlightStarted?.(regularTarget, config.steps?.[2] ?? {}, tourContext());
    });
    expect(document.body).not.toHaveClass('map-tour-settings-showcase');
    expect(driverMock.instances[0].getConfig().popoverOffset).toBe(10);
    expect(driverMock.configs[0].steps).toHaveLength(4);

    settingsTrigger.remove();
    regularTarget.remove();
  });

  it('案例上传和慢速识别期间移除遮罩，结果就绪后从原引导第二步继续', () => {
    vi.useFakeTimers();
    const { rerender } = renderHook((options) => useTour(options), {
      initialProps: { ready: true, hasDocument: false, resultReady: false },
    });
    act(() => vi.advanceTimersByTime(400));
    rerender({ ready: false, hasDocument: false, resultReady: false });
    expect(driverMock.instances[0].isActive()).toBe(false);
    expect(useAppStore.getState().playground.seenTours).not.toContain(SEEN_TOUR_ID);
    rerender({ ready: false, hasDocument: true, resultReady: false });
    act(() => vi.advanceTimersByTime(60_000));
    expect(driverMock.moveNext).not.toHaveBeenCalled();
    expect(driverMock.drive).toHaveBeenCalledOnce();
    rerender({ ready: true, hasDocument: true, resultReady: true });
    expect(driverMock.instances[0].isActive()).toBe(true);
    expect(driverMock.instances[0].getActiveIndex()).toBe(1);
    expect(driverMock.configs[0].steps).toHaveLength(5);
    expect(driverMock.drive).toHaveBeenCalledTimes(2);
  });

  it('已有原件但尚无识别结果时，不启动指向缺失目标的引导', () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(
      ({ resultReady }) => useTour({ hasDocument: true, resultReady }),
      {
        initialProps: { resultReady: false },
      },
    );
    act(() => vi.advanceTimersByTime(500));
    expect(driverMock.drive).not.toHaveBeenCalled();
    rerender({ resultReady: true });
    act(() => vi.advanceTimersByTime(400));
    expect(driverMock.drive).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    '识别失败或取消后无结果时清理等待，不再次自动弹出（原件 %s）',
    (hasDocument) => {
      vi.useFakeTimers();
      const { rerender, result } = renderHook((options) => useTour(options), {
        initialProps: { ready: true, hasDocument: false, resultReady: false, failed: false },
      });
      act(() => vi.advanceTimersByTime(400));
      rerender({ ready: false, hasDocument: true, resultReady: false, failed: false });
      rerender({ ready: true, hasDocument, resultReady: false, failed: true });
      act(() => vi.advanceTimersByTime(60_000));
      expect(driverMock.instances[0].isActive()).toBe(false);
      expect(driverMock.drive).toHaveBeenCalledOnce();
      rerender({ ready: true, hasDocument: true, resultReady: true, failed: false });
      act(() => vi.advanceTimersByTime(500));
      expect(driverMock.drive).toHaveBeenCalledOnce();
      act(() => result.current.replay());
      expect(driverMock.drive).toHaveBeenCalledTimes(2);
    },
  );

  it('用户关闭引导后，后续识别完成不会恢复引导', () => {
    vi.useFakeTimers();
    const { rerender } = renderHook((options) => useTour(options), {
      initialProps: { ready: true, hasDocument: false, resultReady: false },
    });
    act(() => vi.advanceTimersByTime(400));
    act(() => closeTour());
    rerender({ ready: false, hasDocument: true, resultReady: false });
    rerender({ ready: true, hasDocument: true, resultReady: true });
    act(() => vi.advanceTimersByTime(500));
    expect(driverMock.drive).toHaveBeenCalledOnce();
    expect(driverMock.instances[0].isActive()).toBe(false);
  });

  it('等待识别期间离开页面，旧任务完成也不会恢复遮罩', () => {
    vi.useFakeTimers();
    const { rerender } = renderHook((options) => useTour(options), {
      initialProps: { enabled: true, ready: true, hasDocument: false, resultReady: false },
    });
    act(() => vi.advanceTimersByTime(400));
    rerender({ enabled: true, ready: false, hasDocument: true, resultReady: false });
    rerender({ enabled: false, ready: true, hasDocument: true, resultReady: true });
    act(() => vi.advanceTimersByTime(500));
    expect(driverMock.instances[0].isActive()).toBe(false);
    expect(driverMock.drive).toHaveBeenCalledOnce();
    expect(useAppStore.getState().playground.seenTours).not.toContain(SEEN_TOUR_ID);
  });

  it('看过之后不再弹出，手动重播忽略已读记录', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useTour({ enabled }), {
      initialProps: { enabled: false },
    });
    expect(driverMock.drive).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(driverMock.drive).toHaveBeenCalledTimes(1));

    act(() => setSeenTours([SEEN_TOUR_ID]));
    rerender({ enabled: false });
    rerender({ enabled: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(driverMock.drive).toHaveBeenCalledTimes(1);

    act(() => result.current.replay());
    expect(driverMock.drive).toHaveBeenCalledTimes(2);
  });

  it('关闭后写入已看记录，切换账号不会串用已读状态', async () => {
    const { rerender } = renderHook(({ userId }) => useTour({ userId }), {
      initialProps: { userId: USER_ID },
    });

    await waitFor(() => expect(driverMock.drive).toHaveBeenCalledOnce());
    act(() => closeTour());
    expect(useAppStore.getState().playground.seenTours).toContain(SEEN_TOUR_ID);

    rerender({ userId: 'new-user' });
    await waitFor(() => expect(driverMock.drive).toHaveBeenCalledTimes(2));
    expect(useAppStore.getState().playground.seenTours).not.toContain(
      JSON.stringify([IMAGE_PARSE_TOUR_ID, 'new-user']),
    );
  });

  it('离开页面或停用引导不误记为已读，重新进入仍自动显示', async () => {
    vi.useFakeTimers();
    const { rerender, unmount } = renderHook(({ enabled }) => useTour({ enabled }), {
      initialProps: { enabled: true },
    });
    act(() => vi.advanceTimersByTime(400));
    rerender({ enabled: false });
    expect(useAppStore.getState().playground.seenTours).not.toContain(SEEN_TOUR_ID);
    rerender({ enabled: true });
    act(() => vi.advanceTimersByTime(400));
    expect(driverMock.drive).toHaveBeenCalledTimes(2);
    unmount();
    expect(useAppStore.getState().playground.seenTours).not.toContain(SEEN_TOUR_ID);
  });

  it('首次访问等用户和页面就绪才启动，清缓存后也不依赖已有记录', () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(({ userId, ready }) => useTour({ userId, ready }), {
      initialProps: { userId: undefined as string | undefined, ready: false },
    });
    act(() => vi.advanceTimersByTime(500));
    expect(driverMock.drive).not.toHaveBeenCalled();
    rerender({ userId: USER_ID, ready: false });
    act(() => vi.advanceTimersByTime(500));
    expect(driverMock.drive).not.toHaveBeenCalled();
    rerender({ userId: USER_ID, ready: true });
    act(() => vi.advanceTimersByTime(400));
    expect(driverMock.drive).toHaveBeenCalledOnce();
  });

  it('页面加载期间请求手动重播，待就绪后仅启动一次', () => {
    vi.useFakeTimers();
    setSeenTours([SEEN_TOUR_ID]);
    const { result, rerender } = renderHook(({ ready }) => useTour({ ready }), {
      initialProps: { ready: false },
    });
    act(() => {
      result.current.replay();
      result.current.replay();
      vi.advanceTimersByTime(500);
    });
    expect(driverMock.drive).not.toHaveBeenCalled();
    rerender({ ready: true });
    act(() => vi.advanceTimersByTime(500));
    expect(driverMock.drive).toHaveBeenCalledOnce();
  });

  it('存储被禁用时关闭仍正常，本次会话不反复弹出', () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(({ enabled }) => useTour({ enabled }), {
      initialProps: { enabled: true },
    });
    act(() => vi.advanceTimersByTime(400));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });
    expect(() => act(() => closeTour())).not.toThrow();
    expect(driverMock.instances[0].isActive()).toBe(false);
    rerender({ enabled: false });
    rerender({ enabled: true });
    act(() => vi.advanceTimersByTime(500));
    expect(driverMock.drive).toHaveBeenCalledOnce();
  });

  it('损坏的已读缓存不阻断首访，React StrictMode 下不会重复启动', () => {
    vi.useFakeTimers();
    useAppStore.setState({
      playground: { ...useAppStore.getState().playground, seenTours: null as unknown as string[] },
    });
    renderHook(() => useTour(), { wrapper: StrictMode });
    act(() => vi.advanceTimersByTime(400));
    expect(driverMock.drive).toHaveBeenCalledOnce();
    act(() => closeTour());
    expect(useAppStore.getState().playground.seenTours).toContain(SEEN_TOUR_ID);
  });
});
