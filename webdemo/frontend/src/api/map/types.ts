/**
 * MAP（ModelBest API Platform）业务域类型。
 *
 * 用途：集中声明开发者门户用到的资源与认证相关类型，供 `api/map/*` 与各页面共享。
 * 由原 `web/portal/src/api.ts` 的类型迁移而来，字段与 MAP 后端契约保持一致。
 */

/** 项目（隶属某组织，API Key 绑定到项目而非用户） */
export interface MapProject {
  id: string;
  org_id: string;
  name: string;
  is_default: boolean;
  created_at: string;
}

/** API Key（仅返回前缀与元信息，明文 secret 仅创建/轮换时返回一次） */
export interface MapApiKey {
  id: string;
  project_id: string;
  /** 归属项目名，仅跨项目聚合查询（/keys）返回，用于在接入引导中标注 Key 所属项目 */
  project_name?: string;
  name: string;
  prefix: string;
  last4?: string;
  status: string;
  expires_at?: string;
  last_used_at?: string;
  created_at: string;
}

/** 模型显式配置的接入协议。 */
export type MapModelProtocol = 'openai' | 'anthropic' | 'document_parse';

/** 可调用的公开模型 */
export interface MapModel {
  id: string;
  display_name: string;
  /** 管理侧自定义模型参数量展示，例如 7B、1.5B、70B MoE */
  parameter_count?: string;
  context_window: number;
  max_output_tokens: number;
  capabilities: Record<string, boolean>;
  /** 管理端配置的模型级默认请求参数；空对象表示不注入默认值。 */
  parameter_config?: Record<string, unknown>;
  /** 输入价/1M（高精度 decimal 字符串）；未配置定价时缺省 */
  input_pricing?: string;
  /** 输出价/1M（高精度 decimal 字符串）；未配置定价时缺省 */
  output_pricing?: string;
  /** 限时免费：true 表示当前时间落在生效窗内、该模型按 0 计费（后端已按当前时间求值） */
  is_free?: boolean;
  /** 是否支持 Anthropic Messages 协议（/v1/messages 透传），供接入示例展示协议切换 */
  supports_anthropic?: boolean;
  /** 模型显式配置的接入协议；空数组表示未定义标准接入协议 */
  protocols?: MapModelProtocol[];
}

/** Playground 免费体验类型；每类独立计数，用完后回退用户自有 API Key。 */
export type PlaygroundTrialExperience = 'language' | 'tts' | 'realtime' | 'image-parse';

/** Playground 免费体验状态；secret 仅内存使用，不持久化。 */
export interface MapPlaygroundTrial {
  remaining: Record<PlaygroundTrialExperience, number>;
  api_key_id?: string;
  project_id?: string;
  secret?: string;
}

/** 单条调用日志（请求级审计记录） */
export interface MapRequestLog {
  request_id: string;
  public_model: string;
  status_code: number;
  outcome: string;
  error_type?: string;
  latency_ms: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_tokens?: number;
  total_tokens: number;
  /** 本次调用费用快照（decimal 字符串） */
  cost?: string;
  created_at: string;
}

/** 公开配置（无需鉴权即可获取，如对外 Base URL） */
export interface MapPublicConfig {
  api_base_url: string;
}

/** 当前登录用户拥有的私有音色资源。 */
export interface MapVoiceResource {
  id: string;
  name: string;
  content_type: 'audio/wav';
  file_bytes: number;
  status: 'ready' | 'deleted';
  audio_url: string;
  created_at: string;
  updated_at: string;
}

/** 当前登录用户可访问的产品功能。 */
export interface MapFeatureAccess {
  voice_clone: boolean;
}

