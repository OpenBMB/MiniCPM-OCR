import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { setApplicationLocale } from '@/i18n';
import { useCaptchaGate } from '../useCaptchaGate';

// mock 认证 API，隔离网络
const publicConfig = vi.fn();
const getCaptcha = vi.fn();
const verifyCaptcha = vi.fn();
vi.mock('@/api/map', () => ({
  mapAuthApi: {
    publicConfig: () => publicConfig(),
    getCaptcha: () => getCaptcha(),
    verifyCaptcha: (p: unknown) => verifyCaptcha(p),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(async () => {
  await setApplicationLocale('zh-CN');
  publicConfig.mockReset();
  getCaptcha.mockReset();
  verifyCaptcha.mockReset();
});

describe('useCaptchaGate', () => {
  it('开关关闭时直接执行动作（captchaId 为空），不弹窗', async () => {
    publicConfig.mockResolvedValue({ feilian_enabled: false, captcha_enabled: false });
    const { result } = renderHook(() => useCaptchaGate(), { wrapper });
    await waitFor(() => expect(result.current.enabled).toBe(false));

    const action = vi.fn().mockResolvedValue('done');
    let ret: unknown;
    await act(async () => {
      ret = await result.current.runWithCaptcha(action);
    });

    expect(action).toHaveBeenCalledWith('');
    expect(ret).toBe('done');
    expect(result.current.dialogProps.open).toBe(false);
    expect(getCaptcha).not.toHaveBeenCalled();
  });

  it('开关开启时弹出滑块并取题，未验证前不执行动作', async () => {
    publicConfig.mockResolvedValue({ feilian_enabled: false, captcha_enabled: true });
    getCaptcha.mockResolvedValue({
      id: 'c1',
      master_b64: 'm',
      tile_b64: 't',
      tile_x: 1,
      tile_y: 2,
      tile_width: 60,
      tile_height: 60,
    });
    const { result } = renderHook(() => useCaptchaGate(), { wrapper });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    const action = vi.fn().mockResolvedValue('done');
    act(() => {
      void result.current.runWithCaptcha(action);
    });

    // 弹窗打开、取题被调用，但动作在验证通过前不执行
    await waitFor(() => expect(result.current.dialogProps.open).toBe(true));
    await waitFor(() => expect(getCaptcha).toHaveBeenCalledTimes(1));
    expect(action).not.toHaveBeenCalled();
  });

  it('取题失败时保留弹窗并展示可重试错误', async () => {
    publicConfig.mockResolvedValue({ feilian_enabled: false, captcha_enabled: true });
    getCaptcha.mockRejectedValueOnce(new Error('network unavailable'));
    const { result } = renderHook(() => useCaptchaGate(), { wrapper });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    const action = vi.fn().mockResolvedValue('done');
    act(() => {
      void result.current.runWithCaptcha(action);
    });

    await waitFor(() => expect(result.current.dialogProps.open).toBe(true));
    await waitFor(() => expect(result.current.dialogProps.error).toBe('验证码加载失败，请重试'));
    expect(result.current.dialogProps.loading).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it('验证通过后用一次性凭证执行动作并关闭弹窗', async () => {
    publicConfig.mockResolvedValue({ feilian_enabled: false, captcha_enabled: true });
    getCaptcha.mockResolvedValue({
      id: 'c1',
      master_b64: 'm',
      tile_b64: 't',
      tile_x: 1,
      tile_y: 2,
      tile_width: 60,
      tile_height: 60,
    });
    verifyCaptcha.mockResolvedValue({ id: 'c1', passed: true });
    const { result } = renderHook(() => useCaptchaGate(), { wrapper });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    const action = vi.fn().mockResolvedValue('ok');
    let pending: Promise<unknown>;
    act(() => {
      pending = result.current.runWithCaptcha(action);
    });
    await waitFor(() => expect(result.current.dialogProps.open).toBe(true));

    // 模拟用户拖动释放
    await act(async () => {
      result.current.dialogProps.onConfirm({ x: 100, y: 2 }, () => {});
      await pending;
    });

    expect(verifyCaptcha).toHaveBeenCalledWith({ id: 'c1', x: 100, y: 2 });
    expect(action).toHaveBeenCalledWith('c1');
    expect(result.current.dialogProps.open).toBe(false);
  });
});
