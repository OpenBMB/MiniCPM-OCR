import type { TranslationShape } from '../types';

const zhCN = {
  loading: '加载中…',
  retry: '重试',
  unknownError: '请求未完成，请稍后重试',
  close: '关闭',
  openMenu: '打开菜单',
  closeMenu: '关闭菜单',
  breadcrumb: '面包屑',
  home: '首页',
  backToHome: '返回首页',
  back: '返回上一页',
  forbiddenTitle: '权限不足',
  forbiddenDescription: '你没有访问此页面的权限，请联系管理员开通相应的访问权限。',
  unauthorizedTitle: '登录已过期',
  unauthorizedDescription: '你的登录状态已失效，请重新登录以继续使用。',
  signInAgain: '重新登录',
  notFoundTitle: '页面未找到',
  notFoundDescription: '你访问的页面不存在或已被移除，请检查链接是否正确。',
  captcha: {
    title: '请完成安全验证',
    dragPrompt: '向右拖动滑块完成拼图',
    reloadDescription: '请检查网络连接后重新加载验证码。',
    loadFailed: '验证码加载失败，请重试',
    reload: '重新加载',
    loading: '正在加载验证码…',
  },
  errorBoundary: {
    pageAssetLoadFailed: '页面资源加载失败',
    pageUnexpectedError: '页面出了点问题',
    pageAssetLoadDescription: '网络连接异常或页面版本已更新，请刷新重试。',
    appLoadFailed: '应用加载异常',
    appAssetLoadDescription: '页面资源加载失败，可能是网络异常或应用版本已更新。',
    appUnexpectedDescription: '应用发生了意外错误，请尝试刷新页面。',
    reload: '刷新页面',
  },
} as const;

const enUS = {
  loading: 'Loading…',
  retry: 'Retry',
  unknownError: 'The request could not be completed. Please try again later.',
  close: 'Close',
  openMenu: 'Open navigation menu',
  closeMenu: 'Close navigation menu',
  breadcrumb: 'Breadcrumb',
  home: 'Home',
  backToHome: 'Back to Home',
  back: 'Go back',
  forbiddenTitle: 'Access denied',
  forbiddenDescription:
    'You do not have permission to access this page. Contact an administrator to request access.',
  unauthorizedTitle: 'Session expired',
  unauthorizedDescription: 'Your session is no longer valid. Sign in again to continue.',
  signInAgain: 'Sign in again',
  notFoundTitle: 'Page not found',
  notFoundDescription:
    'The page you requested does not exist or has been removed. Check that the link is correct.',
  captcha: {
    title: 'Complete security verification',
    dragPrompt: 'Drag the slider to complete the puzzle',
    reloadDescription: 'Check your network connection, then reload the verification challenge.',
    loadFailed: 'Could not load the verification challenge. Please try again.',
    reload: 'Reload',
    loading: 'Loading verification challenge…',
  },
  errorBoundary: {
    pageAssetLoadFailed: 'Could not load page resources',
    pageUnexpectedError: 'Something went wrong',
    pageAssetLoadDescription:
      'Your network connection may be unavailable, or the page has been updated. Refresh and try again.',
    appLoadFailed: 'Application failed to load',
    appAssetLoadDescription:
      'Page resources could not be loaded. Your network connection may be unavailable, or the application has been updated.',
    appUnexpectedDescription:
      'The application encountered an unexpected error. Refresh the page and try again.',
    reload: 'Refresh page',
  },
} satisfies TranslationShape<typeof zhCN>;

/** 门户通用状态与异常页的双语资源。 */
export const statusMessages = {
  'zh-CN': zhCN,
  'en-US': enUS,
} as const;
