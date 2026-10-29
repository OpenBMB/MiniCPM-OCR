export interface ApiResponse<T = unknown> {
  /** 平台链路 ID（req_xxx），同时在响应头 X-Request-Id 回写 */
  requestId: string;
  code: number | string;
  data: T;
  message: string;
}

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageParams {
  page: number;
  pageSize: number;
  [key: string]: unknown;
}

/**
 * 业务错误码（与后端 internal/app/errcode.go 保持一致，此处仅声明前端需判定的子集）。
 */
export const BIZ_CODE = {
  /** 成功 */
  OK: 0,
  /** 未登录 / 登录态失效 */
  UNAUTHORIZED: 10001,
  /** 账号被停用 */
  ACCOUNT_DISABLED: 10003,
  /** 邮箱认证账号必须先绑定中国大陆手机号 */
  PHONE_BINDING_REQUIRED: 10011,
  /** 权限不足 */
  FORBIDDEN: 10010,
  /** 高权限本地密码已过期 */
  PASSWORD_EXPIRED: 10007,
  /** 账号被要求重置本地密码 */
  PASSWORD_RESET_REQUIRED: 10009,
} as const;

/**
 * 需清除登录态并跳转登录页的错误码集合（对齐后端 logoutCodes）。
 * 前端响应拦截器据此统一判定登出。
 */
export const LOGOUT_CODES: readonly number[] = [BIZ_CODE.UNAUTHORIZED, BIZ_CODE.ACCOUNT_DISABLED];

export class BizError extends Error {
  code: number | string;
  constructor(code: number | string, message: string) {
    super(message);
    this.code = code;
    this.name = 'BizError';
  }
}
