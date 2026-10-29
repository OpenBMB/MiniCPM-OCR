import { describe, it, expect } from 'vitest';
import {
  splitSseLines,
  parseSseLine,
  splitSseFrames,
  parseSseFrame,
  extractDeltas,
  normalizeCitations,
  createThinkSplitState,
  splitThinkDelta,
  flushThinkDelta,
} from '../sse';

/** 把整段文本按任意分片喂给拆分器，聚合出正文/思考，模拟真实流式切分。 */
function runThinkSplit(chunks: string[]): { content: string; reasoning: string } {
  const state = createThinkSplitState();
  let content = '';
  let reasoning = '';
  for (const c of chunks) {
    const r = splitThinkDelta(state, c);
    content += r.content;
    reasoning += r.reasoning;
  }
  const tail = flushThinkDelta(state);
  return { content: content + tail.content, reasoning: reasoning + tail.reasoning };
}

/** SSE 行解析与 OpenAI chunk 抽取的纯函数单测 */
describe('splitSseLines', () => {
  it('保留末尾未完成片段', () => {
    const { lines, rest } = splitSseLines('data: a\ndata: b\ndata: par');
    expect(lines).toEqual(['data: a', 'data: b']);
    expect(rest).toBe('data: par');
  });

  it('处理 CRLF 行尾', () => {
    const { lines } = splitSseLines('data: a\r\ndata: b\r\n');
    expect(lines).toEqual(['data: a', 'data: b']);
  });

  it('无换行时整段作为残片保留', () => {
    const { lines, rest } = splitSseLines('data: partial');
    expect(lines).toEqual([]);
    expect(rest).toBe('data: partial');
  });
});

describe('parseSseLine', () => {
  it('识别 [DONE] 终止帧', () => {
    expect(parseSseLine('data: [DONE]')).toEqual({ type: 'done' });
  });

  it('解析 data JSON', () => {
    const ev = parseSseLine('data: {"choices":[{"delta":{"content":"hi"}}]}');
    expect(ev?.type).toBe('chunk');
    expect(ev?.data).toMatchObject({ choices: [{ delta: { content: 'hi' } }] });
  });

  it('忽略注释/空/非 data 行', () => {
    expect(parseSseLine(': heartbeat')).toBeNull();
    expect(parseSseLine('')).toBeNull();
    expect(parseSseLine('event: message')).toBeNull();
  });

  it('非法 JSON 不抛错，返回 data=undefined', () => {
    const ev = parseSseLine('data: {bad json');
    expect(ev).toEqual({ type: 'chunk', data: undefined });
  });
});

describe('parseSseFrame', () => {
  it('解析默认 OpenAI data frame', () => {
    const ev = parseSseFrame('data: {"choices":[{"delta":{"content":"hi"}}]}');
    expect(ev?.type).toBe('chunk');
    expect(ev?.data).toMatchObject({ choices: [{ delta: { content: 'hi' } }] });
  });

  it('解析 tool_status 事件', () => {
    const ev = parseSseFrame('event: tool_status\ndata: {"tool":"web_search","status":"running"}');
    expect(ev).toEqual({ type: 'tool_status', data: { tool: 'web_search', status: 'running' } });
  });

  it('支持多行 data 与 frame 切分', () => {
    const { frames, rest } = splitSseFrames('event: tool_status\ndata: {"a":1}\n\ndata: par');
    expect(frames).toEqual(['event: tool_status\ndata: {"a":1}']);
    expect(rest).toBe('data: par');
  });

  it('解析 citations 事件', () => {
    const ev = parseSseFrame('event: citations\ndata: [{"url":"https://ex.com","title":"T"}]');
    expect(ev?.type).toBe('citations');
    expect(ev?.data).toEqual([{ url: 'https://ex.com', title: 'T' }]);
  });

  it('解析带内 error 事件', () => {
    const ev = parseSseFrame('event: error\ndata: {"message":"boom"}');
    expect(ev).toEqual({ type: 'error', data: { message: 'boom' } });
  });

  it('解析 moderation 安全回答事件', () => {
    const ev = parseSseFrame('event: moderation\ndata: {"action":"answer"}');
    expect(ev).toEqual({ type: 'moderation', data: { action: 'answer' } });
  });

  it('未知 event 回退为默认 chunk', () => {
    const ev = parseSseFrame('event: whatever\ndata: {"x":1}');
    expect(ev?.type).toBe('chunk');
  });
});

