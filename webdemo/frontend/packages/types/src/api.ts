export interface ApiResponse<T = unknown> {
  /** Platform trace id (req_xxx), also written back on the X-Request-Id response header. */
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
 * Business error codes (kept in line with backend internal/app/errcode.go; only the subset the frontend must branch on is declared here).
 */
export const BIZ_CODE = {
  /** Success. */
  OK: 0,
  /** Not logged in, or the login session is no longer valid. */
  UNAUTHORIZED: 10001,
  /** Account disabled. */
  ACCOUNT_DISABLED: 10003,
  /** An email-authenticated account must bind a mainland China mobile number first. */
  PHONE_BINDING_REQUIRED: 10011,
  /** Insufficient permission. */
  FORBIDDEN: 10010,
  /** The high-privilege local password has expired. */
  PASSWORD_EXPIRED: 10007,
  /** The account is required to reset its local password. */
  PASSWORD_RESET_REQUIRED: 10009,
} as const;

/**
 * Error codes that must clear the login session and redirect to the login page (aligned with backend logoutCodes).
 * The frontend response interceptor uses this set to decide logout in one place.
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
