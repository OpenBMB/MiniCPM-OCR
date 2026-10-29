import { mapDownload, mapRequest, mapUpload } from './request';
import type {
  MapAlertConfig,
  MapAlertConfigInput,
  MapApiKey,
  MapBillingAccount,
  MapCreditPackageSnapshot,
  MapRewardStatus,
  MapCallLogDetail,
  MapConversation,
  MapConversationDetail,
  MapFeedback,
  MapFeedbackInput,
  MapFeatureAccess,
  MapModel,
  MapPortalMonthlyBill,
  MapPlaygroundTrial,
  MapProject,
  MapPublicConfig,
  MapRechargeRecord,
  MapRequestLog,
  MapSaveConversationInput,
  MapSpendStats,
  MapUsageSummary,
  MapVoiceResource,
  MapYeepayOrder,
} from './types';

/**
 * MAP resource API.
 *
 * Purpose: read and write developer-portal resources such as projects, API keys, models, usage, logs, and quotas, all through `mapRequest`
 * directly to the MAP backend (raw JSON). This is server cacheable state, and pages fetch it wrapped in TanStack Query.
 * Migrated from the `client` resource section of the original `web/portal/src/api.ts`.
 */
export const mapResourcesApi = {
  /** Project list */
  projects: () => mapRequest<{ list: MapProject[] }>('/projects'),

  /** Create a project */
  createProject: (name: string) =>
    mapRequest<MapProject>('/projects', { method: 'POST', body: JSON.stringify({ name }) }),

  /** API Key list under a project */
  keys: (projectId: string) => mapRequest<{ list: MapApiKey[] }>(`/projects/${projectId}/keys`),

  /** API keys for every project in the current organization (cross-project, with project_name marking ownership) */
  keysAll: () => mapRequest<{ list: MapApiKey[] }>('/keys'),

  /** Create an API Key under a project (returns the plaintext secret, once only) */
  createKey: (projectId: string, payload: { name: string; expires_at?: string }) =>
    mapRequest<{ api_key: MapApiKey; secret: string }>(`/projects/${projectId}/keys`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Enable / disable an API Key */
  setKeyStatus: (keyId: string, status: 'active' | 'disabled') =>
    mapRequest<{ status: string }>(`/keys/${keyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  /** Delete an API Key */
  deleteKey: (keyId: string) =>
    mapRequest<{ status: string }>(`/keys/${keyId}`, { method: 'DELETE' }),

  /** Rotate an API Key (the old secret expires immediately and a new plaintext secret is returned) */
  rotateKey: (keyId: string) =>
    mapRequest<{ secret: string; prefix: string }>(`/keys/${keyId}/rotate`, { method: 'POST' }),

  /** Fetch the full plaintext of an API Key (backend AES-GCM decrypt; 409 when an old key has no ciphertext) */
  revealKeySecret: (keyId: string) => mapRequest<{ secret: string }>(`/keys/${keyId}/secret`),

  /** Callable model list */
  models: () => mapRequest<{ list: MapModel[] }>('/models'),

  /** Remaining counts and internal trial credentials for the current user's four Playground free trials */
  playgroundTrial: () => mapRequest<MapPlaygroundTrial>('/playground/trial'),

  /** Current user's private voice list */
  voices: () => mapRequest<{ list: MapVoiceResource[] }>('/voices'),

  /** Product features available to the currently logged-in user */
  featureAccess: () => mapRequest<MapFeatureAccess>('/feature-access'),

  /** Upload and save one private WAV voice */
  createVoice: (file: File, name?: string, idempotencyKey = crypto.randomUUID()) => {
    const form = new FormData();
    form.append('file', file);
    if (name?.trim()) form.append('name', name.trim());
    return mapUpload<MapVoiceResource>('/voices', form, { 'Idempotency-Key': idempotencyKey });
  },

  /** Delete a voice owned by the current user */
  deleteVoice: (voiceId: string) =>
    mapRequest<{ status: string }>(`/voices/${encodeURIComponent(voiceId)}`, {
      method: 'DELETE',
    }),

  /** Usage summary (an optional range may be given) */
  usageSummary: (start?: string, end?: string) => {
    const sp = new URLSearchParams();
    if (start) sp.set('start', start);
    if (end) sp.set('end', end);
    const qs = sp.toString();
    return mapRequest<MapUsageSummary>(`/usage/summary${qs ? `?${qs}` : ''}`);
  },

  /** Export usage CSV */
  exportUsage: () => mapDownload('/usage/export', 'usage.csv'),

  /** Call logs (server pagination, filterable by request_id / model / outcome; page starts at 1, pageSize max 200) */
  logs: (
    params: {
      requestId?: string;
      publicModel?: string;
      outcome?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const sp = new URLSearchParams();
    if (params.requestId) sp.set('request_id', params.requestId);
    if (params.publicModel) sp.set('public_model', params.publicModel);
    if (params.outcome) sp.set('outcome', params.outcome);
    sp.set('page', String(params.page ?? 1));
    sp.set('page_size', String(params.pageSize ?? 10));
    return mapRequest<{
      list: MapRequestLog[];
      total: number;
      page: number;
      page_size: number;
    }>(`/request-logs?${sp.toString()}`);
  },

  /** Public config (external base URL and similar) */
  publicConfig: () => mapRequest<MapPublicConfig>('/config/public'),

  // ===== Billing (current user) =====

  /** Current user's billing account (balance / quota / financial status) */
  billingAccount: () => mapRequest<MapBillingAccount>('/billing/account'),

  /** Trial credit packages the current user can spend, and other available credits */
  creditPackages: () => mapRequest<MapCreditPackageSnapshot>('/billing/credit-packages'),

  /** Current user's top-up history */
  recharges: () => mapRequest<{ list: MapRechargeRecord[] }>('/billing/recharges'),

  /** Daily check-in, invite code, and successful invite count */
  rewards: () => mapRequest<MapRewardStatus>('/rewards'),

  /** Claim today's check-in reward; the backend keeps it idempotent by business day and a unique index */
  claimDailyCheckin: () =>
    mapRequest<{ claimed: boolean; reward_points: string; balance: string }>(
      '/rewards/daily-checkins',
      { method: 'POST' },
    ),

  /** Current user's spend statistics (by model / trend, optional range) */
  spend: (start?: string, end?: string) => {
    const sp = new URLSearchParams();
    if (start) sp.set('start', start);
    if (end) sp.set('end', end);
    const qs = sp.toString();
    return mapRequest<MapSpendStats>(`/billing/spend${qs ? `?${qs}` : ''}`);
  },

  /** Call detail (including request/response body and metering) */
  callLogDetail: (requestId: string) =>
    mapRequest<MapCallLogDetail>(`/call-logs/${encodeURIComponent(requestId)}`),

  /** Current user's monthly bills (monthly snapshot of the current user's spend details) */
  monthlyBills: () => mapRequest<{ list: MapPortalMonthlyBill[] }>('/billing/monthly-bills'),

  /** Alert config list */
  alertConfigs: () => mapRequest<{ list: MapAlertConfig[] }>('/billing/alert-configs'),

  /** Create or update the alert config for a scope */
  upsertAlertConfig: (payload: MapAlertConfigInput) =>
    mapRequest<{ status: string }>('/billing/alert-configs', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  /** Submit a top-up request (no online payment; recorded for audit so an admin can handle it) */
  rechargeRequest: (payload: { amount: string; remark?: string; contact?: string }) =>
    mapRequest<{ status: string }>('/billing/recharge-request', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Start a Yeepay online payment order: returns the cashier URL, and the frontend redirects to pay (1 CNY = 1 balance unit) */
  yeepayOrder: (payload: { amount: string }) =>
    mapRequest<MapYeepayOrder>('/billing/yeepay/order', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // ===== Playground history conversations (private per user) =====

  /** History conversation list (server pagination; page starts at 1, pageSize max 100) */
  conversations: (params: { page?: number; pageSize?: number } = {}) => {
    const sp = new URLSearchParams();
    sp.set('page', String(params.page ?? 1));
    sp.set('page_size', String(params.pageSize ?? 20));
    return mapRequest<{
      list: MapConversation[];
      total: number;
      page: number;
      page_size: number;
    }>(`/conversations?${sp.toString()}`);
  },

  /** Create an empty conversation (returns conversation metadata, including id) */
  createConversation: (payload: { title?: string; model?: string } = {}) =>
    mapRequest<MapConversation>('/conversations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Fetch conversation detail (metadata plus message details) */
  getConversation: (id: string) =>
    mapRequest<MapConversationDetail>(`/conversations/${encodeURIComponent(id)}`),

  /** Save conversation messages by full overwrite */
  saveConversation: (id: string, payload: MapSaveConversationInput) =>
    mapRequest<{ status: string }>(`/conversations/${encodeURIComponent(id)}/messages`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  /** Delete a conversation (soft-delete) */
  deleteConversation: (id: string) =>
    mapRequest<{ status: string }>(`/conversations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  /** Submit experience-center conversation feedback (like/dislike) */
  submitFeedback: (payload: MapFeedbackInput) =>
    mapRequest<MapFeedback>('/feedback', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