/** 门户用户信息 */
export interface MapPortalUser {
  id: string;
  email: string;
  phone: string;
  /** 唯一登录用户名（可作登录标识之一）；name 为可改的展示昵称、不唯一 */
  username: string;
  name: string;
  org_type: string;
  /** 组织状态：pending（待审核）/ active（已启用）/ disabled（已禁用） */
  org_status: 'pending' | 'active' | 'disabled';
  /** 账号是否启用；false 时无法登录（正常不会出现在已登录态） */
  account_enabled: boolean;
  /** 组织角色（external_owner 等），用于门户内项目/Key 写权限 */
  role: string;
  /** 平台角色：user（仅 Portal）/ admin / operator（可进 Admin 后台），决定是否显示「进入管理台」 */
  platform_role: string;
  default_project_id: string;
  email_verified: boolean;
  phone_verified: boolean;
  /** 是否已设置登录密码；未设置时账号安全页显示「设置密码」且无需当前密码 */
  has_password: boolean;
  /** 当前登录会话是否要求先绑定中国大陆手机号 */
  phone_binding_required?: boolean;
}

/** 认证响应（登录/注册/找回等共用，按场景返回不同字段） */
export interface MapAuthResponse {
  token?: string;
  user?: MapPortalUser;
  /** 密码登录的新 IP 需要二次验证时返回 true；此时不会下发 token。 */
  step_up_required?: boolean;
  /** 一次性密码登录二次验证令牌。 */
  challenge_token?: string;
  /** 二次验证验证码发送渠道。 */
  verification_channel?: 'phone' | 'email';
  /** 二次验证验证码投递状态：queued 表示已入队等待发送，sent 表示已同步发送。 */
  notification_status?: 'queued' | 'sent' | 'failed';
  verification_required?: boolean;
  verification_token?: string;
  reset_token?: string;
  /** 非生产环境回显的短信验证码 */
  code?: string;
  expires_in_seconds?: number;
  is_new_user?: boolean;
}

/** 用量汇总（各维度 token 与请求数，键为后端动态返回的指标名） */
export type MapUsageSummary = Record<string, number>;

// 滑块人机验证题目为 portal/admin 共享契约，统一收口到 @map/types。
export type { CaptchaChallengeDTO } from '@map/types';

/** 本人计费账户（余额 / 额度 / 财务状态） */
export interface MapBillingAccount {
  billing_enabled: boolean;
  balance: string;
  total_recharge?: string;
  financial_status?: string;
  overdraft_limit?: string;
  monthly_quota?: { Decimal: string; Valid: boolean } | null;
  daily_quota?: { Decimal: string; Valid: boolean } | null;
  /** 本月已用花费（decimal 字符串） */
  month_spend?: string;
  /** 今日已用花费（decimal 字符串） */
  today_spend?: string;
}

/** 本人体验额度包；当前仅返回带有效期的注册赠送积分。 */
export interface MapCreditPackage {
  id: string;
  source_type: 'SIGNUP_GRANT';
  original_amount: string;
  remaining_amount: string;
  expires_at: string;
  expired_amount: string;
  status: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'USED_UP';
  created_at: string;
}

/** 本人额度快照：新用户体验额度包与其它可用积分。 */
export interface MapCreditPackageSnapshot {
  list: MapCreditPackage[];
  other_available_balance: string;
}

/** 额度/余额预警配置（每用户每 scope 一条） */
export interface MapAlertConfig {
  id?: string;
  scope: 'BALANCE' | 'MONTHLY' | 'DAILY';
  enabled: boolean;
  rule_mode: 'PERCENT' | 'AMOUNT';
  threshold_percent?: number | null;
  threshold_amount?: { Decimal: string; Valid: boolean } | null;
  channel?: string;
  updated_at?: string;
}

/** 预警配置写入参数 */
export interface MapAlertConfigInput {
  scope: 'BALANCE' | 'MONTHLY' | 'DAILY';
  enabled: boolean;
  rule_mode: 'PERCENT' | 'AMOUNT';
  threshold_percent?: number | null;
  threshold_amount?: string | null;
  channel?: string;
}

/** 本人月账单明细快照 */
export interface MapPortalMonthlyBill {
  bill_month: string;
  status: string;
  generated_time: string;
  prompt_tokens: number;
  completion_tokens: number;
  cache_tokens: number;
  total_tokens: number;
  call_count: number;
  success_count: number;
  cost: string;
}

