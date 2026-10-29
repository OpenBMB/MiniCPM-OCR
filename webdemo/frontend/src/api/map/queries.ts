import {
  useMutation,
  useQuery,
  useInfiniteQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { mapResourcesApi } from './resources';

/**
 * MAP 资源域的 TanStack Query 封装。
 *
 * 用途：把「服务端可缓存状态」（项目/Key/模型/用量/日志/限额）统一收敛为 query/mutation hooks，
 * 遵循 MAP 的 `example.query.ts` 范式（queryKey 工厂 + useXxxQuery/useXxxMutation），
 * 避免页面里散写 useState+useEffect 取数（AGENTS 硬规则 #4）。
 */

/** queryKey 工厂：集中管理 MAP 资源域的所有缓存键 */
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

/** 项目列表查询 */
export function useProjectsQuery() {
  return useQuery({ queryKey: mapKeys.projects(), queryFn: mapResourcesApi.projects });
}

/** 某项目下的 API Key 列表查询（projectId 为空时不发起） */
export function useKeysQuery(projectId: string) {
  return useQuery({
    queryKey: mapKeys.keys(projectId),
    queryFn: () => mapResourcesApi.keys(projectId),
    enabled: Boolean(projectId),
  });
}

/** 当前组织名下所有项目的 API Key 列表查询（跨项目，用于接入引导选 Key） */
export function useAllKeysQuery() {
  return useQuery({
    queryKey: mapKeys.keysAll(),
    queryFn: mapResourcesApi.keysAll,
    // 用户从 Keys 页创建后返回 Playground（或刷新）时必须重新读取，才能自动选中新 Key。
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/**
 * 某 API Key 的完整明文查询（后端 AES-GCM 解密）。
 *
 * 用途：接入示例按选中的 Key 回显真实明文。keyId 为空时不发起；明文敏感，不长期缓存
 * （staleTime/gcTime 设 0），且旧 Key 无密文时后端 409、query 进入 error 态供 UI 回退占位符。
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
 * Playground 免费体验状态查询。
 *
 * 返回值包含仅在内存中使用的体验 Key 明文；为避免敏感凭据跨页面残留，
 * 缓存策略与 Key 明文一致（staleTime/gcTime=0），失败不自动重试。
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

/** 可调用模型列表查询 */
export function useModelsQuery() {
  return useQuery({
    queryKey: mapKeys.models(),
    queryFn: mapResourcesApi.models,
    // 管理台与 Portal 是独立应用；切回 Playground 时刷新，及时获取模型能力开关变更。
    refetchOnWindowFocus: true,
  });
}

/** 当前用户私有音色列表查询。 */
export function useVoicesQuery(enabled = true) {
  return useQuery({
    queryKey: mapKeys.voices(),
    queryFn: mapResourcesApi.voices,
    enabled,
  });
}

/** 当前登录用户的产品功能权限查询。 */
export function useFeatureAccessQuery() {
  return useQuery({
    queryKey: mapKeys.featureAccess(),
    queryFn: mapResourcesApi.featureAccess,
  });
}

/** 上传私有音色并刷新音色列表 */
export function useCreateVoiceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { file: File; name?: string }) =>
      mapResourcesApi.createVoice(params.file, params.name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mapKeys.voices() }),
  });
}

/** 删除私有音色并刷新音色列表 */
export function useDeleteVoiceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (voiceId: string) => mapResourcesApi.deleteVoice(voiceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mapKeys.voices() }),
  });
}

/** 用量汇总查询 */
export function useUsageSummaryQuery(start?: string, end?: string) {
  return useQuery({
    queryKey: mapKeys.usageSummary(start, end),
    queryFn: () => mapResourcesApi.usageSummary(start, end),
  });
}

/** 调用日志查询（服务端分页，按 request_id / 模型 / 结果过滤；翻页时保留上一页数据避免闪烁） */
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

/** 公开配置查询 */
export function usePublicConfigQuery() {
  return useQuery({ queryKey: mapKeys.publicConfig(), queryFn: mapResourcesApi.publicConfig });
}

