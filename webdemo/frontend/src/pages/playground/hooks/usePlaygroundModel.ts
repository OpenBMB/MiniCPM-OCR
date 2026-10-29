/**
 * 模型 + API Key 选择与明文密钥编排 hook。
 *
 * 用途：把「可调用模型列表」与「Playground 有效凭据」收敛为一个选择器状态机。
 * 明文密钥仅存 TanStack Query 缓存（staleTime/gcTime=0），不落盘。
 */

import { useCallback, useMemo, useState } from 'react';
import { useAppStore } from '@map/store';
import { getTokenSubject, useModelsQuery } from '@/api/map';
import type { MapModel, PlaygroundTrialExperience } from '@/api/map';
import {
  resolvePlaygroundCredentialExperience,
  usePlaygroundCredential,
} from './usePlaygroundCredential';
import { languageModels, modelsByExperience } from '@/utils/modelExperience';

/** usePlaygroundModel 返回 */
interface UsePlaygroundModelReturn {
  /** 当前登录用户 ID，供会话草稿按账号隔离。 */
  userId?: string;
  /** 当前默认项目，供上传与识别生命周期隔离。 */
  defaultProjectId?: string;
  /** 当前用户信息是否仍在加载。 */
  userLoading: boolean;
  /** 语言对话可选模型（已排除语音合成 / 实时语音） */
  models: MapModel[];
  modelsLoading: boolean;
  /** 当前语言对话选中模型 id */
  modelId: string;
  selectModel: (id: string) => void;
  /** 语音合成可选模型（管理端勾了「语音合成」的全部模型） */
  ttsModels: MapModel[];
  /** 当前选中的语音合成模型，无可用模型时 undefined */
  ttsModel?: MapModel;
  selectTtsModel: (id: string) => void;
  /** 实时对话可选模型（管理端勾了「实时对话」的全部模型） */
  realtimeModels: MapModel[];
  /** 当前选中的实时对话模型，无可用模型时 undefined */
  realtimeModel?: MapModel;
  selectRealtimeModel: (id: string) => void;
  /** 图像解析可选模型（管理端勾了「图像解析」且支持图像输入） */
  imageParseModels: MapModel[];
  /** 当前选中的图像解析模型，无可用模型时 undefined */
  imageParseModel?: MapModel;
  selectImageParseModel: (id: string) => void;
  /** 密钥列表是否加载中（用于区分「加载中」与「确无可用 Key」） */
  keysLoading: boolean;
  /** 是否存在可用 API Key（无则上层引导去创建） */
  hasKeys: boolean;
  /** 自动选定的 Key id（默认项目优先，对用户不可见、不可切换） */
  keyId: string;
  /** 实际模型 Key 所属项目，用于核对文档上传的默认项目边界。 */
  keyProjectId?: string;
  /** 明文密钥就绪态 */
  secretReady: boolean;
  secretLoading: boolean;
  secretError: boolean;
  /** 四类体验剩余免费次数 */
  trialRemaining: ReturnType<typeof usePlaygroundCredential>['trialRemaining'];
  /** 免费体验状态加载中 */
  trialLoading: boolean;
  /** 免费体验状态获取失败 */
  trialError: boolean;
  /** 是否正在使用隐藏免费体验 Key */
  trialAvailable: boolean;
  /** 懒取明文密钥（供 useChat 在 send 时调用） */
  getSecret: () => string | undefined;
  /** 请求终态后刷新免费体验状态。 */
  refreshTrial: () => void;
}

/**
 * 模型选择与密钥编排。
 *
 * 四类体验各自记忆选中模型（语言 / TTS / 实时 / 图像解析），互不干扰。
 * API Key 不暴露选择器：免费额度未用完时自动使用隐藏体验 Key；用完后回退默认项目下
 * 的 active key。两者都不可用时由上层显示「去创建 API Key」引导。
 */
