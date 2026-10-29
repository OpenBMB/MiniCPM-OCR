import { describe, expect, it } from 'vitest';

import { IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED } from '../imageParseFeatureFlags';

describe('文档解析功能开关', () => {
  it('跨页表格合并默认开启', () => {
    expect(IMAGE_PARSE_CROSS_PAGE_MERGE_ENABLED).toBe(true);
  });
});
