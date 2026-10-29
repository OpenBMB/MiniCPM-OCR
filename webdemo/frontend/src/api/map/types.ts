/**
 * MAP (ModelBest API Platform) domain types.
 *
 * Purpose: declare the resource and auth types used by the developer portal, shared by `api/map/*` and the pages.
 * Migrated from the types in the original `web/portal/src/api.ts`. Fields stay aligned with the MAP backend contract.
 */

/** Project (belongs to an organization; an API Key is bound to a project, not a user) */
export interface MapProject {
  id: string;
  org_id: string;
  name: string;
  is_default: boolean;
  created_at: string;
}

/** API Key (only the prefix and metadata are returned; the plaintext secret is returned once, on create or rotate) */
export interface MapApiKey {
  id: string;
  project_id: string;
  /** Owning project name, returned only by the cross-project aggregate query (/keys), used in onboarding to label which project a key belongs to */
  project_name?: string;
  name: string;
  prefix: string;
  last4?: string;
  status: string;
  expires_at?: string;
  last_used_at?: string;
  created_at: string;
}

/** Access protocol explicitly configured for a model. */
export type MapModelProtocol = 'openai' | 'anthropic' | 'document_parse';

/** Public model that can be called */
export interface MapModel {
  id: string;
  display_name: string;
  /** Admin-defined parameter-count display, for example 7B, 1.5B, 70B MoE */
  parameter_count?: string;
  context_window: number;
  max_output_tokens: number;
  capabilities: Record<string, boolean>;
  /** Model-level default request parameters configured in admin; an empty object means no defaults are injected. */
  parameter_config?: Record<string, unknown>;
  /** Input price per 1M (high-precision decimal string); omitted when pricing is not configured */
  input_pricing?: string;
  /** Output price per 1M (high-precision decimal string); omitted when pricing is not configured */
  output_pricing?: string;
  /** Limited-time free: true means the current time is inside the effective window and the model is billed at 0 (the backend already evaluated the current time) */
  is_free?: boolean;
  /** Whether Anthropic Messages is supported (/v1/messages pass-through), so onboarding examples can show the protocol switch */
  supports_anthropic?: boolean;
  /** Access protocols explicitly configured for the model; an empty array means no standard access protocol is defined */
  protocols?: MapModelProtocol[];
}

/** Playground free-trial type; each type is counted separately, and after it is used up the flow falls back to the user's own API Key. */
export type PlaygroundTrialExperience = 'language' | 'tts' | 'realtime' | 'image-parse';

/** Playground free-trial status; secret is used in memory only and is not persisted. */
export interface MapPlaygroundTrial {
  remaining: Record<PlaygroundTrialExperience, number>;
  api_key_id?: string;
  project_id?: string;
  secret?: string;
}

/** One call log (request-level audit record) */
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
  /** Cost snapshot for this call (decimal string) */
  cost?: string;
  created_at: string;
}

/** Public config (available without auth, such as the external base URL) */
export interface MapPublicConfig {
  api_base_url: string;
}

/** Private voice resource owned by the currently logged-in user. */
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

/** Product features the currently logged-in user can access. */
export interface MapFeatureAccess {
  voice_clone: boolean;
}

/** Portal user info */
export interface MapPortalUser {
  id: string;
  email: string;
  phone: string;
  /** Unique login username (one possible login identifier); name is a changeable display nickname and is not unique */
  username: string;
  name: string;
  org_type: string;
  /** Organization status: pending (awaiting review) / active (enabled) / disabled (disabled) */
  org_status: 'pending' | 'active' | 'disabled';
  /** Whether the account is enabled; false cannot log in (it normally does not appear in a logged-in session) */
  account_enabled: boolean;
  /** Organization role (external_owner and others), used for project/key write permission inside the portal */
  role: string;
  /** Platform role: user (Portal only) / admin / operator (can enter the Admin console), which decides whether Enter admin console is shown */
  platform_role: string;
  default_project_id: string;
  email_verified: boolean;
  phone_verified: boolean;
  /** Whether a login password has been set; when it has not, the account security page shows Set password and does not ask for the current password */
  has_password: boolean;
  /** Whether the current login session requires binding a mainland China phone number first */
  phone_binding_required?: boolean;
}

/** Auth response (shared by login, register, recovery, and similar; fields vary by scenario) */
export interface MapAuthResponse {
  token?: string;
  user?: MapPortalUser;
  /** True when a new IP for password login needs a second verification; no token is issued in that case. */
  step_up_required?: boolean;
  /** One-time second-verification token for password login. */
  challenge_token?: string;
  /** Channel used to send the second-verification code. */
  verification_channel?: 'phone' | 'email';
  /** Second-verification code delivery status: queued means waiting to send, sent means it was sent synchronously. */
  notification_status?: 'queued' | 'sent' | 'failed';
  verification_required?: boolean;
  verification_token?: string;
  reset_token?: string;
  /** SMS verification code echoed in non-production */
  code?: string;
  expires_in_seconds?: number;
  is_new_user?: boolean;
}

