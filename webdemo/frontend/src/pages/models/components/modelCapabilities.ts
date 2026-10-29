/** 模型控制台已不在这个演示里。这里只留下游乐场还在用的能力判断。 */

export const PLAYGROUND_TOGGLE_KEYS = {
  showReasoning: 'show_reasoning',
} as const;

export function allowsReasoning(capabilities?: Record<string, boolean>): boolean {
  return capabilities?.deep_thinking === true;
}
