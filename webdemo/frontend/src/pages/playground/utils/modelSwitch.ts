/**
 * Whether the user switching language models on purpose must start a new conversation.
 * The same model, a blank conversation, and filling the model back in when restoring a history conversation do not need to clear the current context.
 */
export function shouldStartNewConversationOnModelChange(
  currentModelId: string,
  nextModelId: string,
  messageCount: number,
): boolean {
  return currentModelId !== nextModelId && messageCount > 0;
}
