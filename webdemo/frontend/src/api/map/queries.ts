import {
  useMutation,
  useQuery,
  useInfiniteQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { mapResourcesApi } from './resources';

/**
 * TanStack Query wrappers for the MAP resource domain.
 *
 * Purpose: gather server cacheable state (projects, keys, models, usage, logs, quotas) into query/mutation hooks,
 * following the MAP `example.query.ts` pattern (queryKey factory plus useXxxQuery/useXxxMutation),
 * so pages do not scatter useState+useEffect data fetching (AGENTS hard rule #4).
 */

/** queryKey factory: centralize every cache key in the MAP resource domain */
export const mapKeys = {
  all: ['map'] as const,
  me: () => [...mapKeys.all, 'me'] as const,
  projects: () => [...mapKeys.all, 'projects'] as const,
  keys: (projectId: string) => [...mapKeys.all, 'keys', projectId] as const,
  keysAll: () => [...mapKeys.all, 'keys-all'] as const,
  keySecret: (keyId: string) => [...mapKeys.all, 'key-secret', keyId] as const,
  playgroundTrial: () => [...mapKeys.all, 'playground-trial'] as const,
  models: () => [...mapKeys.all, 'models'] as const,
  voices: () => [...mapKeys.all, 'voices'] as const,
  featureAccess: () => [...mapKeys.all, 'feature-access'] as const,
  usageSummary: (start?: string, end?: string) =>
    [...mapKeys.all, 'usage-summary', start ?? '', end ?? ''] as const,
  logs: (requestId: string, publicModel: string, outcome: string, page: number, pageSize: number) =>
    [...mapKeys.all, 'logs', requestId, publicModel, outcome, page, pageSize] as const,
  publicConfig: () => [...mapKeys.all, 'public-config'] as const,
  billingAccount: () => [...mapKeys.all, 'billing-account'] as const,
  creditPackages: () => [...mapKeys.all, 'credit-packages'] as const,
  recharges: () => [...mapKeys.all, 'recharges'] as const,
  rewards: () => [...mapKeys.all, 'rewards'] as const,
  spend: (start: string, end: string) => [...mapKeys.all, 'spend', start, end] as const,
  callLogDetail: (requestId: string) => [...mapKeys.all, 'call-log', requestId] as const,
  monthlyBills: () => [...mapKeys.all, 'monthly-bills'] as const,
  alertConfigs: () => [...mapKeys.all, 'alert-configs'] as const,
  conversations: () => [...mapKeys.all, 'conversations'] as const,
  conversation: (id: string) => [...mapKeys.all, 'conversation', id] as const,
};

/** Project list query */
export function useProjectsQuery() {
  return useQuery({ queryKey: mapKeys.projects(), queryFn: mapResourcesApi.projects });
}

/** API Key list query for a project (not sent when projectId is empty) */
export function useKeysQuery(projectId: string) {
  return useQuery({
    queryKey: mapKeys.keys(projectId),
    queryFn: () => mapResourcesApi.keys(projectId),
    enabled: Boolean(projectId),
  });
}

/** API Key list query for every project in the current organization (cross-project, used by onboarding to pick a key) */
export function useAllKeysQuery() {
  return useQuery({
    queryKey: mapKeys.keysAll(),
    queryFn: mapResourcesApi.keysAll,
    // After the user creates a key on the Keys page and returns to Playground (or refreshes), this must be read again so the new key can be selected automatically.
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/**
 * Full plaintext query for an API Key (backend AES-GCM decrypt).
 *
 * Purpose: onboarding examples echo the real plaintext of the selected key. Not sent when keyId is empty. The plaintext is sensitive and is not cached for long
 * (staleTime/gcTime are 0). When an old key has no ciphertext the backend returns 409 and the query enters the error state so the UI can fall back to a placeholder.
 */
export function useKeySecretQuery(keyId: string, enabled = true) {
  return useQuery({
    queryKey: mapKeys.keySecret(keyId),
    queryFn: () => mapResourcesApi.revealKeySecret(keyId),
    enabled: enabled && Boolean(keyId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/**
 * Playground free-trial status query.
 *
 * The result includes the trial key plaintext, which is used in memory only. To avoid leaving sensitive credentials across pages,
 * the cache policy matches key plaintext (staleTime/gcTime=0), and failures are not retried automatically.
 */
export function usePlaygroundTrialQuery() {
  return useQuery({
    queryKey: mapKeys.playgroundTrial(),
    queryFn: mapResourcesApi.playgroundTrial,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Callable model list query */
export function useModelsQuery() {
  return useQuery({
    queryKey: mapKeys.models(),
    queryFn: mapResourcesApi.models,
    // The admin console and Portal are separate apps; refresh when returning to Playground so model capability switches are picked up promptly.
    refetchOnWindowFocus: true,
  });
}

/** Current user's private voice list query. */
export function useVoicesQuery(enabled = true) {
  return useQuery({
    queryKey: mapKeys.voices(),
    queryFn: mapResourcesApi.voices,
    enabled,
  });
}

/** Product feature permission query for the currently logged-in user. */
export function useFeatureAccessQuery() {
  return useQuery({
    queryKey: mapKeys.featureAccess(),
    queryFn: mapResourcesApi.featureAccess,
  });
}

/** Upload a private voice and refresh the voice list */
export function useCreateVoiceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { file: File; name?: string }) =>
      mapResourcesApi.createVoice(params.file, params.name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mapKeys.voices() }),
  });
}

/** Delete a private voice and refresh the voice list */
export function useDeleteVoiceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (voiceId: string) => mapResourcesApi.deleteVoice(voiceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mapKeys.voices() }),
  });
}

/** Usage summary query */
export function useUsageSummaryQuery(start?: string, end?: string) {
  return useQuery({
    queryKey: mapKeys.usageSummary(start, end),
    queryFn: () => mapResourcesApi.usageSummary(start, end),
  });
}

/** Call-log query (server pagination, filtered by request_id / model / outcome; keep the previous page while paging to avoid flicker) */
export function useLogsQuery(
  requestId: string,
  publicModel: string,
  outcome: string,
  page: number,
  pageSize: number,
) {
  return useQuery({
    queryKey: mapKeys.logs(requestId, publicModel, outcome, page, pageSize),
    queryFn: () => mapResourcesApi.logs({ requestId, publicModel, outcome, page, pageSize }),
    placeholderData: keepPreviousData,
  });
}

/** Public config query */
export function usePublicConfigQuery() {
  return useQuery({ queryKey: mapKeys.publicConfig(), queryFn: mapResourcesApi.publicConfig });
}

/** Current user's billing account query */
export function useBillingAccountQuery() {
  return useQuery({ queryKey: mapKeys.billingAccount(), queryFn: mapResourcesApi.billingAccount });
}

/** Current user's trial credit package query */
export function useCreditPackagesQuery() {
  return useQuery({ queryKey: mapKeys.creditPackages(), queryFn: mapResourcesApi.creditPackages });
}

/** Current user's top-up history query */
export function useRechargesQuery() {
  return useQuery({ queryKey: mapKeys.recharges(), queryFn: mapResourcesApi.recharges });
}

export function useRewardsQuery() {
  return useQuery({ queryKey: mapKeys.rewards(), queryFn: mapResourcesApi.rewards });
}

export function useClaimDailyCheckinMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mapResourcesApi.claimDailyCheckin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mapKeys.rewards() });
      queryClient.invalidateQueries({ queryKey: mapKeys.billingAccount() });
      queryClient.invalidateQueries({ queryKey: mapKeys.recharges() });
    },
  });
}

