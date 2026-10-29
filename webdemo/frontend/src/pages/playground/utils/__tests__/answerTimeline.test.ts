/**
 * 过程时间线排序与取数纯函数单测：交错切段、两种退化、押后未播到的工具行、工具行取来源。
 */

import { describe, expect, it } from 'vitest';

import type { Citation, ToolEvent } from '../../types';
import {
  buildProcessTimeline,
  citationIndex,
  toolRowCitations,
  type ProcessTimelineItem,
} from '../answerTimeline';

function event(patch: Partial<ToolEvent> & { eventId: string }): ToolEvent {
  return {
    step: 1,
    tool: 'web_search',
    status: 'success',
    ...patch,
  };
}

/** 把时间线压成 'reasoning:文本' / 'tool:eventId' 的串，便于整体断言顺序。 */
function outline(items: ProcessTimelineItem[]): string[] {
  return items.map((item) =>
    item.kind === 'reasoning' ? `reasoning:${item.text}` : `tool:${item.id}`,
  );
}

describe('buildProcessTimeline', () => {
  it('按 reasoningOffset 把思考切段并与工具行交错', () => {
    const timeline = buildProcessTimeline({
      reasoning: '先搜一下。再读几页。最后汇总。',
      toolEvents: [
        event({ eventId: 'search', reasoningOffset: 5 }),
        event({ eventId: 'read', tool: 'web_extractor', step: 2, reasoningOffset: 10 }),
      ],
    });

    expect(timeline.interleaved).toBe(true);
    expect(outline(timeline.items)).toEqual([
      'reasoning:先搜一下。',
      'tool:search',
      'reasoning:再读几页。',
      'tool:read',
      'reasoning:最后汇总。',
    ]);
  });

  it('同一步的多个工具共用一个切分点，中间不插空思考段', () => {
    const timeline = buildProcessTimeline({
      reasoning: '先搜一下。然后汇总。',
      toolEvents: [
        event({ eventId: 'a', reasoningOffset: 5 }),
        event({ eventId: 'b', reasoningOffset: 5 }),
      ],
    });

    expect(outline(timeline.items)).toEqual([
      'reasoning:先搜一下。',
      'tool:a',
      'tool:b',
      'reasoning:然后汇总。',
    ]);
  });

  it('offset 超出思考长度或回退时被夹住，不抛错也不重复切段', () => {
    const timeline = buildProcessTimeline({
      reasoning: '很短',
      toolEvents: [
        event({ eventId: 'a', reasoningOffset: 999 }),
        // 回退的 offset（理论上不该出现）不能让游标倒回去重放前面的思考
        event({ eventId: 'b', reasoningOffset: 0 }),
      ],
    });

    expect(outline(timeline.items)).toEqual(['reasoning:很短', 'tool:a', 'tool:b']);
  });

  it('任一事件缺 reasoningOffset 时退化为思考整块置顶', () => {
    const timeline = buildProcessTimeline({
      reasoning: '思考全文',
      toolEvents: [event({ eventId: 'a', reasoningOffset: 2 }), event({ eventId: 'b' })],
    });

    expect(timeline.interleaved).toBe(false);
    expect(outline(timeline.items)).toEqual(['reasoning:思考全文', 'tool:a', 'tool:b']);
  });

  it('思考被展示层改写过时退化为思考整块置顶', () => {
    const timeline = buildProcessTimeline({
      reasoning: '思考全文',
      toolEvents: [event({ eventId: 'a', reasoningOffset: 2 })],
      reasoningRewritten: true,
    });

    expect(timeline.interleaved).toBe(false);
    expect(outline(timeline.items)).toEqual(['reasoning:思考全文', 'tool:a']);
  });

  it('只有思考没有工具时给出单段，不算交错', () => {
    const timeline = buildProcessTimeline({ reasoning: '只是思考', toolEvents: [] });

    expect(timeline.interleaved).toBe(false);
    expect(outline(timeline.items)).toEqual(['reasoning:只是思考']);
  });

  it('没有思考只有工具时只出工具行，不留空思考段', () => {
    const timeline = buildProcessTimeline({
      reasoning: '',
      toolEvents: [event({ eventId: 'a', reasoningOffset: 0 })],
    });

    expect(outline(timeline.items)).toEqual(['tool:a']);
  });

  it('流式期间押后切点还没播到的工具行，播到了再出', () => {
    const toolEvents = [
      event({ eventId: 'a', reasoningOffset: 5 }),
      event({ eventId: 'b', step: 2, reasoningOffset: 11 }),
    ];

    // 已显示 8 个字：第一行该出了，第二行的切点还没播到
    const playing = buildProcessTimeline({
      reasoning: '先搜一下。再看看',
      toolEvents,
      holdUnplayed: true,
    });
    expect(outline(playing.items)).toEqual(['reasoning:先搜一下。', 'tool:a', 'reasoning:再看看']);

    // 播到了，第二行随之出现
    const played = buildProcessTimeline({
      reasoning: '先搜一下。再看看几页。',
      toolEvents,
      holdUnplayed: true,
    });
    expect(outline(played.items)).toEqual([
      'reasoning:先搜一下。',
      'tool:a',
      'reasoning:再看看几页。',
      'tool:b',
    ]);
  });

  it('流式结束（holdUnplayed 为假）时，切点超出的工具行照常展示', () => {
    const timeline = buildProcessTimeline({
      reasoning: '先搜一下。',
      toolEvents: [event({ eventId: 'a', reasoningOffset: 999 })],
    });

    expect(outline(timeline.items)).toEqual(['reasoning:先搜一下。', 'tool:a']);
  });

  it('段首换行不会被当成 markdown 缩进代码块，逐段去掉首尾空白', () => {
    const timeline = buildProcessTimeline({
      reasoning: '先搜一下。\n\n    再看结果。',
      toolEvents: [event({ eventId: 'a', reasoningOffset: 5 })],
    });

    expect(outline(timeline.items)).toEqual([
      'reasoning:先搜一下。',
      'tool:a',
      'reasoning:再看结果。',
    ]);
  });

  it('纯空白的思考段不单独成项', () => {
    const timeline = buildProcessTimeline({
      reasoning: '  \n\n先搜。',
      toolEvents: [
        event({ eventId: 'a', reasoningOffset: 4 }),
        event({ eventId: 'b', step: 2, reasoningOffset: 7 }),
      ],
    });

    expect(outline(timeline.items)).toEqual(['tool:a', 'reasoning:先搜。', 'tool:b']);
  });
});

