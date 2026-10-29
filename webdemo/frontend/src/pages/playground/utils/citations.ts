/**
 * 联网引用来源的 URL 处理与跳转工具。
 *
 * 用途：域名/favicon 展示回退、跳转地址白名单校验、模型链接与来源数据的匹配键，
 * 以及来源链接统一的新窗口打开行为，供过程区、行内角标与来源列表复用。
 */

/**
 * 从 URL 取域名作为无标题引用的回退展示。
 * @param url 来源地址
 * @returns 去除 www 前缀的域名；无效地址回退原串
 */
export function citationDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * 构造来源站点自己的 favicon 地址，避免引入第三方图标代理。
 * @param url 来源地址
 * @returns favicon 地址；无效地址返回 undefined
 */
export function citationFavicon(url: string): string | undefined {
  try {
    return `${new URL(url).origin}/favicon.ico`;
  } catch {
    return undefined;
  }
}

/**
 * 校验来源跳转地址，仅允许 HTTP(S)。
 * @param url 来源地址
 * @returns 可安全打开的地址；非法协议返回 undefined
 */
export function safeCitationHref(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 生成用于匹配模型 Markdown 链接与来源数据的稳定键。
 * @param url 来源地址
 * @returns 忽略 hash、末尾斜杠和查询参数顺序差异的 URL 键
 */
export function citationURLKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * 取一条来源对外展示的角标编号。
 *
 * 正文角标、来源面板序号、独占一行的来源行三处此前各自用数组下标 +1 算编号，
 * 而数组是跨轮累积并按 URL 去重的，与后端每轮重排后的注入顺序并不对应——
 * 多轮搜索时三处算出的数字会一起指错。改为统一消费后端下发的 ref，
 * 编号只剩一个来源（后端 hostedSourceRegistry）。
 *
 * @param citation 来源
 * @param fallbackIndex 数组下标（0 起），仅在后端未下发 ref 时用于回退
 * @returns 展示用编号（1 起）
 */
export function citationDisplayIndex(citation: { ref?: number }, fallbackIndex: number): number {
  return citation.ref && citation.ref > 0 ? citation.ref : fallbackIndex + 1;
}

/**
 * 判断点击是否应交回浏览器原生处理。
 *
 * 修饰键、鼠标中键以及已被上层拦截的事件都保留原生语义（"在新标签页打开"等），
 * 否则编程式 window.open 会把这些操作统一降级为普通跳转。
 *
 * @param event 鼠标点击事件（只取判定所需的最小字段）
 * @returns true 表示不应接管本次点击
 */
export function isNativeOpenIntent(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  button: number;
  defaultPrevented: boolean;
}): boolean {
  return (
    event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0 || event.defaultPrevented
  );
}

/**
 * 编程式新窗口打开来源。
 *
 * 兜底处理：
 * - 部分浏览器对隐式 target=_blank 的拦截；
 * - 在被 Tooltip 等中间件包裹时，preventDefault 后用同步 window.open 让点击总有可见反馈。
 *
 * @param href 来源地址
 */
export function openCitationWindow(href: string): void {
  const popup = window.open('about:blank', '_blank', 'noopener,noreferrer');
  if (!popup) {
    // 浏览器拦截了弹窗 → 退化为同窗口跳转，至少保证用户能到达目标页
    window.location.assign(href);
    return;
  }
  popup.opener = null;
  popup.location.replace(href);
}
