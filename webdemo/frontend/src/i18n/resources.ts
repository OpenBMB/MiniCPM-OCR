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
 * Pure-data export of every portal localization resource.
 *
 * Purpose: imported by i18next initialization and by the copy-review script at the repo root.
 * This module deliberately avoids React, Zustand, and browser APIs so Node can read it reliably.
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
