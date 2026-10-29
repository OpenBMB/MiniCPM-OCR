/**
 * Unit tests for chatStatus pure functions.
 */

import { describe, it, expect } from 'vitest';
import { toolStatusStep, toolStatusText } from '../chatStatus';
import type { Translate } from '../../types';

/** Test translation stub: echo the key and interpolations, asserting the path is i18n rather than hardcoded Chinese. */
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
    // Search failed: the whole process bar turns red
    expect(toolStatusStep({ tool: 'web_search', status: 'failed' })).toBe('failed');
    // Page read failed: only the read step turns red, so "search" is not misjudged as failed
    expect(toolStatusStep({ tool: 'web_extractor', status: 'failed' })).toBe('browse_failed');
    expect(toolStatusStep({ tool: 'web_search', status: 'failed', urls: ['https://x'] })).toBe(
      'browse_failed',
    );
  });
});
