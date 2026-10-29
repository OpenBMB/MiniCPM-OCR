import { useRequest } from 'ahooks';

/**
 * Wraps ahooks useRequest with project-standard error handling.
 * Automatically handles loading / error / data states.
 *
 * @example
 * const { data, loading, error, run } = useApi(mapResourcesApi.getProjects);
 * const { data, run } = useApi(mapAuthApi.login, { manual: true });
 */
export function useApi<TData, TParams extends unknown[] = []>(
  service: (...args: TParams) => Promise<TData>,
  options?: Parameters<typeof useRequest<TData, TParams>>[1],
) {
  return useRequest<TData, TParams>(service, {
    ...options,
    onError: (error, params) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status !== 401) {
        console.error('[useApi]', error);
      }
      options?.onError?.(error, params);
    },
  });
}
