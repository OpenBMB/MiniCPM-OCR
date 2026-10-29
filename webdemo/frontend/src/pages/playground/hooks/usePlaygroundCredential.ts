/**
 * Playground credential-orchestration hook.
 *
 * Purpose: collapse "the user's own API Key" and "the platform free-trial key" into one effective credential. While the current experience
 * still has free quota left, the internal trial key is preferred; after it is used up, fall back to an ordinary API Key under the default project.
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

/** Free-trial credential selection result; secret comes directly from the L3 return value only in the trial-key case. */
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

/** Whether a non-language experience has a visible model; the same model-catalog measure as the experience-route fallback. */
export type PlaygroundCredentialExperienceAvailability = {
  tts: boolean;
  realtime: boolean;
  'image-parse': boolean;
};

/**
 * Map a URL experience type to a billing credential type. While models are loading, keep the original experience; after loading, if that experience has no
 * visible model, fall back to language in sync with the page route, so a language conversation does not consume another experience's quota by mistake.
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
 * Select the credential currently effective for Playground.
 * @param keys the user's own active Key list
 * @param trial free-trial state
 * @param defaultProjectId default project ID
 * @param experience current experience type; quota falls back independently per type
 * @returns the effective key, project, and trial-key plaintext; keyId is empty when no credential is available
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

/** Effective credential and remaining-count state returned by usePlaygroundCredential. */
export function usePlaygroundCredential(experience: PlaygroundTrialExperience = 'language') {
  const queryClient = useQueryClient();
  const keysQuery = useAllKeysQuery();
  const trialQuery = usePlaygroundTrialQuery();
  // Select an ordinary key only for the default project; share the /me cache with Header and others, and do not request it again.
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
    /** Current default project, used to isolate upload and recognition lifecycles. */
    defaultProjectId: meQuery.data?.default_project_id,
    /** Whether an ordinary own key is still loading (free-trial state also counts as part of credential loading). */
    keysLoading: keysQuery.isLoading || trialQuery.isLoading,
    /** Whether the user has an own active API Key; the hidden trial key is not counted. */
    hasKeys: keys.length > 0,
    /** Current effective key id: the hidden key while a free trial remains, otherwise an ordinary key. */
    keyId: credential.keyId,
    /** Project the current effective key belongs to. */
    keyProjectId: credential.projectId,
    /** Remaining free counts for the four experiences. */
    trialRemaining,
    /** Whether free-trial state is still loading. */
    trialLoading: trialQuery.isLoading,
    /** Whether fetching free-trial state failed. */
    trialError: trialQuery.isError,
    /** The current experience still has quota and the hidden key is available. */
    trialAvailable: usingTrial,
    /** Plaintext-secret readiness. */
    secretReady: Boolean(secret),
    secretLoading: usingTrial ? trialQuery.isFetching : secretQuery.isFetching,
    secretError: usingTrial ? trialQuery.isError : secretQuery.isError,
    /** Lazily read the current effective plaintext secret; used in memory only, and not persisted to disk. */
    getSecret,
    /** Refresh free-trial state after a request reaches a terminal state. */
    refreshTrial,
  };
}

/** Default key selection: the first active key under the default project is preferred, otherwise the first active key. */
function pickDefaultKeyId(keys: MapApiKey[], defaultProjectId?: string): string {
  if (defaultProjectId) {
    const inDefault = keys.find((key) => key.project_id === defaultProjectId);
    if (inDefault) return inDefault.id;
  }
  return keys[0]?.id ?? '';
}