describe('toolRowCitations', () => {
  const citations: Citation[] = [
    { url: 'https://a.example.com/p', title: 'A 站文章' },
    { url: 'https://b.example.com/p', title: 'B 站文章' },
  ];
  const index = citationIndex(citations);

  it('web_extractor 按事件自带的地址精确取来源与标题', () => {
    const rows = toolRowCitations(
      event({ eventId: 'read', tool: 'web_extractor', citationUrls: ['https://b.example.com/p'] }),
      index,
      citations,
    );

    expect(rows).toEqual([{ url: 'https://b.example.com/p', title: 'B 站文章' }]);
  });

  it('地址在来源里匹配不到时至少保留地址，供 favicon 使用', () => {
    const rows = toolRowCitations(
      event({ eventId: 'read', tool: 'web_extractor', citationUrls: ['https://c.example.com/p'] }),
      index,
      citations,
    );

    expect(rows).toEqual([{ url: 'https://c.example.com/p' }]);
  });

  it('web_search 没有地址时退回整条消息的来源', () => {
    expect(toolRowCitations(event({ eventId: 'search' }), index, citations)).toEqual(citations);
  });

  it('非联网工具没有地址时不展示来源', () => {
    expect(toolRowCitations(event({ eventId: 'dt', tool: 'datetime' }), index, citations)).toEqual(
      [],
    );
  });
});
