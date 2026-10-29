import { describe, expect, it } from 'vitest';
import { shouldStartNewConversationOnModelChange } from '../modelSwitch';

describe('模型切换会话边界', () => {
  it('已有消息时切换到不同模型，必须开启新会话', () => {
    expect(shouldStartNewConversationOnModelChange('MiniCPM-V-4.6-1B', 'MiniCPM5-1B', 2)).toBe(
      true,
    );
  });

  it('同一模型或空白会话不新建会话', () => {
    expect(shouldStartNewConversationOnModelChange('MiniCPM5-1B', 'MiniCPM5-1B', 4)).toBe(false);
    expect(shouldStartNewConversationOnModelChange('MiniCPM5-1B', 'MiniCPM-V-4.6-1B', 0)).toBe(
      false,
    );
  });
});
