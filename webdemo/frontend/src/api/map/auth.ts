import { mapRequest } from './request';
import type { CaptchaChallengeDTO, MapAuthResponse, MapPortalUser } from './types';

/**
 * MAP 认证 API。
 *
 * 用途：开发者门户的注册 / 登录 / 验证码 / 找回密码等认证动作，全部由 `mapRequest` 直发
 * MAP 后端（裸 JSON）。这些是命令式一次性动作，调用方用 ahooks/useApi 或 mutation 触发，
 * 不进 TanStack Query 缓存。由原 `web/portal/src/api.ts` 的 `client` 认证段迁移而来。
 */
export const mapAuthApi = {
  /** 探测公共配置（是否启用人机验证、门户飞连登录、第三方登录等），无需鉴权 */
  publicConfig: () =>
    mapRequest<{
      feilian_enabled: boolean;
      portal_feilian_enabled: boolean;
      captcha_enabled: boolean;
      phone_login_enabled: boolean;
      password_login_enabled: boolean;
      email_login_enabled: boolean;
      phone_binding_required: boolean;
      google_enabled: boolean;
      github_enabled: boolean;
      wechat_enabled: boolean;
    }>('/auth/config'),

  /** 获取一道滑块人机验证题（答案只存服务端） */
  getCaptcha: () => mapRequest<CaptchaChallengeDTO>('/auth/captcha', { method: 'POST' }),

  /** 校验滑块落点，通过后服务端写一次性通行凭证（用题目 id 作为凭证 id） */
  verifyCaptcha: (payload: { id: string; x: number; y: number }) =>
    mapRequest<{ id: string; passed: boolean }>('/auth/captcha/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 注册（手机号 + 验证码 + 密码） */
  register: (payload: { phone: string; code: string; name?: string; password: string; referral_code?: string }) =>
    mapRequest<MapAuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 校验邮箱验证令牌 */
  verifyEmail: (token: string) =>
    mapRequest<{ token: string; user: MapPortalUser }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  /** 重发邮箱验证邮件 */
  resendVerification: (email: string) =>
    mapRequest<MapAuthResponse>('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  /** 账号密码登录（账号支持手机号或邮箱）。captchaId 为人机验证通行凭证 */
  login: (payload: { account: string; password: string; captchaId?: string }) =>
    mapRequest<MapAuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        account: payload.account,
        password: payload.password,
        captcha_id: payload.captchaId,
      }),
    }),

  /** 密码登录的新 IP 二次验证通过后签发登录态 */
  verifyPasswordLogin: (payload: { challenge_token: string; code: string }) =>
    mapRequest<MapAuthResponse>('/auth/password-login/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 重发密码登录的新 IP 二次验证码 */
  resendPasswordLogin: (payload: { challenge_token: string }) =>
    mapRequest<MapAuthResponse>('/auth/password-login/resend', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 发送短信验证码。captchaId 为人机验证通行凭证 */
  sendSMSCode: (phone: string, captchaId?: string) =>
    mapRequest<MapAuthResponse>('/auth/sms-code', {
      method: 'POST',
      body: JSON.stringify({ phone, captcha_id: captchaId }),
    }),

  /** 发送邮箱验证码（注册/登录/找回密码共用，验证码只通过邮件发送）。captchaId 为人机验证通行凭证 */
  sendEmailCode: (email: string, captchaId?: string) =>
    mapRequest<MapAuthResponse>('/auth/email-code', {
      method: 'POST',
      body: JSON.stringify({ email, captcha_id: captchaId }),
    }),

  /** 邮箱 + 验证码登录（未注册邮箱将自动注册） */
  emailLogin: (payload: { email: string; code: string; name?: string; referral_code?: string }) =>
    mapRequest<MapAuthResponse>('/auth/email-login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 邮箱 + 验证码 + 密码注册 */
  emailRegister: (payload: { email: string; code: string; name?: string; password: string; referral_code?: string }) =>
    mapRequest<MapAuthResponse>('/auth/email-register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 手机号 + 验证码登录（未注册手机号将自动注册） */
  phoneLogin: (payload: { phone: string; code: string; name?: string; referral_code?: string }) =>
    mapRequest<MapAuthResponse>('/auth/phone-login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 发起找回密码，返回重置令牌。captchaId 为人机验证通行凭证 */
  forgotPassword: (email: string, captchaId?: string) =>
    mapRequest<MapAuthResponse>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email, captcha_id: captchaId }),
    }),

  /** 用重置令牌设置新密码（邮箱找回） */
  resetPassword: (payload: { token: string; password: string }) =>
    mapRequest<{ status: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 手机号 + 短信验证码重置密码（短信找回，复用 /auth/sms-code 下发的验证码） */
  resetPasswordBySms: (payload: { phone: string; code: string; password: string }) =>
    mapRequest<{ status: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 邮箱 + 验证码重置密码（邮箱找回，复用 /auth/email-code 下发的验证码，与手机找回对称） */
  resetPasswordByEmailCode: (payload: { email: string; code: string; password: string }) =>
    mapRequest<{ status: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 退出登录 */
  logout: () => mapRequest<{ status: string }>('/auth/logout', { method: 'POST' }),

  /** 获取当前登录用户信息 */
  me: () => mapRequest<MapPortalUser>('/me'),

  /** 注销（软删除）当前账号 */
  deleteAccount: () => mapRequest<{ status: string }>('/me', { method: 'DELETE' }),

  /** 登录态设置或修改密码；提供 current_password 时校验旧密码 */
  updatePassword: (payload: { current_password?: string; password: string }) =>
    mapRequest<{ status: string; token?: string }>('/me/password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 登录态修改昵称（name）与/或用户名（username） */
  updateProfile: (payload: { name?: string; username?: string }) =>
    mapRequest<MapPortalUser>('/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  /** 登录态绑定邮箱（需先经 sendEmailCode 拿验证码） */
  bindEmail: (payload: { email: string; code: string }) =>
    mapRequest<MapPortalUser>('/me/email', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 登录态发送手机号绑定验证码；captchaId 为人机验证通行凭证 */
  sendPhoneBindCode: (phone: string, captchaId?: string) =>
    mapRequest<MapAuthResponse>('/me/phone/code', {
      method: 'POST',
      body: JSON.stringify({ phone, captcha_id: captchaId }),
    }),

  /** 登录态绑定手机号（需先经 sendPhoneBindCode 获取专用验证码） */
  bindPhone: (payload: { phone: string; code: string }) =>
    mapRequest<MapPortalUser>('/me/phone', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

/**
 * 飞连（Feilian）SSO 门户登录入口（仅测试环境启用，由后端 feilian_enabled 开关驱动）。
 *
 * 整页跳转到后端 `/auth/feilian/login?target=portal`，后端 302 跳飞连授权页；授权后飞连
 * 回调后端 `/admin/auth/callback`（与管理台复用同一 redirect_uri，靠 state 里的 target 区分），
 * 后端按邮箱 upsert 门户用户并签发用户 JWT，以 URL fragment（`#token=...`）回跳门户登录页。
 *
 * 路径前缀与 mapRequest 对齐：dev 走 `/api`（Vite 代理去前缀转发到后端），生产同源直连
 * 网关 `/auth` 路由。飞连是整页导航，不走 fetch，故此处单独拼前缀而非用 mapRequest。
 */
export function feilianLogin(): void {
  const base = import.meta.env.DEV ? '/api' : '';
  window.location.assign(`${base}/auth/feilian/login?target=portal`);
}

/** 第三方登录提供方标识：与后端 /auth/oauth/{provider}/login 的 path 参数一致。 */
export type OAuthProvider = 'google' | 'github' | 'wechat';

/**
 * 第三方（社会化）登录入口：Google / GitHub / 微信。
 *
 * 整页跳转到后端 `/auth/oauth/{provider}/login?target=portal`，后端 302 跳对应授权页；
 * 授权后回调后端 `/auth/oauth/{provider}/callback`，后端换 token、拉 userinfo、幂等建号/绑定，
 * 并以 URL fragment（`#token=...`）把用户 JWT 回跳门户登录页（与飞连回跳同构，前端复用同一处理）。
 * 路径前缀与 feilianLogin 对齐：dev 走 `/api`（Vite 代理去前缀），生产同源直连网关 `/auth`。
 */
export function oauthLogin(provider: OAuthProvider): void {
  const base = import.meta.env.DEV ? '/api' : '';
  window.location.assign(`${base}/auth/oauth/${provider}/login?target=portal`);
}
