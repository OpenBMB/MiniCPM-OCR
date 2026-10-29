import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseQueryOptions } from '@tanstack/react-query';

/**
 * Server-state query pattern (team copy template).
 *
 * Purpose: show the standard way to write server-cacheable data — TanStack Query, rather than useState+useEffect
 * hand-written (hard rule #4). Copy this file for a new feature area: define a queryKey factory plus useXxxQuery/useXxxMutation.
 *
 * Division of work with ahooks useApi (important, so the two approaches are not mixed):
 * - TanStack Query (this file): server cacheable state — lists, details, leaderboards, and other read-heavy data
 *   that needs caching, automatic invalidation, or sharing across components.
 * - ahooks useApi (hooks/useApi.ts): imperative one-shot actions — login, form submit, upload, and similar
 *   side effects that are not cached and are triggered manually.
 *
 * queryKey convention: manage keys in factory functions so scattered string arrays do not drift, and so caches can be invalidated precisely.
 */

/** queryKey factory: centralize every cache key for a feature area */
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
 * Query a list (demo).
 *
 * When wiring a real API, replace queryFn with `() => request.get<PageResult<ExampleItem>>('/xxx', { params })`.
 * The request layer already unwraps the payload and returns data directly. A mock Promise stands in here so the pattern runs without a backend.
 *
 * @param params Pagination and filter parameters
 * @param options Extra config passed through to useQuery (for example enabled, to control dependent queries)
 */
export function useExampleListQuery(
  params: ExampleListParams,
  options?: Omit<UseQueryOptions<ExampleItem[]>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: exampleKeys.list(params),
    queryFn: async (): Promise<ExampleItem[]> => {
      // TODO(wire the real API): return request.get<ExampleItem[]>('/example/list', { params });
      return [{ id: '1', name: '示例条目' }];
    },
    ...options,
  });
}

/**
 * Submit and invalidate the list cache (demo mutation plus cache invalidation).
 *
 * On success, invalidateQueries refetches the related lists so reads after writes stay consistent.
 * This is the main gain over a hand-written approach: local state does not have to be synced by hand.
 */
export function useCreateExampleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string }): Promise<ExampleItem> => {
      // TODO(wire the real API): return request.post<ExampleItem>('/example', input);
      return { id: '2', name: input.name };
    },
    onSuccess: () => {
      // Invalidate every list query in this feature area so they refetch automatically
      queryClient.invalidateQueries({ queryKey: exampleKeys.lists() });
    },
  });
}
