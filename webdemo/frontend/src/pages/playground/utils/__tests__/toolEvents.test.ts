import { describe, expect, it } from 'vitest';

import type { ToolStatusEvent } from '@/api/map/chat';

import type { ToolEvent } from '../../types';
import {
  MAX_EVENT_CITATION_URLS,
  finalizeToolEvents,
  runningSearchQueries,
  toolEventKey,
  upsertToolEvent,
} from '../toolEvents';

describe('toolEvents', () => {
  it('running 和 success 会更新同一个工具事件', () => {
    const running: ToolStatusEvent = {
      event_id: 'evt-1',
      step: 1,
      tool: 'web_search',
      status: 'running',
      queries: ['MAP'],
    };
    const success: ToolStatusEvent = {
      event_id: 'evt-1',
      step: 1,
      tool: 'web_search',
      status: 'success',
      result_count: 4,
      duration_ms: 1200,
    };

    const first = upsertToolEvent([], running);
    const second = upsertToolEvent(first, success);

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      eventId: 'evt-1',
      status: 'success',
      queryCount: 1,
      resultCount: 4,
      durationMs: 1200,
    });
  });

  it('没有 event_id 时按 step 和 tool 兼容归并', () => {
    expect(toolEventKey({ step: 2, tool: 'web_extractor' })).toBe('legacy:2:web_extractor');
  });

  it('新事件按顺序追加，超过上限时保留最近事件', () => {
    let events: ToolEvent[] = [];
    for (let step = 1; step <= 33; step += 1) {
      events = upsertToolEvent(events, {
        event_id: `evt-${step}`,
        step,
        tool: 'web_search',
        status: 'success',
      });
    }

    expect(events).toHaveLength(32);
    expect(events[0]?.step).toBe(2);
    expect(events[31]?.step).toBe(33);
  });

  it('结束时将仍在运行的事件标记为 interrupted', () => {
    const events = upsertToolEvent([], {
      event_id: 'evt-running',
      step: 1,
      tool: 'web_search',
      status: 'running',
    });

    expect(finalizeToolEvents(events, 'interrupted')[0]).toMatchObject({
      eventId: 'evt-running',
      status: 'interrupted',
    });
  });

  it('urls 落为归一化去重的 citationUrls，非 http(s) 被丢弃', () => {
    const events = upsertToolEvent([], {
      event_id: 'evt-read',
      step: 2,
      tool: 'web_extractor',
      status: 'running',
      urls: [
        'https://example.com/a/?b=2&a=1#frag',
        'https://example.com/a?a=1&b=2',
        'javascript:alert(1)',
        'not a url',
      ],
    });

    // 前两条只差末尾斜杠、hash 与查询参数顺序，归一化后是同一条
    expect(events[0]?.citationUrls).toEqual(['https://example.com/a?a=1&b=2']);
    // pageCount 仍取原始条数，主文案要用
    expect(events[0]?.pageCount).toBe(4);
  });

  it('citationUrls 超过上限时截断', () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://s${i}.example.com/p`);
    const events = upsertToolEvent([], {
      event_id: 'evt-read',
      step: 2,
      tool: 'web_extractor',
      status: 'running',
      urls,
    });

    expect(events[0]?.citationUrls).toHaveLength(MAX_EVENT_CITATION_URLS);
  });

  it('后续帧没有 urls 时不抹掉首帧已拿到的 citationUrls', () => {
    const running = upsertToolEvent([], {
      event_id: 'evt-read',
      step: 2,
      tool: 'web_extractor',
      status: 'running',
      urls: ['https://example.com/a'],
    });
    const done = upsertToolEvent(running, {
      event_id: 'evt-read',
      step: 2,
      tool: 'web_extractor',
      status: 'success',
      urls: [],
    });

    expect(done[0]?.citationUrls).toEqual(['https://example.com/a']);
  });

  it('reasoningOffset 锚在首帧，不被后续帧重算', () => {
    const running = upsertToolEvent(
      [],
      { event_id: 'evt-1', step: 1, tool: 'web_search', status: 'running' },
      120,
    );
    // success 帧比 running 帧晚几秒，这期间流出的思考属于工具行「之后」，不能改切点
    const done = upsertToolEvent(
      running,
      { event_id: 'evt-1', step: 1, tool: 'web_search', status: 'success', result_count: 4 },
      480,
    );

    expect(running[0]?.reasoningOffset).toBe(120);
    expect(done[0]?.reasoningOffset).toBe(120);
  });

  it('不传 reasoningOffset 时不写该字段（非流式与历史消息路径）', () => {
    const events = upsertToolEvent([], {
      event_id: 'evt-1',
      step: 1,
      tool: 'web_search',
      status: 'success',
    });

    expect(events[0]).not.toHaveProperty('reasoningOffset');
  });
});

describe('runningSearchQueries', () => {
  it('只取进行中的事件，终态的搜索词不再是「正在搜什么」', () => {
    const events: ToolEvent[] = [
      { eventId: 'a', step: 1, tool: 'web_search', status: 'success', queries: ['已经搜完的词'] },
      { eventId: 'b', step: 2, tool: 'web_search', status: 'running', queries: ['正在搜的词'] },
    ];

    expect(runningSearchQueries(events)).toEqual(['正在搜的词']);
  });

  it('顶行最多两个，多出来的留给展开区的工具行', () => {
    const events: ToolEvent[] = [
      {
        eventId: 'a',
        step: 1,
        tool: 'web_search',
        status: 'running',
        queries: ['一', '二', '三', '四'],
      },
    ];

    expect(runningSearchQueries(events)).toEqual(['一', '二']);
  });

  it('过长的查询词截断，空白词跳过', () => {
    const events: ToolEvent[] = [
      {
        eventId: 'a',
        step: 1,
        tool: 'web_search',
        status: 'running',
        queries: ['   ', '  北京天气  ', '一二三四五六七八九十一二三四五'],
      },
    ];

    expect(runningSearchQueries(events)).toEqual(['北京天气', '一二三四五六七八九十一二三四…']);
  });

  it('没有进行中的搜索时返回空数组，顶行据此退回静态文案', () => {
    const events: ToolEvent[] = [
      // running 但不带 queries：模型还在生成 tool_call 参数
      { eventId: 'a', step: 1, tool: 'web_search', status: 'running' },
      { eventId: 'b', step: 2, tool: 'web_extractor', status: 'running' },
    ];

    expect(runningSearchQueries(events)).toEqual([]);
  });
});
