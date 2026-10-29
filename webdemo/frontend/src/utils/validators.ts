/**
 * 认证相关的格式校验工具。
 *
 * 用途：登录、绑定/换绑邮箱等表单提交前做前置格式校验，避免无效请求打到后端。
 * 仅做格式层面的轻校验，真正的归属校验仍以后端验证码/查重为准。
 */

/**
 * 邮箱格式校验（简化 RFC：本地名@域名.顶级域）。
 * @param email 待校验邮箱
 * @returns 是否为合法邮箱格式
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * 中国大陆手机号格式校验（11 位，1 开头，第二位 3-9）。
 * @param phone 待校验手机号
 * @returns 是否为合法手机号格式
 */
export function isValidPhone(phone: string): boolean {
  return /^(?:\+86)?1[3-9]\d{9}$/.test(phone.trim());
}
