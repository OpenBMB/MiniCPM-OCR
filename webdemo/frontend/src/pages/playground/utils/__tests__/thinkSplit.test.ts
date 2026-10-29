import { describe, it, expect } from 'vitest';
import {
  createThinkSplitState,
  splitThinkDelta,
  flushThinkDelta,
  splitInlineThinkText,
  normalizeAssistantReply,
} from '../thinkSplit';

/** 模拟流式分片喂入拆分器 */
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

/** think 标签拆分与展示归一化单测 */
describe('splitInlineThinkText', () => {
  it('识别 think 标签', () => {
    const r = splitInlineThinkText('<think>先想</think>正式回答');
    expect(r.reasoning).toBe('先想');
    expect(r.content).toBe('正式回答');
  });

  it('识别 redacted_thinking 标签', () => {
    const r = splitInlineThinkText('<redacted_thinking>分析</redacted_thinking>结论');
    expect(r.reasoning).toBe('分析');
    expect(r.content).toBe('结论');
  });

  it('识别 thinking 标签', () => {
    const r = splitInlineThinkText('<thinking>步骤</thinking>结果');
    expect(r.reasoning).toBe('步骤');
    expect(r.content).toBe('结果');
  });
});

describe('normalizeAssistantReply', () => {
  it('从正文剥离 think 并合并已有 reasoning', () => {
    const r = normalizeAssistantReply('<think>内联思考</think>答案', '流式思考');
    expect(r.reasoning).toBe('内联思考流式思考');
    expect(r.content).toBe('答案');
  });

  it('reasoning 字段里若带标签也会剥离', () => {
    const r = normalizeAssistantReply('答案', '<think>标签内思考</think>');
    expect(r.reasoning).toBe('标签内思考');
    expect(r.content).toBe('答案');
  });

  it('检测到内部工具执行日志时不把整段日志暴露到思考区', () => {
    const r = normalizeAssistantReply(
      '真实答案',
      [
        '我会先检查当前实现，再整理答案。',
        '',
        '已查看 1 张图像',
        '已读取 SKILL.md',
        '已在 playground 中搜索“reasoning|tool_status”。',
      ].join('\n'),
    );

    expect(r).toEqual({ content: '真实答案', reasoning: '' });
  });

  it('正文中的内部工具日志只移除日志行，保留正常回答', () => {
    const r = normalizeAssistantReply(
      ['第一段正常回答', '', '已读取 AnswerProcessTimeline.tsx', '', '第二段正常回答'].join('\n'),
    );

    expect(r.content).toBe('第一段正常回答\n\n第二段正常回答');
  });

  it('没有内部工具日志时保留正常思考内容', () => {
    const r = normalizeAssistantReply('答案', '先判断问题，再给出结论。');
    expect(r).toEqual({ content: '答案', reasoning: '先判断问题，再给出结论。' });
  });
});

describe('splitThinkDelta streaming', () => {
  it('标签被分片切断仍可识别', () => {
    const r = runThinkSplit(['<thi', 'nk>思考', '中</thi', 'nk>答案']);
    expect(r.reasoning).toBe('思考中');
    expect(r.content).toBe('答案');
  });
});
