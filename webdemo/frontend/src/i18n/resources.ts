import { authMessages } from './messages/auth';
import { billingMessages } from './messages/billing';
import { dashboardMessages } from './messages/dashboard';
import { keysMessages } from './messages/keys';
import { modelsMessages } from './messages/models';
import { playgroundMessages } from './messages/playground';
import { profileMessages } from './messages/profile';
import { shellMessages } from './messages/shell';
import { statusMessages } from './messages/status';
import { docsMessages } from './messages/docs';
import { voicesMessages } from './messages/voices';

/**
 * 门户全部本地化资源的纯数据导出。
 *
 * 用途：供 i18next 初始化与仓库根目录的文案审核脚本直接导入。
 * 该模块刻意不依赖 React、Zustand 或浏览器 API，以确保 Node 环境可稳定读取。
 */
export const i18nResources = {
  'zh-CN': {
    shell: shellMessages['zh-CN'],
    auth: authMessages['zh-CN'],
    dashboard: dashboardMessages['zh-CN'],
    keys: keysMessages['zh-CN'],
    models: modelsMessages['zh-CN'],
    billing: billingMessages['zh-CN'],
    docs: docsMessages['zh-CN'],
    profile: profileMessages['zh-CN'],
    playground: playgroundMessages['zh-CN'],
    status: statusMessages['zh-CN'],
    voices: voicesMessages['zh-CN'],
  },
  'en-US': {
    shell: shellMessages['en-US'],
    auth: authMessages['en-US'],
    dashboard: dashboardMessages['en-US'],
    keys: keysMessages['en-US'],
    models: modelsMessages['en-US'],
    billing: billingMessages['en-US'],
    docs: docsMessages['en-US'],
    profile: profileMessages['en-US'],
    playground: playgroundMessages['en-US'],
    status: statusMessages['en-US'],
    voices: voicesMessages['en-US'],
  },
} as const;
