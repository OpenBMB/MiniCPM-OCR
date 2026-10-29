import { describe, expect, it } from 'vitest';

import { modelsMessages as adminModelsMessages } from '../../../../admin/src/i18n/messages/models';

import { modelsMessages } from './models';

describe('模型列表价格单位', () => {
  it('中文输入、输出价格标明积分/1M，与后台计价单位一致', () => {
    expect(modelsMessages['zh-CN'].inputPrice).toBe('输入价格（积分/1M）');
    expect(modelsMessages['zh-CN'].outputPrice).toBe('输出价格（积分/1M）');
  });

  it('英文输入、输出价格标明 credits / 1M', () => {
    expect(modelsMessages['en-US'].inputPrice).toBe('Input price (credits / 1M)');
    expect(modelsMessages['en-US'].outputPrice).toBe('Output price (credits / 1M)');
  });

  it.each(['zh-CN', 'en-US'] as const)('%s 价格单位与管理侧一致', (locale) => {
    const portal = modelsMessages[locale];
    const admin = adminModelsMessages[locale].field;
    const unit = locale === 'zh-CN' ? '（积分/1M）' : '(credits / 1M)';

    expect(portal.inputPrice.endsWith(unit)).toBe(true);
    expect(portal.outputPrice.endsWith(unit)).toBe(true);
    expect(admin.inputPricing.endsWith(unit)).toBe(true);
    expect(admin.outputPricing.endsWith(unit)).toBe(true);
  });
});