export function usePlaygroundModel(
  credentialExperience: PlaygroundTrialExperience = 'language',
): UsePlaygroundModelReturn {
  const prefs = useAppStore((s) => s.playground);
  const setPrefs = useAppStore((s) => s.setPlaygroundPrefs);
  const modelsQuery = useModelsQuery();

  // 按能力筛选四类体验；支持文本输入的图像解析模型也可用于语言对话。
  const allModels = useMemo(() => modelsQuery.data?.list ?? [], [modelsQuery.data]);
  const models = useMemo(() => languageModels(allModels), [allModels]);
  const ttsModels = useMemo(() => modelsByExperience(allModels, 'tts'), [allModels]);
  const realtimeModels = useMemo(() => modelsByExperience(allModels, 'realtime'), [allModels]);
  const imageParseModels = useMemo(() => modelsByExperience(allModels, 'image-parse'), [allModels]);
  // URL 体验在无对应模型时会回退语言页面；凭据类型必须同步回退，避免误扣其它体验额度。
  const effectiveCredentialExperience = resolvePlaygroundCredentialExperience(
    credentialExperience,
    {
      tts: ttsModels.length > 0,
      realtime: realtimeModels.length > 0,
      'image-parse': imageParseModels.length > 0,
    },
    modelsQuery.isLoading,
  );
  const credential = usePlaygroundCredential(effectiveCredentialExperience);
  const [modelIdState, setModelIdState] = useState<string>('');
  const [ttsModelIdState, setTtsModelIdState] = useState<string>('');
  const [realtimeModelIdState, setRealtimeModelIdState] = useState<string>('');
  const [imageParseModelIdState, setImageParseModelIdState] = useState<string>('');

  // 渲染期条件 seeding：列表就绪且未选时，落定初值（优先持久化偏好），避免 effect+setState。
  const modelId = resolveSelection(
    modelIdState,
    prefs.lastModelId,
    models.map((m) => m.id),
  );
  const ttsModelId = resolveSelection(
    ttsModelIdState,
    prefs.lastTtsModelId,
    ttsModels.map((m) => m.id),
  );
  const realtimeModelId = resolveSelection(
    realtimeModelIdState,
    prefs.lastRealtimeModelId,
    realtimeModels.map((m) => m.id),
  );
  const imageParseModelId = resolveSelection(
    imageParseModelIdState,
    prefs.lastImageParseModelId,
    imageParseModels.map((m) => m.id),
  );
  const ttsModel = ttsModels.find((m) => m.id === ttsModelId);
  const realtimeModel = realtimeModels.find((m) => m.id === realtimeModelId);
  const imageParseModel = imageParseModels.find((m) => m.id === imageParseModelId);
  // 草稿隔离直接使用当前 JWT 的 sub，避免账号切换时 TanStack Query 短暂返回上一账号 /me 缓存。
  const userId = getTokenSubject();

  const selectModel = useCallback(
    (id: string) => {
      setModelIdState(id);
      setPrefs({ lastModelId: id });
    },
    [setPrefs],
  );
  const selectTtsModel = useCallback(
    (id: string) => {
      setTtsModelIdState(id);
      setPrefs({ lastTtsModelId: id });
    },
    [setPrefs],
  );
  const selectRealtimeModel = useCallback(
    (id: string) => {
      setRealtimeModelIdState(id);
      setPrefs({ lastRealtimeModelId: id });
    },
    [setPrefs],
  );
  const selectImageParseModel = useCallback(
    (id: string) => {
      setImageParseModelIdState(id);
      setPrefs({ lastImageParseModelId: id });
    },
    [setPrefs],
  );
  return {
    userId: userId || undefined,
    ...credential,
    userLoading: false,
    models,
    modelsLoading: modelsQuery.isLoading,
    modelId,
    selectModel,
    ttsModels,
    ttsModel,
    selectTtsModel,
    realtimeModels,
    realtimeModel,
    selectRealtimeModel,
    imageParseModels,
    imageParseModel,
    selectImageParseModel,
  };
}

/** 模型选择落定：已手动选 → 用之；否则用持久化偏好（若在列表内）；再否则列表首项 */
function resolveSelection(manual: string, preferred: string, ids: string[]): string {
  if (manual && ids.includes(manual)) return manual;
  if (preferred && ids.includes(preferred)) return preferred;
  return ids[0] ?? '';
}
