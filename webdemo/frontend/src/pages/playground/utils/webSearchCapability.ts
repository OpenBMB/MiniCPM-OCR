import type { MapModel } from '@/api/map';

/**
 * Whether the current model is allowed to use Playground web search.
 *
 * Both capability bits must be present, consistent with the backend entries (playground_web_search_http.go / l2_web_search_http.go):
 * the hosted search loop is driven by the model emitting tool_calls. A model with only web_search checked, and no function calling,
 * will not actually search; it fabricates one call from the tool description and then makes up a result. Missing one bit does not surface as an error,
 * and the user instead gets a serious-looking answer with fake citations.
 * @param capabilities capability config of the current model
 * @returns whether the current model may show and use web search
 */
export function canUsePlaygroundWebSearch(
  capabilities: MapModel['capabilities'] | undefined,
): boolean {
  return capabilities?.web_search === true && capabilities?.function_call === true;
}
