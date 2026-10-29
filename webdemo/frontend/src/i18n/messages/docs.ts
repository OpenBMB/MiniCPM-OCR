import type { TranslationShape } from '../types';

const zhCN = {
  title: '开发文档',
  searchPlaceholder: '搜索文档',
  noResults: '没有匹配的文档',
  tableOfContents: '本页目录',
  copyCode: '复制代码',
  copied: '已复制',
  copyFailed: '复制失败',
  copyFailedDescription: '自动复制失败，请选中代码后手动复制。',
  codeExamples: '代码示例语言',
  updatedAt: '更新于 {{date}}',
  previousPage: '上一篇',
  nextPage: '下一篇',
  documentationNavigation: '文档目录',
  closeDocumentationNavigation: '关闭文档目录',
  openDocumentationNavigation: '打开文档目录',
  documentationExternalNavigation: '文档外部导航',
  directory: '目录',
  openConsole: '进入控制台',
  notFoundTitle: '找不到这篇文档',
  notFoundDescription: '页面可能已经移动，或者链接地址不完整。',
  backToDocumentation: '返回文档首页',
  legal: {
    backToSignIn: '返回登录',
    title: '条款与协议',
    updatedAt: '更新日期：{{date}}',
    onThisPage: '在此页面',
    navigation: '法律文档',
    englishNotice: '本英文文本为便于理解提供的译文；如与中文版本不一致，以中文版本为准。',
  },
} as const;

const enUS = {
  title: 'Developer documentation',
  searchPlaceholder: 'Search documentation',
  noResults: 'No matching documentation',
  tableOfContents: 'On this page',
  copyCode: 'Copy code',
  copied: 'Copied',
  copyFailed: 'Could not copy',
  copyFailedDescription: 'Automatic copy failed. Select the code and copy it manually.',
  codeExamples: 'Code example language',
  updatedAt: 'Updated {{date}}',
  previousPage: 'Previous',
  nextPage: 'Next',
  documentationNavigation: 'Documentation navigation',
  closeDocumentationNavigation: 'Close documentation navigation',
  openDocumentationNavigation: 'Open documentation navigation',
  documentationExternalNavigation: 'Documentation external navigation',
  directory: 'Directory',
  openConsole: 'Open Console',
  notFoundTitle: 'Document not found',
  notFoundDescription: 'This page may have moved, or the link is incomplete.',
  backToDocumentation: 'Back to documentation home',
  legal: {
    backToSignIn: 'Back to sign in',
    title: 'Terms and policies',
    updatedAt: 'Last updated: {{date}}',
    onThisPage: 'On this page',
    navigation: 'Legal documents',
    englishNotice:
      'This English text is provided for convenience. If it differs from the Chinese version, the Chinese version prevails.',
  },
} satisfies TranslationShape<typeof zhCN>;

/** 门户开发文档外壳的双语资源。 */
export const docsMessages = {
  'zh-CN': zhCN,
  'en-US': enUS,
} as const;
