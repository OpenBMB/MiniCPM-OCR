/** The model console is not part of this demo. Only the capability checks the playground still uses remain here. */

export const PLAYGROUND_TOGGLE_KEYS = {
  showReasoning: 'show_reasoning',
} as const;

export function allowsReasoning(capabilities?: Record<string, boolean>): boolean {
  return capabilities?.deep_thinking === true;
}
