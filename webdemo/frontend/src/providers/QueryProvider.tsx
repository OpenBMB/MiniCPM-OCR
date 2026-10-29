import { useState, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Default configuration for the global QueryClient.
 *
 * Purpose: one cache and retry policy for server state, instead of hand-rolled useState and useEffect
 * requests everywhere (hard rule #4). Principles:
 * - staleTime 0: entering or returning to a page (component mount) treats data as stale and refetches in the background, so the latest data is fetched;
 *   cached data is still shown first, without a flash. Reads that need a longer cache (such as the current user or captcha config) override staleTime in their own useQuery.
 * - gcTime 5min: after unmount the cache is kept for 5 minutes; coming back shows the cache first, then refreshes in the background.
 * - retry 1: a failure retries automatically once; layered with axios-retry (2 retries in the request layer) so they do not stack and amplify.
 * - refetchOnWindowFocus false: switching back to the tab does not refetch, so long forms and long lists do not jump.
 *
 * Note: BizError (business error codes) is already rejected in the request layer, so retry here fits network and timeout errors better;
 * to skip retries for BizError, pass a function to retry and decide by error type.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

/**
 * Global Query Provider.
 *
 * Purpose: wrap the whole app tree in the host shell and give the host pages and every remote the same
 * QueryClient (with the federated React singleton, a remote component can call useQuery directly).
 *
 * The client is created lazily with useState so each browser session has one instance,
 * and React re-renders do not rebuild it (rebuilding would drop every cache).
 */
export function QueryProvider({ children }: PropsWithChildren) {
  const [client] = useState(createQueryClient);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
