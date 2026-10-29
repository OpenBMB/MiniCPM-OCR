import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const voices = vi.hoisted(() => vi.fn());
const featureAccess = vi.hoisted(() => vi.fn());
const models = vi.hoisted(() => vi.fn());

vi.mock('./resources', () => ({
  mapResourcesApi: { voices, featureAccess, models },
}));

import { useFeatureAccessQuery, useModelsQuery, useVoicesQuery } from './queries';

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useVoicesQuery', () => {
  beforeEach(() => {
    voices.mockReset();
  });

  it('禁用时不请求当前用户私有音色', () => {
    const { result } = renderHook(() => useVoicesQuery(false), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(voices).not.toHaveBeenCalled();
  });

  it('启用时请求当前用户私有音色', async () => {
    voices.mockResolvedValue({ list: [] });

    const { result } = renderHook(() => useVoicesQuery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(voices).toHaveBeenCalledOnce();
  });
});

describe('useFeatureAccessQuery', () => {
  beforeEach(() => {
    featureAccess.mockReset();
  });

  it('读取当前用户的功能权限', async () => {
    featureAccess.mockResolvedValue({ voice_clone: false });

    const { result } = renderHook(() => useFeatureAccessQuery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data?.voice_clone).toBe(false));
    expect(featureAccess).toHaveBeenCalledOnce();
  });
});

describe('useModelsQuery', () => {
  beforeEach(() => {
    models.mockReset();
    focusManager.setFocused(true);
  });

  it('切回页面时刷新模型能力配置', async () => {
    models.mockResolvedValue({ list: [] });

    const { result } = renderHook(() => useModelsQuery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(models).toHaveBeenCalledOnce();

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => expect(models).toHaveBeenCalledTimes(2));
  });
});
