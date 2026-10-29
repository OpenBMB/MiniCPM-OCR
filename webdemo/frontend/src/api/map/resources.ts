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
 * MAP 资源 API。
 *
 * 用途：开发者门户的项目 / API Key / 模型 / 用量 / 日志 / 限额等资源读写，统一经 `mapRequest`
 * 直发 MAP 后端（裸 JSON）。这些是「服务端可缓存状态」，页面侧用 TanStack Query 包裹获取。
 * 由原 `web/portal/src/api.ts` 的 `client` 资源段迁移而来。
 */
export const mapResourcesApi = {
  /** 项目列表 */
  projects: () => mapRequest<{ list: MapProject[] }>('/projects'),

  /** 创建项目 */
  createProject: (name: string) =>
    mapRequest<MapProject>('/projects', { method: 'POST', body: JSON.stringify({ name }) }),

  /** 某项目下的 API Key 列表 */
  keys: (projectId: string) => mapRequest<{ list: MapApiKey[] }>(`/projects/${projectId}/keys`),

  /** 当前组织名下所有项目的 API Key（跨项目，带 project_name 标注归属） */
  keysAll: () => mapRequest<{ list: MapApiKey[] }>('/keys'),

  /** 在某项目下创建 API Key（返回明文 secret，仅此一次） */
  createKey: (projectId: string, payload: { name: string; expires_at?: string }) =>
    mapRequest<{ api_key: MapApiKey; secret: string }>(`/projects/${projectId}/keys`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 启用 / 禁用某 API Key */
  setKeyStatus: (keyId: string, status: 'active' | 'disabled') =>
    mapRequest<{ status: string }>(`/keys/${keyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  /** 删除某 API Key */
  deleteKey: (keyId: string) =>
    mapRequest<{ status: string }>(`/keys/${keyId}`, { method: 'DELETE' }),

  /** 轮换某 API Key（旧密钥立即失效，返回新明文 secret） */
  rotateKey: (keyId: string) =>
    mapRequest<{ secret: string; prefix: string }>(`/keys/${keyId}/rotate`, { method: 'POST' }),

  /** 取某 API Key 的完整明文（后端 AES-GCM 解密；旧 Key 无密文时返回 409） */
  revealKeySecret: (keyId: string) => mapRequest<{ secret: string }>(`/keys/${keyId}/secret`),

  /** 可调用模型列表 */
  models: () => mapRequest<{ list: MapModel[] }>('/models'),

  /** 当前用户 Playground 四类免费体验剩余次数与内部体验凭据 */
  playgroundTrial: () => mapRequest<MapPlaygroundTrial>('/playground/trial'),

  /** 当前用户的私有音色列表 */
  voices: () => mapRequest<{ list: MapVoiceResource[] }>('/voices'),

  /** 当前登录用户可使用的产品功能 */
  featureAccess: () => mapRequest<MapFeatureAccess>('/feature-access'),

  /** 上传并保存一条私有 WAV 音色 */
  createVoice: (file: File, name?: string, idempotencyKey = crypto.randomUUID()) => {
    const form = new FormData();
    form.append('file', file);
    if (name?.trim()) form.append('name', name.trim());
    return mapUpload<MapVoiceResource>('/voices', form, { 'Idempotency-Key': idempotencyKey });
  },

  /** 删除当前用户自己的音色 */
  deleteVoice: (voiceId: string) =>
    mapRequest<{ status: string }>(`/voices/${encodeURIComponent(voiceId)}`, {
      method: 'DELETE',
    }),

  /** 用量汇总（可指定区间） */
  usageSummary: (start?: string, end?: string) => {
    const sp = new URLSearchParams();
    if (start) sp.set('start', start);
    if (end) sp.set('end', end);
    const qs = sp.toString();
    return mapRequest<MapUsageSummary>(`/usage/summary${qs ? `?${qs}` : ''}`);
  },

  /** 导出用量 CSV */
  exportUsage: () => mapDownload('/usage/export', 'usage.csv'),

  /** 调用日志（服务端分页，可按 request_id / 模型 / 结果过滤；page 从 1 起，pageSize 上限 200） */
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

  /** 公开配置（对外 Base URL 等） */
  publicConfig: () => mapRequest<MapPublicConfig>('/config/public'),

  // ===== 计费（本人视角）=====

  /** 本人计费账户（余额/额度/财务状态） */
  billingAccount: () => mapRequest<MapBillingAccount>('/billing/account'),

  /** 本人可消费体验额度包与其它可用积分 */
  creditPackages: () => mapRequest<MapCreditPackageSnapshot>('/billing/credit-packages'),

  /** 本人充值流水 */
  recharges: () => mapRequest<{ list: MapRechargeRecord[] }>('/billing/recharges'),

  /** 每日签到、邀请码和成功邀请数 */
  rewards: () => mapRequest<MapRewardStatus>('/rewards'),

  /** 领取当天签到奖励；后端按业务日和唯一索引保证幂等 */
  claimDailyCheckin: () =>
    mapRequest<{ claimed: boolean; reward_points: string; balance: string }>(
      '/rewards/daily-checkins',
      { method: 'POST' },
    ),

  /** 本人花费统计（按模型/趋势，可指定区间） */
  spend: (start?: string, end?: string) => {
    const sp = new URLSearchParams();
    if (start) sp.set('start', start);
    if (end) sp.set('end', end);
    const qs = sp.toString();
    return mapRequest<MapSpendStats>(`/billing/spend${qs ? `?${qs}` : ''}`);
  },

  /** 调用详情（含请求/响应正文与计量） */
  callLogDetail: (requestId: string) =>
    mapRequest<MapCallLogDetail>(`/call-logs/${encodeURIComponent(requestId)}`),

  /** 本人月账单（按月本人花费明细快照） */
  monthlyBills: () => mapRequest<{ list: MapPortalMonthlyBill[] }>('/billing/monthly-bills'),

  /** 预警配置列表 */
  alertConfigs: () => mapRequest<{ list: MapAlertConfig[] }>('/billing/alert-configs'),

  /** 新增/更新某 scope 预警配置 */
  upsertAlertConfig: (payload: MapAlertConfigInput) =>
    mapRequest<{ status: string }>('/billing/alert-configs', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  /** 提交充值申请（无在线支付，记审计供管理员处理） */
  rechargeRequest: (payload: { amount: string; remark?: string; contact?: string }) =>
    mapRequest<{ status: string }>('/billing/recharge-request', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 发起易宝在线支付下单：返回收银台 URL，前端跳转付款（1 元 = 1 余额） */
  yeepayOrder: (payload: { amount: string }) =>
    mapRequest<MapYeepayOrder>('/billing/yeepay/order', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // ===== Playground 历史对话（每用户私有）=====

  /** 历史对话列表（服务端分页；page 从 1 起，pageSize 上限 100） */
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

  /** 新建空会话（返回会话元信息，含 id） */
  createConversation: (payload: { title?: string; model?: string } = {}) =>
    mapRequest<MapConversation>('/conversations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 取会话详情（元信息 + 消息明细） */
  getConversation: (id: string) =>
    mapRequest<MapConversationDetail>(`/conversations/${encodeURIComponent(id)}`),

  /** 整段覆盖式保存会话消息 */
  saveConversation: (id: string, payload: MapSaveConversationInput) =>
    mapRequest<{ status: string }>(`/conversations/${encodeURIComponent(id)}/messages`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  /** 删除会话（软删） */
  deleteConversation: (id: string) =>
    mapRequest<{ status: string }>(`/conversations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  /** 提交体验中心对话反馈（点赞/点踩） */
  submitFeedback: (payload: MapFeedbackInput) =>
    mapRequest<MapFeedback>('/feedback', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
