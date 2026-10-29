import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseQueryOptions } from '@tanstack/react-query';

/**
 * 服务端状态查询范式（团队复制模板）。
 *
 * 用途：演示「服务端可缓存数据」的标准写法——用 TanStack Query，而非 useState+useEffect
 * 手撸（硬规则 #4）。新功能域照此文件复制：定义 queryKey 工厂 + useXxxQuery/useXxxMutation。
 *
 * 与 ahooks useApi 的分工（重要，避免两套方案混用）：
 * - TanStack Query（本文件）：服务端「可缓存状态」——列表、详情、Leaderboard 等读多写少、
 *   需要缓存 / 自动失效 / 跨组件共享的数据。
 * - ahooks useApi（hooks/useApi.ts）：命令式「一次性动作」——登录、提交表单、上传等
 *   不进缓存、手动触发的副作用。
 *
 * queryKey 约定：用工厂函数集中管理，避免散落的字符串数组拼写漂移，便于精确失效缓存。
 */

/** queryKey 工厂：集中管理某功能域的所有缓存键 */
export const exampleKeys = {
  all: ['example'] as const,
  lists: () => [...exampleKeys.all, 'list'] as const,
  list: (params: ExampleListParams) => [...exampleKeys.lists(), params] as const,
  details: () => [...exampleKeys.all, 'detail'] as const,
  detail: (id: string) => [...exampleKeys.details(), id] as const,
};

export interface ExampleListParams {
  page: number;
  pageSize: number;
  keyword?: string;
}

export interface ExampleItem {
  id: string;
  name: string;
}

/**
 * 查询列表（演示）。
 *
 * 真实接入时把 queryFn 换成 `() => request.get<PageResult<ExampleItem>>('/xxx', { params })`，
 * 请求层已做解包，直接返回数据。此处用 mock Promise 占位，保证无后端也能跑通范式。
 *
 * @param params 分页与筛选参数
 * @param options 透传给 useQuery 的额外配置（如 enabled 控制依赖查询）
 */
export function useExampleListQuery(
  params: ExampleListParams,
  options?: Omit<UseQueryOptions<ExampleItem[]>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: exampleKeys.list(params),
    queryFn: async (): Promise<ExampleItem[]> => {
      // TODO(接真实接口): return request.get<ExampleItem[]>('/example/list', { params });
      return [{ id: '1', name: '示例条目' }];
    },
    ...options,
  });
}

/**
 * 提交并使列表缓存失效（演示 mutation + 缓存失效）。
 *
 * 成功后用 invalidateQueries 让相关列表自动重拉，保证「写后读一致」，
 * 这是相对手撸方案最大的收益点：无需手动同步本地状态。
 */
export function useCreateExampleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string }): Promise<ExampleItem> => {
      // TODO(接真实接口): return request.post<ExampleItem>('/example', input);
      return { id: '2', name: input.name };
    },
    onSuccess: () => {
      // 让该功能域所有列表查询失效 → 自动重新获取
      queryClient.invalidateQueries({ queryKey: exampleKeys.lists() });
    },
  });
}
