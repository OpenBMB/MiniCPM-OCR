import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@map/store';
import type { Config, Driver } from 'driver.js';

const driverMock = vi.hoisted(() => {
  const drive = vi.fn();
  const destroy = vi.fn();
  const configs: Config[] = [];
  const instances: Driver[] = [];
  return { drive, destroy, configs, instances };
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
      setConfig: (next: Config) => Object.assign(config, next),
      moveNext: () => {
        index++;
      },
    } as unknown as Driver;
    driverMock.instances.push(instance);
    return instance;
  },
}));

vi.mock('driver.js/dist/driver.css', () => ({}));
vi.mock('../../utils/imageParseTourStyles.css', () => ({}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { IMAGE_PARSE_KIE_TOUR_ID, useImageParseKieTour } from '../useImageParseKieTour';

const USER_ID = 'kie-tour-user';

function useTour(options: Partial<Parameters<typeof useImageParseKieTour>[0]> = {}) {
  return useImageParseKieTour({
    userId: USER_ID,
    enabled: true,
    ...options,
  });
}

describe('关键信息抽取新手引导', () => {
  beforeEach(() => {
    driverMock.drive.mockClear();
    driverMock.destroy.mockClear();
    driverMock.configs.length = 0;
    driverMock.instances.length = 0;
    useAppStore.setState({
      playground: { ...useAppStore.getState().playground, seenTours: [] },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('首次访问自动显示四步引导，并使用独立已读标识', async () => {
    renderHook(() => useTour());

    await waitFor(() => expect(driverMock.drive).toHaveBeenCalledOnce());
    expect(IMAGE_PARSE_KIE_TOUR_ID).toBe('image-parse-kie');
    const steps = driverMock.configs[0].steps!;
    expect(steps).toHaveLength(4);
    expect(steps.map((step) => step.element)).toEqual([
      '[data-tour="image-parse-kie-examples"]',
      '[data-tour="image-parse-kie-fields"]',
      '[data-tour="image-parse-kie-start"]',
      '[data-pane="markdown"]',
    ]);
  });

  it('示例上传后进入字段配置，抽取完成后进入结果核对', async () => {
    vi.useFakeTimers();
    const { rerender } = renderHook((options: Parameters<typeof useTour>[0]) => useTour(options), {
      initialProps: { ready: true, hasDocument: false, resultReady: false },
    });
    act(() => vi.advanceTimersByTime(400));
    expect(driverMock.instances[0].isActive()).toBe(true);

    rerender({ ready: false, hasDocument: true, resultReady: false });
    expect(driverMock.instances[0].isActive()).toBe(false);
    rerender({ ready: true, hasDocument: true, resultReady: true });
    expect(driverMock.instances[0].isActive()).toBe(true);
    expect(driverMock.instances[0].getActiveIndex()).toBe(1);

    // Simulate the user reading the field description and clicking "Next", staying on the start-extraction step.
    act(() => driverMock.instances[0].moveNext());
    rerender({ ready: false, hasDocument: true, resultReady: false });
    expect(driverMock.instances[0].isActive()).toBe(false);
    rerender({ ready: true, hasDocument: true, resultReady: true });
    expect(driverMock.instances[0].isActive()).toBe(true);
    expect(driverMock.instances[0].getActiveIndex()).toBe(3);
  });

  it('已有结果时只启动结果核对步骤，重播仍可用', async () => {
    const { result } = renderHook(() =>
      useTour({ hasDocument: true, hasResult: true, resultReady: true }),
    );

    await waitFor(() => expect(driverMock.drive).toHaveBeenCalledOnce());
    expect(driverMock.configs[0].steps).toHaveLength(1);
    act(() => result.current.replay());
    expect(driverMock.drive).toHaveBeenCalledTimes(2);
  });
});
