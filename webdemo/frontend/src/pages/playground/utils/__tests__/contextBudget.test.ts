import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../types';
import { buildContextWindowPlan } from '../contextBudget';

function message(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return { id, role, content };
}

describe('buildContextWindowPlan', () => {
  it('为输出与安全余量预留输入预算', () => {
    const plan = buildContextWindowPlan([message('u1', 'user', 'hello')], {
      contextWindow: 10_000,
      modelMaxOutputTokens: 2_000,
    });

    expect(plan.inputBudgetTokens).toBeLessThan(8_000);
    expect(plan.reservedOutputTokens).toBe(2_000);
    expect(plan.requestMessages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('超出预算时优先剔除最早的完整问答轮次', () => {
    const plan = buildContextWindowPlan(
      [
        message('u1', 'user', '旧问题 '.repeat(30)),
        message('a1', 'assistant', '旧回答 '.repeat(30)),
        message('u2', 'user', '新问题 '.repeat(12)),
        message('a2', 'assistant', '新回答 '.repeat(12)),
        message('u3', 'user', '当前问题 '.repeat(12)),
      ],
      { contextWindow: 528, modelMaxOutputTokens: 200 },
    );

    expect(plan.trimmedMessageCount).toBe(2);
    expect(plan.requestMessages.map((item) => item.content)).toEqual([
      '新问题 '.repeat(12),
      '新回答 '.repeat(12),
      '当前问题 '.repeat(12),
    ]);
  });

  it('保留系统提示与当前提问，当前提问自身超额时阻止发送', () => {
    const plan = buildContextWindowPlan([message('u1', 'user', '很长的输入'.repeat(300))], {
      contextWindow: 500,
      modelMaxOutputTokens: 200,
      systemPrompt: '你是一个严谨的助手。',
    });

    expect(plan.requestMessages[0]).toEqual({ role: 'system', content: '你是一个严谨的助手。' });
    expect(plan.requestMessages[plan.requestMessages.length - 1]).toEqual({
      role: 'user',
      content: '很长的输入'.repeat(300),
    });
    expect(plan.isOverBudget).toBe(true);
  });

  it('无上下文窗口声明时不裁剪历史', () => {
    const history = [message('u1', 'user', '问题'), message('a1', 'assistant', '回答')];
    const plan = buildContextWindowPlan(history, { contextWindow: 0, modelMaxOutputTokens: 0 });

    expect(plan.inputBudgetTokens).toBeNull();
    expect(plan.trimmedMessageCount).toBe(0);
    expect(plan.isOverBudget).toBe(false);
    expect(plan.requestMessages).toEqual([
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '回答' },
    ]);
  });

  it('上下文预算同样排除刷新中断的部分回答', () => {
    const plan = buildContextWindowPlan(
      [
        message('u1', 'user', '第一问'),
        { ...message('a1', 'assistant', '不完整回答'), interrupted: true },
        message('u2', 'user', '第二问'),
      ],
      { contextWindow: 0, modelMaxOutputTokens: 0 },
    );

    expect(plan.requestMessages).toEqual([
      { role: 'user', content: '第一问' },
      { role: 'user', content: '第二问' },
    ]);
  });

  it('上下文预算排除安审拦截轮次，但保留后续正常提问', () => {
    const plan = buildContextWindowPlan(
      [
        { ...message('u1', 'user', '被拦截的请求'), contextExcluded: true },
        {
          ...message('a1', 'assistant', '这条内容暂时无法继续处理，换个话题试试吧。'),
          contextExcluded: true,
        },
        message('u2', 'user', '正常继续提问'),
      ],
      { contextWindow: 0, modelMaxOutputTokens: 0 },
    );

    expect(plan.requestMessages).toEqual([{ role: 'user', content: '正常继续提问' }]);
  });
});
