import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import './index';

describe('portal i18n resources', () => {
  it('should resolve the professional English API Key label after changing language', async () => {
    await i18n.changeLanguage('en-US');

    expect(i18n.t('keys:title', { ns: 'keys' })).toBe('API Keys');
  });

  it('should expose matching locale resources for the audit export', async () => {
    const { i18nResources } = await import('./resources');

    expect(Object.keys(i18nResources['en-US']).sort()).toEqual(
      Object.keys(i18nResources['zh-CN']).sort(),
    );
    expect(i18nResources['en-US'].shell).toBeDefined();
    expect(i18nResources['en-US'].auth).toBeDefined();
    expect(i18nResources['en-US'].playground).toBeDefined();
  });

  it('should expose English account and shared-shell copy for the scoped portal surfaces', async () => {
    const { profileMessages } = await import('./messages/profile');
    const { shellMessages } = await import('./messages/shell');
    const { statusMessages } = await import('./messages/status');

    expect(profileMessages['en-US'].profileInformation).toBe('Profile information');
    expect(shellMessages['en-US'].settings.title).toBe('Preferences');
    expect(statusMessages['en-US'].captcha.title).toBe('Complete security verification');
  });
});