/** Current user's spend statistics query (by range) */
export function useSpendQuery(start: string, end: string) {
  return useQuery({
    queryKey: mapKeys.spend(start, end),
    queryFn: () => mapResourcesApi.spend(start, end),
    placeholderData: keepPreviousData,
  });
}

/** Call detail query (including body; not sent when requestId is empty) */
export function useCallLogDetailQuery(requestId: string, enabled: boolean) {
  return useQuery({
    queryKey: mapKeys.callLogDetail(requestId),
    queryFn: () => mapResourcesApi.callLogDetail(requestId),
    enabled: enabled && Boolean(requestId),
  });
}

/** Current user's monthly bill query */
export function useMonthlyBillsQuery() {
  return useQuery({ queryKey: mapKeys.monthlyBills(), queryFn: mapResourcesApi.monthlyBills });
}

/** Alert config query */
export function useAlertConfigsQuery() {
  return useQuery({ queryKey: mapKeys.alertConfigs(), queryFn: mapResourcesApi.alertConfigs });
}

/** Create a project (invalidate the project list cache on success) */
export function useCreateProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => mapResourcesApi.createProject(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mapKeys.projects() }),
  });
}

/** Update alert config (invalidate the alert config cache on success) */
export function useUpsertAlertConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mapResourcesApi.upsertAlertConfig,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mapKeys.alertConfigs() }),
  });
}

/** Submit a top-up request */
export function useRechargeRequestMutation() {
  return useMutation({ mutationFn: mapResourcesApi.rechargeRequest });
}

/** Submit experience-center conversation feedback (like/dislike); fire-and-forget, no cache refresh */
export function useSubmitFeedbackMutation() {
  return useMutation({ mutationFn: mapResourcesApi.submitFeedback });
}

/** Start a Yeepay online payment order (on success the frontend redirects to cashier_url; no local cache refresh) */
export function useYeepayOrderMutation() {
  return useMutation({ mutationFn: mapResourcesApi.yeepayOrder });
}

// ===== Playground history conversations =====

/**
 * Paged history-conversation query: 20 items per page, and the sidebar Load more conversations control explicitly appends the next page.
 * The list can be very long, and loading it all at once can stall or crash, so pages are accumulated.
 */
export function useInfiniteConversationsQuery() {
  const pageSize = 20;
  return useInfiniteQuery({
    queryKey: [...mapKeys.conversations(), 'infinite'] as const,
    queryFn: ({ pageParam }) => mapResourcesApi.conversations({ page: pageParam, pageSize }),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      // When the backend is not deployed or returns an error, fields may be missing. Defend by stopping paging when valid page info is absent
      if (!last || typeof last.total !== 'number' || typeof last.page !== 'number')
        return undefined;
      const loaded = last.page * (last.page_size || pageSize);
      return loaded < last.total ? last.page + 1 : undefined;
    },
  });
}

/** Single conversation detail query (not sent when id is empty) */
export function useConversationQuery(id: string) {
  return useQuery({
    queryKey: mapKeys.conversation(id),
    queryFn: () => mapResourcesApi.getConversation(id),
    enabled: Boolean(id),
  });
}

/** Create a conversation (invalidate the list cache on success) */
export function useCreateConversationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { title?: string; model?: string } = {}) =>
      mapResourcesApi.createConversation(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mapKeys.conversations() }),
  });
}

/** Save conversation messages (full overwrite; invalidate the list cache on success to refresh title and sort order) */
export function useSaveConversationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id: string;
      payload: Parameters<typeof mapResourcesApi.saveConversation>[1];
    }) => mapResourcesApi.saveConversation(vars.id, vars.payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mapKeys.conversations() }),
  });
}

/** Delete a conversation (invalidate the list cache on success) */
export function useDeleteConversationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mapResourcesApi.deleteConversation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mapKeys.conversations() }),
  });
}
