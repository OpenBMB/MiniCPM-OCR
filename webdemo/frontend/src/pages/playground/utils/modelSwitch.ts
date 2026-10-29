/**
 * 判断用户主动切换语言模型时是否必须开启新会话。
 * 同一模型、空白会话和恢复历史会话的模型回填均不需要清空当前上下文。
 */
export function shouldStartNewConversationOnModelChange(
  currentModelId: string,
  nextModelId: string,
  messageCount: number,
): boolean {
  return currentModelId !== nextModelId && messageCount > 0;
}