/** 本人计费账户查询 */
export function useBillingAccountQuery() {
  return useQuery({ queryKey: mapKeys.billingAccount(), queryFn: mapResourcesApi.billingAccount });
}

/** 本人体验额度包查询 */
export function useCreditPackagesQuery() {
  return useQuery({ queryKey: mapKeys.creditPackages(), queryFn: mapResourcesApi.creditPackages });
}

/** 本人充值流水查询 */
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

/** 本人花费统计查询（按区间） */
export function useSpendQuery(start: string, end: string) {
  return useQuery({
    queryKey: mapKeys.spend(start, end),
    queryFn: () => mapResourcesApi.spend(start, end),
    placeholderData: keepPreviousData,
  });
}

/** 调用详情查询（含正文，requestId 为空时不发起） */
export function useCallLogDetailQuery(requestId: string, enabled: boolean) {
  return useQuery({
    queryKey: mapKeys.callLogDetail(requestId),
    queryFn: () => mapResourcesApi.callLogDetail(requestId),
    enabled: enabled && Boolean(requestId),
  });
}

/** 本人月账单查询 */
export function useMonthlyBillsQuery() {
  return useQuery({ queryKey: mapKeys.monthlyBills(), queryFn: mapResourcesApi.monthlyBills });
}

/** 预警配置查询 */
export function useAlertConfigsQuery() {
  return useQuery({ queryKey: mapKeys.alertConfigs(), queryFn: mapResourcesApi.alertConfigs });
}

/** 创建项目（成功后失效项目列表缓存） */
export function useCreateProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => mapResourcesApi.createProject(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mapKeys.projects() }),
  });
}

/** 更新预警配置（成功后失效预警配置缓存） */
export function useUpsertAlertConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mapResourcesApi.upsertAlertConfig,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mapKeys.alertConfigs() }),
  });
}

/** 提交充值申请 */
export function useRechargeRequestMutation() {
  return useMutation({ mutationFn: mapResourcesApi.rechargeRequest });
}

/** 提交体验中心对话反馈（点赞/点踩），fire-and-forget，无需刷新缓存 */
export function useSubmitFeedbackMutation() {
  return useMutation({ mutationFn: mapResourcesApi.submitFeedback });
}

/** 发起易宝在线支付下单（成功后前端跳转 cashier_url，无需刷新本地缓存） */
export function useYeepayOrderMutation() {
  return useMutation({ mutationFn: mapResourcesApi.yeepayOrder });
}

// ===== Playground 历史对话 =====

/**
 * 历史对话分页查询：每页 20 条，由侧栏「加载更多对话」显式追加下一页。
 * 列表可能很多，一次性加载会卡顿/崩溃，故分页累积。
 */
export function useInfiniteConversationsQuery() {
  const pageSize = 20;
  return useInfiniteQuery({
    queryKey: [...mapKeys.conversations(), 'infinite'] as const,
    queryFn: ({ pageParam }) => mapResourcesApi.conversations({ page: pageParam, pageSize }),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      // 后端未部署/异常返回时字段可能缺失，做防御：拿不到合法分页信息即停止翻页
      if (!last || typeof last.total !== 'number' || typeof last.page !== 'number')
        return undefined;
      const loaded = last.page * (last.page_size || pageSize);
      return loaded < last.total ? last.page + 1 : undefined;
    },
  });
}

/** 单个会话详情查询（id 为空时不发起） */
export function useConversationQuery(id: string) {
  return useQuery({
    queryKey: mapKeys.conversation(id),
    queryFn: () => mapResourcesApi.getConversation(id),
    enabled: Boolean(id),
  });
}

/** 新建会话（成功后失效列表缓存） */
export function useCreateConversationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { title?: string; model?: string } = {}) =>
      mapResourcesApi.createConversation(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mapKeys.conversations() }),
  });
}

/** 保存会话消息（整段覆盖；成功后失效列表缓存以刷新标题/排序） */
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

/** 删除会话（成功后失效列表缓存） */
export function useDeleteConversationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mapResourcesApi.deleteConversation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mapKeys.conversations() }),
  });
}
