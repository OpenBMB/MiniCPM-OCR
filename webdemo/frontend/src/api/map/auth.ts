import { mapRequest } from './request';
import type { CaptchaChallengeDTO, MapAuthResponse, MapPortalUser } from './types';

/**
 * MAP auth API.
 *
 * Purpose: developer-portal auth actions such as register, login, verification code, and password recovery are all sent by `mapRequest`
 * directly to the MAP backend (raw JSON). These are imperative one-shot actions. Callers trigger them with ahooks/useApi or a mutation,
 * and they do not enter the TanStack Query cache. Migrated from the `client` auth section of the original `web/portal/src/api.ts`.
 */
export const mapAuthApi = {
  /** Probe public config (whether human verification, portal Feilian login, third-party login, and similar are enabled); no auth required */
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

  /** Fetch one slider human-verification challenge (the answer is stored only on the server) */
  getCaptcha: () => mapRequest<CaptchaChallengeDTO>('/auth/captcha', { method: 'POST' }),

  /** Check the slider drop point; on success the server writes a one-time pass (the challenge id is the pass id) */
  verifyCaptcha: (payload: { id: string; x: number; y: number }) =>
    mapRequest<{ id: string; passed: boolean }>('/auth/captcha/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Register (phone number + verification code + password) */
  register: (payload: { phone: string; code: string; name?: string; password: string; referral_code?: string }) =>
    mapRequest<MapAuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Verify an email verification token */
  verifyEmail: (token: string) =>
    mapRequest<{ token: string; user: MapPortalUser }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  /** Resend the email verification message */
  resendVerification: (email: string) =>
    mapRequest<MapAuthResponse>('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  /** Account and password login (the account may be a phone number or an email). captchaId is the human-verification pass */
  login: (payload: { account: string; password: string; captchaId?: string }) =>
    mapRequest<MapAuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        account: payload.account,
        password: payload.password,
        captcha_id: payload.captchaId,
      }),
    }),

  /** Issue a login session after the new-IP second verification for password login succeeds */
  verifyPasswordLogin: (payload: { challenge_token: string; code: string }) =>
    mapRequest<MapAuthResponse>('/auth/password-login/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Resend the new-IP second verification code for password login */
  resendPasswordLogin: (payload: { challenge_token: string }) =>
    mapRequest<MapAuthResponse>('/auth/password-login/resend', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Send an SMS verification code. captchaId is the human-verification pass */
  sendSMSCode: (phone: string, captchaId?: string) =>
    mapRequest<MapAuthResponse>('/auth/sms-code', {
      method: 'POST',
      body: JSON.stringify({ phone, captcha_id: captchaId }),
    }),

  /** Send an email verification code (shared by register/login/password recovery; the code is sent only by email). captchaId is the human-verification pass */
  sendEmailCode: (email: string, captchaId?: string) =>
    mapRequest<MapAuthResponse>('/auth/email-code', {
      method: 'POST',
      body: JSON.stringify({ email, captcha_id: captchaId }),
    }),

  /** Email + verification code login (an unregistered email is registered automatically) */
  emailLogin: (payload: { email: string; code: string; name?: string; referral_code?: string }) =>
    mapRequest<MapAuthResponse>('/auth/email-login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Register with email + verification code + password */
  emailRegister: (payload: { email: string; code: string; name?: string; password: string; referral_code?: string }) =>
    mapRequest<MapAuthResponse>('/auth/email-register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Phone + verification code login (an unregistered phone number is registered automatically) */
  phoneLogin: (payload: { phone: string; code: string; name?: string; referral_code?: string }) =>
    mapRequest<MapAuthResponse>('/auth/phone-login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Start password recovery and return a reset token. captchaId is the human-verification pass */
  forgotPassword: (email: string, captchaId?: string) =>
    mapRequest<MapAuthResponse>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email, captcha_id: captchaId }),
    }),

  /** Set a new password with the reset token (email recovery) */
  resetPassword: (payload: { token: string; password: string }) =>
    mapRequest<{ status: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Reset the password with phone + SMS verification code (SMS recovery, reusing the code issued by /auth/sms-code) */
  resetPasswordBySms: (payload: { phone: string; code: string; password: string }) =>
    mapRequest<{ status: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Reset the password with email + verification code (email recovery, reusing the code issued by /auth/email-code, symmetric with phone recovery) */
  resetPasswordByEmailCode: (payload: { email: string; code: string; password: string }) =>
    mapRequest<{ status: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Log out */
  logout: () => mapRequest<{ status: string }>('/auth/logout', { method: 'POST' }),

  /** Fetch the currently logged-in user */
  me: () => mapRequest<MapPortalUser>('/me'),

  /** Delete (soft-delete) the current account */
  deleteAccount: () => mapRequest<{ status: string }>('/me', { method: 'DELETE' }),

  /** Set or change the password while logged in; when current_password is provided, verify the old password */
  updatePassword: (payload: { current_password?: string; password: string }) =>
    mapRequest<{ status: string; token?: string }>('/me/password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Change the nickname (name) and/or username (username) while logged in */
  updateProfile: (payload: { name?: string; username?: string }) =>
    mapRequest<MapPortalUser>('/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  /** Bind an email while logged in (get a verification code from sendEmailCode first) */
  bindEmail: (payload: { email: string; code: string }) =>
    mapRequest<MapPortalUser>('/me/email', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Send a phone-binding verification code while logged in; captchaId is the human-verification pass */
  sendPhoneBindCode: (phone: string, captchaId?: string) =>
    mapRequest<MapAuthResponse>('/me/phone/code', {
      method: 'POST',
      body: JSON.stringify({ phone, captcha_id: captchaId }),
    }),

  /** Bind a phone number while logged in (get the dedicated code from sendPhoneBindCode first) */
  bindPhone: (payload: { phone: string; code: string }) =>
    mapRequest<MapPortalUser>('/me/phone', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

/**
 * Feilian SSO portal login entry (enabled only in the test environment, driven by the backend feilian_enabled switch).
 *
 * Navigate the whole page to backend `/auth/feilian/login?target=portal`. The backend 302s to the Feilian authorization page; after authorization Feilian
 * calls back to backend `/admin/auth/callback` (the same redirect_uri as the admin console, distinguished by target in state),
 * the backend upserts the portal user by email and issues a user JWT, then redirects back to the portal login page with a URL fragment (`#token=...`).
 *
 * The path prefix matches mapRequest: dev uses `/api` (the Vite proxy strips the prefix and forwards to the backend), and production calls the same origin directly
 * at the gateway `/auth` route. Feilian is a full-page navigation and does not use fetch, so the prefix is assembled here instead of using mapRequest.
 */
export function feilianLogin(): void {
  const base = import.meta.env.DEV ? '/api' : '';
  window.location.assign(`${base}/auth/feilian/login?target=portal`);
}

/** Third-party login provider id: matches the path parameter of backend /auth/oauth/{provider}/login. */
export type OAuthProvider = 'google' | 'github' | 'wechat';

/**
 * Third-party (social) login entry: Google / GitHub / WeChat.
 *
 * Navigate the whole page to backend `/auth/oauth/{provider}/login?target=portal`. The backend 302s to the matching authorization page;
 * after authorization it calls back to backend `/auth/oauth/{provider}/callback`, which exchanges the token, loads userinfo, and idempotently creates or binds the account,
 * then redirects the user JWT back to the portal login page in a URL fragment (`#token=...`) (same shape as the Feilian return, and the frontend reuses the same handling).
 * The path prefix matches feilianLogin: dev uses `/api` (the Vite proxy strips the prefix), and production calls the gateway `/auth` on the same origin.
 */
export function oauthLogin(provider: OAuthProvider): void {
  const base = import.meta.env.DEV ? '/api' : '';
  window.location.assign(`${base}/auth/oauth/${provider}/login?target=portal`);
}
