/**
 * Format checks for authentication.
 *
 * Purpose: a format check before submit on login, bind-email, and change-email forms, so invalid requests never reach the backend.
 * This is only a light format check; real ownership is still decided by the backend verification code or uniqueness check.
 */

/**
 * Email format check (simplified RFC: local-part@domain.tld).
 * @param email Email to check.
 * @returns Whether it is a valid email format.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Mainland China mobile number format check (11 digits, starts with 1, second digit 3-9).
 * @param phone Phone number to check.
 * @returns Whether it is a valid mobile number format.
 */
export function isValidPhone(phone: string): boolean {
  return /^(?:\+86)?1[3-9]\d{9}$/.test(phone.trim());
}