describe('extractDeltas', () => {
  it('抽取正文增量', () => {
    const d = extractDeltas({ choices: [{ delta: { content: '你好' } }] });
    expect(d.content).toBe('你好');
    expect(d.reasoning).toBe('');
  });

  it('思考字段多键兜底（reasoning_content 优先）', () => {
    expect(extractDeltas({ choices: [{ delta: { reasoning_content: 'think' } }] }).reasoning).toBe(
      'think',
    );
    expect(extractDeltas({ choices: [{ delta: { reasoning: 'r2' } }] }).reasoning).toBe('r2');
    expect(extractDeltas({ choices: [{ delta: { thinking: 'r3' } }] }).reasoning).toBe('r3');
  });

  it('抽取尾块 usage', () => {
    const d = extractDeltas({
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(d.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });

  it('total_tokens 为 0 时不产出 usage', () => {
    const d = extractDeltas({ usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
    expect(d.usage).toBeUndefined();
  });

  it('非对象输入安全返回空增量', () => {
    expect(extractDeltas(null)).toEqual({ content: '', reasoning: '' });
    expect(extractDeltas('x')).toEqual({ content: '', reasoning: '' });
  });

  it('抽取 delta.annotations 联网引用（官方 url_citation 形态）', () => {
    const d = extractDeltas({
      choices: [
        {
          delta: {
            content: '结果',
            annotations: [
              {
                type: 'url_citation',
                url_citation: {
                  url: 'https://a.com/x',
                  title: 'A 标题',
                  snippet: 'A 摘要',
                },
              },
            ],
          },
        },
      ],
    });
    expect(d.citations).toEqual([{ url: 'https://a.com/x', title: 'A 标题', snippet: 'A 摘要' }]);
  });
});

describe('splitThinkDelta', () => {
  it('把内联 <think>…</think> 改路由到思考通道，正文保持干净', () => {
    const r = runThinkSplit(['<think>先搜索</think>2024 年得主是 A 和 B。']);
    expect(r.reasoning).toBe('先搜索');
    expect(r.content).toBe('2024 年得主是 A 和 B。');
  });

  it('无 think 标签时原样透传到正文', () => {
    const r = runThinkSplit(['你好，', '世界']);
    expect(r.content).toBe('你好，世界');
    expect(r.reasoning).toBe('');
  });

  it('标签被分片切断（<thi + nk>）仍能正确识别', () => {
    const r = runThinkSplit(['<thi', 'nk>思考', '中</thi', 'nk>答案']);
    expect(r.reasoning).toBe('思考中');
    expect(r.content).toBe('答案');
  });

  it('多个 think 块与其间正文交替', () => {
    const r = runThinkSplit(['<think>a</think>正文1<think>b</think>正文2']);
    expect(r.reasoning).toBe('ab');
    expect(r.content).toBe('正文1正文2');
  });

  it('未闭合 think：全部归入思考，flush 不吞字', () => {
    const r = runThinkSplit(['<think>只思考没答案']);
    expect(r.content).toBe('');
    expect(r.reasoning).toBe('只思考没答案');
  });

  it('正文中的裸 < 不被误判为标签', () => {
    const r = runThinkSplit(['当 a < b 时成立']);
    expect(r.content).toBe('当 a < b 时成立');
    expect(r.reasoning).toBe('');
  });

  it('逐字符流式喂入也能稳定拆分', () => {
    const full = '<think>reasoning</think>answer';
    const r = runThinkSplit(full.split(''));
    expect(r.reasoning).toBe('reasoning');
    expect(r.content).toBe('answer');
  });
});

describe('normalizeCitations', () => {
  it('归一化官方 url_citation 形态', () => {
    expect(
      normalizeCitations([
        {
          type: 'url_citation',
          url_citation: { url: 'https://a.com', title: 'A', snippet: '摘要' },
        },
      ]),
    ).toEqual([{ url: 'https://a.com', title: 'A', snippet: '摘要' }]);
  });

  it('兼容扁平 {url,title} 形态；无 title 时不带 title 字段', () => {
    expect(normalizeCitations([{ url: 'https://b.com' }])).toEqual([{ url: 'https://b.com' }]);
  });

  it('带出后端来源编号：体验中心叫 ref，公开 API 叫 index', () => {
    expect(normalizeCitations([{ ref: 3, url: 'https://a.com', title: 'A' }])).toEqual([
      { ref: 3, url: 'https://a.com', title: 'A' },
    ]);
    expect(
      normalizeCitations([
        { type: 'url_citation', url_citation: { index: 2, url: 'https://b.com' } },
      ]),
    ).toEqual([{ ref: 2, url: 'https://b.com' }]);
    // 0 与非整数不是合法编号，不能落成 ref——下游会把它当「后端已发号」来判定越界。
    expect(normalizeCitations([{ ref: 0, url: 'https://c.com' }])).toEqual([
      { url: 'https://c.com' },
    ]);
  });

  it('跳过无 url 的项与非数组输入', () => {
    expect(
      normalizeCitations([
        { title: '缺 url' },
        { url: '' },
        { url: 'javascript:alert(1)', title: '不安全链接' },
      ]),
    ).toEqual([]);
    expect(normalizeCitations(undefined)).toEqual([]);
    expect(normalizeCitations('x')).toEqual([]);
  });
});
