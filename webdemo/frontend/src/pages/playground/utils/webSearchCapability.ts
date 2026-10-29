import type { MapModel } from '@/api/map';

/**
 * 判断当前模型是否允许 Playground 联网搜索。
 *
 * 必须两个能力位同时具备，与后端入口（playground_web_search_http.go / l2_web_search_http.go）
 * 保持一致：托管搜索循环靠模型发 tool_calls 驱动，只勾 web_search 却不支持函数调用的模型
 * 不会真去检索，而是照着工具说明捏造一次调用再编出结果。少判一位的后果不是报错，
 * 而是用户拿到一个带假引用的、看起来很正经的回答。
 * @param capabilities 当前模型能力配置
 * @returns 当前模型是否可以展示并使用联网搜索
 */
export function canUsePlaygroundWebSearch(
  capabilities: MapModel['capabilities'] | undefined,
): boolean {
  return capabilities?.web_search === true && capabilities?.function_call === true;
}
