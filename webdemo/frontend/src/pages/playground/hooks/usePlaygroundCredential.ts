/**
 * Playground 凭据编排 hook。
 *
 * 用途：把「用户自有 API Key」和「平台免费体验 Key」收敛成一个有效凭据。当前体验
 * 免费额度仍有剩余时优先使用内部体验 Key；用完后回退默认项目下的普通 API Key。
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  mapAuthApi,
  mapKeys,
  useAllKeysQuery,
  useKeySecretQuery,
  usePlaygroundTrialQuery,
} from '@/api/map';
import type { MapApiKey, MapPlaygroundTrial, PlaygroundTrialExperience } from '@/api/map';

/** 免费体验凭据选择结果；secret 仅在体验 Key 场景直接来自 L3 返回值。 */
interface PlaygroundCredentialSelection {
  keyId: string;
  projectId?: string;
  secret?: string;
}

const emptyTrialRemaining: Record<PlaygroundTrialExperience, number> = {
  language: 0,
  tts: 0,
  realtime: 0,
  'image-parse': 0,
};

/** 非 language 体验是否有可见模型；与体验路由回退使用同一组模型目录口径。 */
export type PlaygroundCredentialExperienceAvailability = {
  tts: boolean;
  realtime: boolean;
  'image-parse': boolean;
};

/**
 * 将 URL 体验类型映射为计费凭据类型。模型加载中保持原体验；加载完成后若该体验无
 * 可见模型，则与页面路由同步回退 language，避免语言对话误消耗其它体验额度。
 */
export function resolvePlaygroundCredentialExperience(
  experience: PlaygroundTrialExperience,
  available: PlaygroundCredentialExperienceAvailability,
  loading: boolean,
): PlaygroundTrialExperience {
  if (loading || experience === 'language') return experience;
  return available[experience] ? experience : 'language';
}

/**
 * 选择 Playground 当前有效凭据。
 * @param keys 用户自有 active Key 列表
 * @param trial 免费体验状态
 * @param defaultProjectId 默认项目 ID
 * @param experience 当前体验类型；额度按类型独立回退
 * @returns 有效 Key、项目与体验 Key 明文；无可用凭据时 keyId 为空
 */
export function resolvePlaygroundCredential(
  keys: MapApiKey[],
  trial: MapPlaygroundTrial | undefined,
  defaultProjectId?: string,
  experience: PlaygroundTrialExperience = 'language',
): PlaygroundCredentialSelection {
  const hasRemaining = (trial?.remaining ?? emptyTrialRemaining)[experience] > 0;
  if (hasRemaining && trial?.api_key_id && trial.secret) {
    return { keyId: trial.api_key_id, projectId: trial.project_id, secret: trial.secret };
  }

  const keyId = pickDefaultKeyId(keys, defaultProjectId);
  return { keyId, projectId: keys.find((key) => key.id === keyId)?.project_id };
}

/** usePlaygroundCredential 返回的有效凭据与剩余次数状态。 */
export function usePlaygroundCredential(experience: PlaygroundTrialExperience = 'language') {
  const queryClient = useQueryClient();
  const keysQuery = useAllKeysQuery();
  const trialQuery = usePlaygroundTrialQuery();
  // 只为默认项目选择普通 Key；与 Header 等共用 /me 缓存，不重复请求。
  const meQuery = useQuery({ queryKey: mapKeys.me(), queryFn: mapAuthApi.me });

  const keys = useMemo(
    () => (keysQuery.data?.list ?? []).filter((key) => key.status === 'active'),
    [keysQuery.data],
  );
  const trialRemaining = trialQuery.data?.remaining ?? emptyTrialRemaining;
  const credential = resolvePlaygroundCredential(
    keys,
    trialQuery.data,
    meQuery.data?.default_project_id,
    experience,
  );
  const usingTrial = Boolean(credential.secret);
  const secretQuery = useKeySecretQuery(usingTrial ? '' : credential.keyId, !usingTrial);
  const secret = usingTrial ? credential.secret : secretQuery.data?.secret;
  const getSecret = useCallback(() => secret, [secret]);
  const refreshTrial = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: mapKeys.playgroundTrial() });
  }, [queryClient]);

  return {
    /** 当前默认项目，供上传与识别生命周期隔离。 */
    defaultProjectId: meQuery.data?.default_project_id,
    /** 普通自有 Key 是否仍在加载（免费体验状态也视为凭据加载的一部分）。 */
    keysLoading: keysQuery.isLoading || trialQuery.isLoading,
    /** 是否存在用户自有 active API Key；隐藏体验 Key 不计入。 */
    hasKeys: keys.length > 0,
    /** 当前有效 Key id：有免费体验时为隐藏 Key，否则为普通 Key。 */
    keyId: credential.keyId,
    /** 当前有效 Key 所属项目。 */
    keyProjectId: credential.projectId,
    /** 四类体验的剩余免费次数。 */
    trialRemaining,
    /** 免费体验状态是否仍在加载。 */
    trialLoading: trialQuery.isLoading,
    /** 免费体验状态是否获取失败。 */
    trialError: trialQuery.isError,
    /** 当前体验仍有额度且隐藏 Key 可用。 */
    trialAvailable: usingTrial,
    /** 明文密钥就绪态。 */
    secretReady: Boolean(secret),
    secretLoading: usingTrial ? trialQuery.isFetching : secretQuery.isFetching,
    secretError: usingTrial ? trialQuery.isError : secretQuery.isError,
    /** 懒取当前有效明文密钥；仅内存使用，不落盘。 */
    getSecret,
    /** 请求终态后刷新免费体验状态。 */
    refreshTrial,
  };
}

/** 默认 Key 选定：默认项目下首个 active key 优先，否则首个 active key。 */
function pickDefaultKeyId(keys: MapApiKey[], defaultProjectId?: string): string {
  if (defaultProjectId) {
    const inDefault = keys.find((key) => key.project_id === defaultProjectId);
    if (inDefault) return inDefault.id;
  }
  return keys[0]?.id ?? '';
}
