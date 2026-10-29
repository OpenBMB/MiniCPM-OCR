import { describe, it, expect, beforeEach } from 'vitest';
import { migrateLegacyPlaygroundParams, useAppStore } from '../useAppStore';

beforeEach(() => {
  useAppStore.setState({
    sidebarCollapsed: false,
    theme: 'light',
    locale: 'zh-CN',
  });
});

describe('useAppStore', () => {
  it('初始状态应为 sidebar 展开、light 主题、英文', () => {
    const state = useAppStore.getInitialState();
    expect(state.sidebarCollapsed).toBe(false);
    expect(state.theme).toBe('light');
    expect(state.locale).toBe('en-US');
  });

  it('toggleSidebar 应切换折叠状态', () => {
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);

    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
  });

  it('setTheme 应更新主题', () => {
    useAppStore.getState().setTheme('dark');
    expect(useAppStore.getState().theme).toBe('dark');

    useAppStore.getState().setTheme('system');
    expect(useAppStore.getState().theme).toBe('system');
  });

  it('setLocale 应更新语言', () => {
    useAppStore.getState().setLocale('en-US');
    expect(useAppStore.getState().locale).toBe('en-US');
  });

  it('clearModelParams 应删除指定模型的全部参数覆盖', () => {
    useAppStore.getState().setModelParams('model-a', { temperature: 1.2, stream: false });
    useAppStore.getState().clearModelParams('model-a');

    expect(useAppStore.getState().playground.paramsByModel['model-a']).toBeUndefined();
  });

  it('旧存档里的中文默认语言迁移为英文', async () => {
    localStorage.setItem(
      'map-app',
      JSON.stringify({
        version: 1,
        state: { locale: 'zh-CN', theme: 'light' },
      }),
    );
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().locale).toBe('en-US');
  });

  it('恢复旧偏好时丢弃置信度开关，保留阅读顺序和主题', async () => {
    localStorage.setItem(
      'map-app',
      JSON.stringify({
        version: 1,
        state: {
          theme: 'dark',
          playground: { imageParseShowScore: true, imageParseShowOrder: true },
        },
      }),
    );
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().theme).toBe('dark');
    expect(useAppStore.getState().playground.imageParseShowOrder).toBe(true);
    expect(useAppStore.getState().playground).not.toHaveProperty('imageParseShowScore');
  });

  it('旧版自动填充的采样默认值应迁移为空，同时保留用户自定义值', () => {
    const migrated = migrateLegacyPlaygroundParams({
      playground: {
        paramsByModel: {
          legacy: {
            temperature: 0.7,
            topP: 1,
            maxTokens: 0,
            thinkingDepth: 'on',
            thinkingStyle: 'both',
            stream: false,
          },
          customized: {
            temperature: 0,
            topP: 1,
            maxTokens: 0,
            thinkingDepth: 'off',
            thinkingStyle: 'both',
          },
        },
      },
    }) as {
      playground: {
        paramsByModel: Record<string, Record<string, unknown>>;
      };
    };

    expect(migrated.playground.paramsByModel.legacy).toEqual({ stream: false });
    expect(migrated.playground.paramsByModel.customized).toEqual({
      temperature: 0,
      topP: 1,
      thinkingDepth: 'off',
      thinkingStyle: 'both',
    });
  });
});
