import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LayoutMode = 'sidebar' | 'top' | 'mixed';

/** UI languages supported by MAP. */
export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;

/** UI language type supported by MAP. */
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Playground chat parameters (persisted per model).
 * Fields match the portal PlaygroundParams; they live in the store so each modelId is remembered.
 */
export interface PlaygroundParamValues {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** v4.7 image compression ratio the user explicitly chose; omitted when unset. */
  imageDownsampleMode?: '4x' | '16x';
  thinkingDepth?: 'off' | 'on';
  thinkingStyle?: 'reasoning_effort' | 'thinking' | 'both';
  stream?: boolean;
  /** Whether web search is on (goes through the L3 Playground BFF). */
  webSearch?: boolean;
  /** Tool names enabled in web-search mode. */
  enabledTools?: string[];
  /** Location the user set manually (used by the datetime tool). */
  userLocation?: string;
}

/** Playground UI preferences — non-sensitive, safe to persist (never includes an API key in plaintext). */
export interface PlaygroundPrefs {
  /** Last selected model id. */
  lastModelId: string;
  /** Last selected speech-synthesis model id (remembered separately from language chat). */
  lastTtsModelId: string;
  /** Last selected realtime-conversation model id (remembered separately from language chat). */
  lastRealtimeModelId: string;
  /** Last selected image-parse model id (remembered separately from language chat). */
  lastImageParseModelId: string;
  /** Last selected API key id. */
  lastKeyId: string;
  /** Reasoning depth level: off | on. */
  thinkingDepth: 'off' | 'on';
  /** Whether the left sidebar is collapsed. */
  sidebarCollapsed: boolean;
  /** Per-model chat parameters (key = modelId), remembered independently when switching models. */
  paramsByModel: Record<string, PlaygroundParamValues>;
  /** UI guide ids already seen (including a version), so the same guide does not pop up again. */
  seenTours: string[];
  /** Document parsing: hide headers, footers, and page numbers in the result. */
  imageParseHideHeaderFooter: boolean;
  /** Document parsing: show reading-order numbers on layout boxes (to tell a layout problem from a recognition problem). */
  imageParseShowOrder: boolean;
}

interface AppState {
  sidebarCollapsed: boolean;
  theme: 'light' | 'dark' | 'system';
  locale: AppLocale;
  layoutMode: LayoutMode;
  /** Playground UI preferences. */
  playground: PlaygroundPrefs;

  toggleSidebar: () => void;
  setTheme: (theme: AppState['theme']) => void;
  setLocale: (locale: AppState['locale']) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  /** Incrementally update Playground preferences. */
  setPlaygroundPrefs: (patch: Partial<PlaygroundPrefs>) => void;
  /** Set chat parameters for one model (merged incrementally, persisted by modelId). */
  setModelParams: (modelId: string, patch: Partial<PlaygroundParamValues>) => void;
  /** Delete all user parameter overrides for one model, restoring the model config or empty values. */
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
      // Compatible with the old persisted shape: fill defaults when the playground field is missing.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const playground: Partial<PlaygroundPrefs> & Record<string, unknown> = {
          ...p.playground,
        };
        // Removed display preferences are not restored, so old browser state does not turn confidence back on.
        delete playground.imageParseShowScore;
        return {
          ...current,
          ...p,
          // Accept only supported persisted languages, so a historical bad value cannot break UI initialization.
          locale: isAppLocale(p.locale) ? p.locale : current.locale,
          playground: { ...DEFAULT_PLAYGROUND_PREFS, ...playground },
        };
      },
    },
  ),
);

/**
 * Clear defaults that an older Playground wrote automatically.
 * The old maxTokens = 0 was a sentinel for "do not send", so it can be removed safely; other numbers have no source mark,
 * and are cleared only when the sampling parameters all equal the historical defaults, so recognized user customizations are not overwritten.
 * @param persistedState Old state persisted by Zustand.
 * @returns Migrated state the new store can merge.
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
 * Whether a persisted value is a UI language MAP supports.
 * @param value Persisted value to check.
 * @returns Whether the value can be used as an AppLocale.
 */
function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as AppLocale);
}

/** Whether an unknown value is a plain record that can be spread safely. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
