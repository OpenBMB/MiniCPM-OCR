/**
 * Hook that selects the model and API Key and orchestrates the plaintext secret.
 *
 * Purpose: collapse "the list of callable models" and "the effective Playground credential" into one selector state machine.
 * The plaintext secret lives only in the TanStack Query cache (staleTime/gcTime=0) and is not persisted to disk.
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

/** usePlaygroundModel return value */
interface UsePlaygroundModelReturn {
  /** Currently logged-in user ID, so conversation drafts are isolated by account. */
  userId?: string;
  /** Current default project, used to isolate upload and recognition lifecycles. */
  defaultProjectId?: string;
  /** Whether the current user info is still loading. */
  userLoading: boolean;
  /** Models available for language chat (speech synthesis and realtime voice are already excluded) */
  models: MapModel[];
  modelsLoading: boolean;
  /** Model id currently selected for language chat */
  modelId: string;
  selectModel: (id: string) => void;
  /** Models available for speech synthesis (every model the admin console checked as "speech synthesis") */
  ttsModels: MapModel[];
  /** Speech-synthesis model currently selected; undefined when no model is available */
  ttsModel?: MapModel;
  selectTtsModel: (id: string) => void;
  /** Models available for realtime conversation (every model the admin console checked as "realtime conversation") */
  realtimeModels: MapModel[];
  /** Realtime-conversation model currently selected; undefined when no model is available */
  realtimeModel?: MapModel;
  selectRealtimeModel: (id: string) => void;
  /** Models available for image parsing (checked as "image parsing" in the admin console and supporting image input) */
  imageParseModels: MapModel[];
  /** Image-parsing model currently selected; undefined when no model is available */
  imageParseModel?: MapModel;
  selectImageParseModel: (id: string) => void;
  /** Whether the secret list is loading (used to tell "loading" from "there really is no usable key") */
  keysLoading: boolean;
  /** Whether a usable API Key exists (if not, the caller guides the user to create one) */
  hasKeys: boolean;
  /** Auto-selected key id (the default project is preferred; invisible to the user and not switchable) */
  keyId: string;
  /** Project the actual model key belongs to, used to check the default-project boundary of a document upload. */
  keyProjectId?: string;
  /** Plaintext-secret readiness */
  secretReady: boolean;
  secretLoading: boolean;
  secretError: boolean;
  /** Remaining free counts for the four experiences */
  trialRemaining: ReturnType<typeof usePlaygroundCredential>['trialRemaining'];
  /** Free-trial state is loading */
  trialLoading: boolean;
  /** Fetching free-trial state failed */
  trialError: boolean;
  /** Whether the hidden free-trial key is in use */
  trialAvailable: boolean;
  /** Lazily read the plaintext secret (for useChat to call at send time) */
  getSecret: () => string | undefined;
  /** Refresh free-trial state after a request reaches a terminal state. */
  refreshTrial: () => void;
}

/**
 * Model selection and secret orchestration.
 *
 * Each of the four experiences remembers its own selected model (language / TTS / realtime / image parsing), and they do not interfere.
 * The API Key exposes no selector: while free quota remains, the hidden trial key is used automatically; after it is used up, fall back to the
 * active key under the default project. When neither is available, the caller shows the "go create an API Key" guide.
 */
export function usePlaygroundModel(
  credentialExperience: PlaygroundTrialExperience = 'language',
): UsePlaygroundModelReturn {
  const prefs = useAppStore((s) => s.playground);
  const setPrefs = useAppStore((s) => s.setPlaygroundPrefs);
  const modelsQuery = useModelsQuery();

  // Filter the four experiences by capability; an image-parsing model that supports text input can also be used for language chat.
  const allModels = useMemo(() => modelsQuery.data?.list ?? [], [modelsQuery.data]);
  const models = useMemo(() => languageModels(allModels), [allModels]);
  const ttsModels = useMemo(() => modelsByExperience(allModels, 'tts'), [allModels]);
  const realtimeModels = useMemo(() => modelsByExperience(allModels, 'realtime'), [allModels]);
  const imageParseModels = useMemo(() => modelsByExperience(allModels, 'image-parse'), [allModels]);
  // A URL experience falls back to the language page when it has no matching model; the credential type must fall back in sync, so another experience's quota is not charged by mistake.
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

  // Conditional seeding during render: when the list is ready and nothing is selected, settle the initial value (persisted preference first), avoiding effect plus setState.
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
  // Draft isolation uses the current JWT sub directly, so an account switch does not briefly get the previous account's /me cache from TanStack Query.
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

/** Settle model selection: if one was chosen manually, use it; otherwise the persisted preference if it is in the list; otherwise the first item in the list */
function resolveSelection(manual: string, preferred: string, ids: string[]): string {
  if (manual && ids.includes(manual)) return manual;
  if (preferred && ids.includes(preferred)) return preferred;
  return ids[0] ?? '';
}
