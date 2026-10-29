import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LayoutMode = 'sidebar' | 'top' | 'mixed';

/** MAP 支持的界面语言。 */
export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;

/** MAP 支持的界面语言类型。 */
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * 体验中心对话参数（按模型分别持久化）。
 * 字段与 portal 的 PlaygroundParams 对齐；放在 store 以便按 modelId 记忆。
 */
export interface PlaygroundParamValues {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** 用户显式选择的 v4.7 图片压缩比例；未设置时不发送。 */
  imageDownsampleMode?: '4x' | '16x';
  thinkingDepth?: 'off' | 'on';
  thinkingStyle?: 'reasoning_effort' | 'thinking' | 'both';
  stream?: boolean;
  /** 是否开启联网搜索（走 L3 Playground BFF） */
  webSearch?: boolean;
  /** 联网模式下启用的工具名称列表 */
  enabledTools?: string[];
  /** 用户手动设置的当前位置（用于 datetime 工具） */
  userLocation?: string;
}

/** 体验中心（Playground）UI 偏好——非敏感项，可持久化（绝不含 API Key 明文） */
export interface PlaygroundPrefs {
  /** 上次选中的模型 id */
  lastModelId: string;
  /** 上次选中的语音合成模型 id（与语言对话各自记忆） */
  lastTtsModelId: string;
  /** 上次选中的实时对话模型 id（与语言对话各自记忆） */
  lastRealtimeModelId: string;
  /** 上次选中的图像解析模型 id（与语言对话各自记忆） */
  lastImageParseModelId: string;
  /** 上次选中的 API Key id */
  lastKeyId: string;
  /** 思考深度档位：off | on */
  thinkingDepth: 'off' | 'on';
  /** 左侧栏是否收起 */
  sidebarCollapsed: boolean;
  /** 各模型独立的对话参数（key=modelId），切换模型时各自记忆 */
  paramsByModel: Record<string, PlaygroundParamValues>;
  /** 已看过的界面引导 id（含版本号），避免同一引导反复弹出 */
  seenTours: string[];
  /** 文档解析：结果里屏蔽页眉 / 页脚 / 页码 */
  imageParseHideHeaderFooter: boolean;
  /** 文档解析：版面框上显示阅读顺序序号（排查是版面问题还是识别问题） */
  imageParseShowOrder: boolean;
}

interface AppState {
  sidebarCollapsed: boolean;
  theme: 'light' | 'dark' | 'system';
  locale: AppLocale;
  layoutMode: LayoutMode;
  /** 体验中心 UI 偏好 */
  playground: PlaygroundPrefs;

  toggleSidebar: () => void;
  setTheme: (theme: AppState['theme']) => void;
  setLocale: (locale: AppState['locale']) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  /** 增量更新体验中心偏好 */
  setPlaygroundPrefs: (patch: Partial<PlaygroundPrefs>) => void;
  /** 设置某模型的对话参数（增量合并，按 modelId 持久化） */
  setModelParams: (modelId: string, patch: Partial<PlaygroundParamValues>) => void;
  /** 删除某模型的全部用户参数覆盖，恢复模型配置或空值。 */
  clearModelParams: (modelId: string) => void;
}

const DEFAULT_PLAYGROUND_PREFS: PlaygroundPrefs = {
  lastModelId: '',
  lastTtsModelId: '',
  lastRealtimeModelId: '',
  lastImageParseModelId: '',
  lastKeyId: '',
  thinkingDepth: 'off',
  sidebarCollapsed: false,
  paramsByModel: {},
  seenTours: [],
  imageParseHideHeaderFooter: false,
  imageParseShowOrder: false,
};

const APP_STORE_VERSION = 1;

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      theme: 'light',
      locale: 'zh-CN',
      layoutMode: 'sidebar',
      playground: DEFAULT_PLAYGROUND_PREFS,

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setLayoutMode: (mode) => set({ layoutMode: mode }),
      setPlaygroundPrefs: (patch) => set((s) => ({ playground: { ...s.playground, ...patch } })),
      setModelParams: (modelId, patch) =>
        set((s) => {
          const prev = s.playground.paramsByModel[modelId];
          const next = { ...prev, ...patch };
          return {
            playground: {
              ...s.playground,
              paramsByModel: { ...s.playground.paramsByModel, [modelId]: next },
            },
          };
        }),
      clearModelParams: (modelId) =>
        set((s) => {
          const paramsByModel = { ...s.playground.paramsByModel };
          delete paramsByModel[modelId];
          return {
            playground: {
              ...s.playground,
              paramsByModel,
            },
          };
        }),
    }),
    {
      name: 'map-app',
      version: APP_STORE_VERSION,
      migrate: (persistedState, version) =>
        version < APP_STORE_VERSION
          ? migrateLegacyPlaygroundParams(persistedState)
          : persistedState,
      // 兼容旧持久化结构：缺 playground 字段时补默认值
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const playground: Partial<PlaygroundPrefs> & Record<string, unknown> = {
          ...p.playground,
        };
        // 已移除的显示偏好不再恢复，避免旧浏览器状态重新启用置信度。
        delete playground.imageParseShowScore;
        return {
          ...current,
          ...p,
          // 仅接收受支持的持久化语言，避免历史异常值破坏界面初始化。
          locale: isAppLocale(p.locale) ? p.locale : current.locale,
          playground: { ...DEFAULT_PLAYGROUND_PREFS, ...playground },
        };
      },
    },
  ),
);

/**
 * 清理旧版 Playground 自动写入的默认值。
 * 旧版的 maxTokens=0 是“不下发”的哨兵值，因此可安全移除；其他数值缺少来源标记，
 * 仅在采样参数同时等于历史默认值时清理，避免覆盖能够识别出的用户自定义值。
 * @param persistedState Zustand 持久化的旧状态。
 * @returns 可由新版 store 合并的迁移后状态。
 */
export function migrateLegacyPlaygroundParams(persistedState: unknown): unknown {
  if (!isRecord(persistedState) || !isRecord(persistedState.playground)) return persistedState;
  const playground = persistedState.playground;
  if (!isRecord(playground.paramsByModel)) return persistedState;

  const paramsByModel = Object.fromEntries(
    Object.entries(playground.paramsByModel).map(([modelId, value]) => {
      if (!isRecord(value)) return [modelId, value];
      const next = { ...value };
      if (next.temperature === 0.7 && next.topP === 1) {
        delete next.temperature;
        delete next.topP;
      }
      if (next.maxTokens === 0) {
        delete next.maxTokens;
      }
      if (next.thinkingDepth === 'on' && next.thinkingStyle === 'both') {
        delete next.thinkingDepth;
        delete next.thinkingStyle;
      }
      return [modelId, next];
    }),
  );

  return {
    ...persistedState,
    playground: {
      ...playground,
      paramsByModel,
    },
  };
}

/**
 * 判断持久化值是否为 MAP 支持的界面语言。
 * @param value 待验证的持久化值。
 * @returns 值是否可作为 AppLocale 使用。
 */
function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as AppLocale);
}

/** 判断未知值是否为可安全展开的普通记录。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
