/**
 * chatStatus 纯函数单测。
 */

import { describe, it, expect } from 'vitest';
import { toolStatusStep, toolStatusText } from '../chatStatus';
import type { Translate } from '../../types';

/** 测试用翻译桩：回显 key 与插值，断言走的是 i18n 而非硬编码中文。 */
const t: Translate = (key, options) =>
  options?.count === undefined ? key : `${key}:${String(options.count)}`;

describe('toolStatusText', () => {
  it('优先使用服务端 message', () => {
    expect(toolStatusText({ tool: 'web_search', status: 'running', message: '自定义' }, t)).toBe(
      '自定义',
    );
  });

  it('web_search running 走 i18n 默认文案', () => {
    expect(toolStatusText({ tool: 'web_search', status: 'running' }, t)).toBe(
      'toolStatusSearching',
    );
  });

  it('带结果数时用带计数的 key', () => {
    expect(toolStatusText({ tool: 'web_search', status: 'success', result_count: 6 }, t)).toBe(
      'toolStatusSearchDoneCount:6',
    );
    expect(toolStatusText({ tool: 'web_extractor', status: 'success' }, t)).toBe(
      'toolStatusReadDone',
    );
  });

  it('失败状态返回失败 key', () => {
    expect(toolStatusText({ tool: 'web_search', status: 'failed' }, t)).toBe('toolStatusFailed');
  });

  it('将工具状态映射为过程条阶段', () => {
    expect(toolStatusStep({ tool: 'web_search', status: 'running' })).toBe('searching');
    expect(toolStatusStep({ tool: 'web_search', status: 'success', result_count: 6 })).toBe(
      'found',
    );
    expect(toolStatusStep({ tool: 'web_extractor', status: 'running' })).toBe('reading');
    // 搜索失败：整个过程条标红
    expect(toolStatusStep({ tool: 'web_search', status: 'failed' })).toBe('failed');
    // 读网页失败：只让读取步骤标红，不让"搜索"被误判为失败
    expect(toolStatusStep({ tool: 'web_extractor', status: 'failed' })).toBe('browse_failed');
    expect(toolStatusStep({ tool: 'web_search', status: 'failed', urls: ['https://x'] })).toBe(
      'browse_failed',
    );
  });
});