/** 充值流水 */
/** 积分流水记录类型：管理员赠送 / 注册赠送 / 活动奖励 / 管理员扣减冲正 / 用户自助充值 */
export type MapRechargeRecordType =
  | 'ADMIN_GRANT'
  | 'SIGNUP_GRANT'
  | 'SIGNUP_GRANT_EXPIRED'
  | 'DAILY_CHECKIN_GRANT'
  | 'REFERRAL_GRANT'
  | 'DEDUCT'
  | 'SELF_RECHARGE'
  | 'VOICE_CREATE';

export interface MapRewardStatus {
  daily_checkin_enabled: boolean;
  daily_checkin_points: string;
  claimed_today: boolean;
  reward_date: string;
  referral_enabled: boolean;
  referral_reward_points: string;
  invitation_code: string;
  successful_referrals: number;
}

export interface MapRechargeRecord {
  id: string;
  recharge_amount: string;
  balance_snapshot?: { Decimal: string; Valid: boolean } | null;
  remark?: string;
  record_type: MapRechargeRecordType;
  recharge_time: string;
}

/** 易宝在线支付下单结果：cashier_url 为收银台跳转地址，order_id 为商户订单号 */
export interface MapYeepayOrder {
  cashier_url: string;
  order_id: string;
}

/** 按模型花费 */
export interface MapModelSpend {
  public_model: string;
  cost: string;
  total_tokens: number;
  call_count: number;
}

/** 按日花费 */
export interface MapDailySpend {
  stat_date: string;
  cost: string;
  total_tokens: number;
  call_count: number;
}

/** 按模型聚合的日趋势 */
export interface MapModelSpendTrend {
  public_model: string;
  trend: MapDailySpend[];
}

/** 本人花费统计总览 */
export interface MapSpendSummary {
  total_cost: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  cache_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  call_count: number;
  success_count: number;
  success_rate: string;
  input_cost: string;
  cache_creation_cost: string;
  cache_read_cost: string;
  output_cost: string;
}

/** 本人花费统计响应 */
export interface MapSpendStats {
  start: string;
  end: string;
  summary: MapSpendSummary;
  by_model: MapModelSpend[];
  trend: MapDailySpend[];
  model_trends?: MapModelSpendTrend[];
}

/** 调用计量明细 */
export interface MapCallMetering {
  request_id: string;
  public_model: string;
  primary_meter_type: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_tokens: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  input_cost?: string;
  cache_creation_cost?: string;
  cache_read_cost?: string;
  output_cost?: string;
  cost: string;
}

/** 调用详情（含请求/响应正文与计量） */
export interface MapCallLogDetail extends MapRequestLog {
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_tokens?: number;
  cost?: string;
  request_content: string;
  response_content: string;
  metering?: MapCallMetering | null;
}

// ===== Playground 历史对话（每用户私有）=====
// 这组 DTO 拆到 types.conversations.ts，两个文件才都在类型文件 500 行的硬上限内；
// 在此原样再导出，调用方无论走 './types' 还是 '@/api/map' 都不受影响。

export type {
  MapConversation,
  MapConversationDetail,
  MapSaveConversationInput,
  MapStoredMessage,
  MapStoredVersion,
  ToolEventDTO,
} from './types.conversations';

/** 提交对话反馈的请求体（点赞/点踩） */
export interface MapFeedbackInput {
  /** 关联会话 id（新对话未保存时可省略） */
  conversation_id?: string;
  /** 被反馈回答对应的平台 L2 请求 ID */
  request_id?: string;
  /** 被反馈回答对应的客户端关联 ID，用于服务端精确回查平台请求 ID */
  client_request_id?: string;
  /** 被反馈回答实际使用的 API Key ID，用于限定关联范围 */
  api_key_id?: string;
  /** 反馈时所用模型（= MapModel.id / public_model） */
  public_model: string;
  /** 反馈类型：赞 up / 踩 down */
  feedback_type: 'up' | 'down';
  /** 原因标签（点踩可选，点赞为空数组） */
  reasons: string[];
  /** 反馈正文（点踩可选填写） */
  comment?: string;
  /** 问题快照（该回答对应的用户提问） */
  question: string;
  /** 回答快照（被反馈的助手正文） */
  answer: string;
}

/** 提交反馈的返回（落库后的记录元信息） */
export interface MapFeedback {
  id: string;
  feedback_type: 'up' | 'down';
  created_at: string;
}