/** Usage summary (token and request counts by dimension; keys are metric names returned dynamically by the backend) */
export type MapUsageSummary = Record<string, number>;

// The slider human-verification challenge is a shared portal/admin contract, consolidated in @map/types.
export type { CaptchaChallengeDTO } from '@map/types';

/** Current user's billing account (balance / quota / financial status) */
export interface MapBillingAccount {
  billing_enabled: boolean;
  balance: string;
  total_recharge?: string;
  financial_status?: string;
  overdraft_limit?: string;
  monthly_quota?: { Decimal: string; Valid: boolean } | null;
  daily_quota?: { Decimal: string; Valid: boolean } | null;
  /** Spend used this month (decimal string) */
  month_spend?: string;
  /** Spend used today (decimal string) */
  today_spend?: string;
}

/** Current user's trial credit package; currently only signup grant credits with an expiry are returned. */
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

/** Current user's credit snapshot: the new-user trial credit package and other available credits. */
export interface MapCreditPackageSnapshot {
  list: MapCreditPackage[];
  other_available_balance: string;
}

/** Quota/balance alert config (one per user per scope) */
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

/** Alert config write parameters */
export interface MapAlertConfigInput {
  scope: 'BALANCE' | 'MONTHLY' | 'DAILY';
  enabled: boolean;
  rule_mode: 'PERCENT' | 'AMOUNT';
  threshold_percent?: number | null;
  threshold_amount?: string | null;
  channel?: string;
}

/** Current user's monthly bill detail snapshot */
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

/** Top-up history */
/** Credit ledger record type: admin grant / signup grant / campaign reward / admin deduction reversal / user self-service top-up */
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

/** Yeepay online payment order result: cashier_url is the cashier redirect URL, and order_id is the merchant order id */
export interface MapYeepayOrder {
  cashier_url: string;
  order_id: string;
}

/** Spend by model */
export interface MapModelSpend {
  public_model: string;
  cost: string;
  total_tokens: number;
  call_count: number;
}

/** Spend by day */
export interface MapDailySpend {
  stat_date: string;
  cost: string;
  total_tokens: number;
  call_count: number;
}

/** Daily trend aggregated by model */
export interface MapModelSpendTrend {
  public_model: string;
  trend: MapDailySpend[];
}

/** Current user's spend statistics overview */
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

/** Current user's spend statistics response */
export interface MapSpendStats {
  start: string;
  end: string;
  summary: MapSpendSummary;
  by_model: MapModelSpend[];
  trend: MapDailySpend[];
  model_trends?: MapModelSpendTrend[];
}

/** Call metering detail */
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

/** Call detail (including request/response body and metering) */
export interface MapCallLogDetail extends MapRequestLog {
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_tokens?: number;
  cost?: string;
  request_content: string;
  response_content: string;
  metering?: MapCallMetering | null;
}

// ===== Playground history conversations (private per user) =====
// These DTOs were split into types.conversations.ts so both files stay within the 500-line hard limit for type files;
// they are re-exported here unchanged, so callers of './types' or '@/api/map' are unaffected.

export type {
  MapConversation,
  MapConversationDetail,
  MapSaveConversationInput,
  MapStoredMessage,
  MapStoredVersion,
  ToolEventDTO,
} from './types.conversations';

/** Request body for submitting conversation feedback (like/dislike) */
export interface MapFeedbackInput {
  /** Related conversation id (may be omitted when a new conversation has not been saved) */
  conversation_id?: string;
  /** Platform L2 request ID of the answer being rated */
  request_id?: string;
  /** Client correlation ID of the answer being rated, used by the server to look up the platform request ID precisely */
  client_request_id?: string;
  /** API Key ID actually used by the answer being rated, used to limit the correlation scope */
  api_key_id?: string;
  /** Model used when the feedback was submitted (= MapModel.id / public_model) */
  public_model: string;
  /** Feedback type: like is up / dislike is down */
  feedback_type: 'up' | 'down';
  /** Reason tags (optional for dislike, empty array for like) */
  reasons: string[];
  /** Feedback body (optional text for dislike) */
  comment?: string;
  /** Question snapshot (the user question for this answer) */
  question: string;
  /** Answer snapshot (the assistant body being rated) */
  answer: string;
}

/** Feedback submit response (record metadata after it is stored) */
export interface MapFeedback {
  id: string;
  feedback_type: 'up' | 'down';
  created_at: string;
}
