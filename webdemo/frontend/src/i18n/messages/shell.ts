import type { TranslationShape } from '../types';

const zhCN = {
  language: {
    switchToEnglish: '切换为英文',
    switchToChinese: '切换为中文',
    english: 'English',
    chinese: '中文',
  },
  navigation: {
    home: '首页',
    models: '模型列表',
    voices: '我的音色',
    playground: '体验中心',
    apiKeys: 'API Keys',
    usage: '用量',
    rateLimits: '限流',
    credits: '额度中心',
    profile: '个人设置',
    documentation: 'API 文档',
    contactUs: '联系我们',
    mainMenu: '主菜单',
    accountMenu: '账号菜单',
  },
  account: {
    signIn: '登录',
    signOut: '退出登录',
    openAdmin: '进入管理台',
  },
  controls: {
    openMenu: '打开菜单',
    closeMenu: '关闭菜单',
    openUserMenu: '打开个人菜单',
    expandSidebar: '展开侧边栏',
    collapseSidebar: '收起侧边栏',
    breadcrumb: '面包屑',
    searchPages: '搜索页面...',
    noMatchingPages: '没有匹配的页面',
    navigate: '导航',
    goToPage: '跳转',
    close: '关闭',
  },
  notifications: {
    title: '通知',
    open: '打开通知',
    markAllRead: '全部已读',
    empty: '暂无通知',
    viewAll: '查看全部通知',
    items: {
      systemUpdate: {
        title: '系统更新',
        description: '平台已更新至 v1.2.0，新增 AI 体验中心模块',
        time: '10 分钟前',
      },
      taskComplete: {
        title: '标注任务完成',
        description: '项目「图片分类-V2」标注任务已完成 100%',
        time: '1 小时前',
      },
      storageWarning: {
        title: '存储空间预警',
        description: '当前存储使用率已达 85%，请及时清理',
        time: '3 小时前',
      },
      memberJoined: {
        title: '新成员加入',
        description: '张三已加入「默认团队」',
        time: '昨天',
      },
      trainingComplete: {
        title: '模型训练完成',
        description: 'ResNet-50 微调任务已完成，准确率 96.3%',
        time: '昨天',
      },
    },
  },
  settings: {
    title: '个性化设置',
    close: '关闭个性化设置',
    navigationMode: '导航模式',
    sidebar: '侧边栏',
    sidebarDescription: '经典左侧菜单布局',
    top: '顶部导航',
    topDescription: '菜单在顶部水平排列',
    mixed: '混合模式',
    mixedDescription: '顶部一级 + 侧边二级',
  },
  billingAlert: {
    inArrears: '账户已欠费，模型调用可能被拒绝，请尽快充值。',
    balanceExhausted: '账户余额已用尽，模型调用可能被拒绝，请尽快充值。',
    balanceBelowThreshold: '账户余额已低于预警阈值（{{amount}} 积分），建议及时充值。',
    monthlyQuotaThreshold: '本月额度已使用 {{percent}}%，接近上限。',
    dailyQuotaThreshold: '今日额度已使用 {{percent}}%，接近上限。',
    openOverview: '前往总览查看',
  },
} as const;

const enUS = {
  language: {
    switchToEnglish: 'Switch to English',
    switchToChinese: 'Switch to Chinese',
    english: 'English',
    chinese: 'Chinese',
  },
  navigation: {
    home: 'Home',
    models: 'Models',
    voices: 'My Voices',
    playground: 'Playground',
    apiKeys: 'API Keys',
    usage: 'Usage',
    rateLimits: 'Rate Limits',
    credits: 'Credits',
    profile: 'Personal settings',
    documentation: 'Developer documentation',
    contactUs: 'Contact Us',
    mainMenu: 'Main menu',
    accountMenu: 'Account menu',
  },
  account: {
    signIn: 'Sign in',
    signOut: 'Sign out',
    openAdmin: 'Open Admin Console',
  },
  controls: {
    openMenu: 'Open navigation menu',
    closeMenu: 'Close navigation menu',
    openUserMenu: 'Open user menu',
    expandSidebar: 'Expand sidebar',
    collapseSidebar: 'Collapse sidebar',
    breadcrumb: 'Breadcrumb',
    searchPages: 'Search pages…',
    noMatchingPages: 'No matching pages',
    navigate: 'Navigate',
    goToPage: 'Open page',
    close: 'Close',
  },
  notifications: {
    title: 'Notifications',
    open: 'Open notifications',
    markAllRead: 'Mark all as read',
    empty: 'No notifications',
    viewAll: 'View all notifications',
    items: {
      systemUpdate: {
        title: 'System update',
        description: 'The platform has been updated to v1.2.0 with the AI Playground module.',
        time: '10 minutes ago',
      },
      taskComplete: {
        title: 'Annotation task completed',
        description: 'The "Image Classification-V2" annotation task is 100% complete.',
        time: '1 hour ago',
      },
      storageWarning: {
        title: 'Storage capacity warning',
        description: 'Storage utilization has reached 85%. Clear unused data promptly.',
        time: '3 hours ago',
      },
      memberJoined: {
        title: 'New member joined',
        description: 'Zhang San joined the "Default team".',
        time: 'Yesterday',
      },
      trainingComplete: {
        title: 'Model training completed',
        description: 'The ResNet-50 fine-tuning task completed with 96.3% accuracy.',
        time: 'Yesterday',
      },
    },
  },
  settings: {
    title: 'Preferences',
    close: 'Close preferences',
    navigationMode: 'Navigation mode',
    sidebar: 'Sidebar',
    sidebarDescription: 'Classic left-side navigation',
    top: 'Top navigation',
    topDescription: 'Menu items are arranged horizontally at the top',
    mixed: 'Mixed mode',
    mixedDescription: 'Top-level navigation with a secondary sidebar',
  },
  billingAlert: {
    inArrears: 'Your account is in arrears. Model requests may be rejected. Add Credits promptly.',
    balanceExhausted:
      'Your Credit Balance is exhausted. Model requests may be rejected. Add Credits promptly.',
    balanceBelowThreshold:
      'Your Credit Balance is below the alert threshold ({{amount}} Credits). Add Credits promptly.',
    monthlyQuotaThreshold:
      '{{percent}}% of this month’s quota has been used and is nearing its limit.',
    dailyQuotaThreshold: '{{percent}}% of today’s quota has been used and is nearing its limit.',
    openOverview: 'Open overview',
  },
} satisfies TranslationShape<typeof zhCN>;

/** 门户应用外壳的双语资源。 */
export const shellMessages = {
  'zh-CN': zhCN,
  'en-US': enUS,
} as const;
