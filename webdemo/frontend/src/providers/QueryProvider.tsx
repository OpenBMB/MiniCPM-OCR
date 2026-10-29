import { useState, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * 创建全局 QueryClient 的默认配置。
 *
 * 用途：统一服务端状态（server state）的缓存与重试策略，避免各处 useState+useEffect
 * 手撸请求（硬规则 #4）。配置原则——
 * - staleTime 0：进入/切回页面（组件挂载）即视为过期并后台重拉，保证拿到最新数据；
 *   仍先展示缓存不闪烁。需要更长缓存的读（如当前用户、验证码配置）在各自 useQuery 里单独设 staleTime 覆盖。
 * - gcTime 5min：卸载后缓存保留 5 分钟，切回时先用缓存占位再后台刷新。
 * - retry 1：失败只自动重试 1 次；与 axios-retry（请求层 2 次）分层，避免叠加放大。
 * - refetchOnWindowFocus false：切回标签页不自动重拉，避免长表单/长列表抖动。
 *
 * 注意：BizError（业务错误码）已在请求层 reject，这里的 retry 仅对网络/超时类错误生效更合理；
 * 如需对 BizError 不重试，可在 retry 传函数按 error 类型判定。
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
 * 全局 Query Provider。
 *
 * 用途：在 host 壳层包裹整棵应用树，向 host 自身页面与所有 remote 提供同一个
 * QueryClient（配合联邦 singleton 的 react，远程组件可直接用 useQuery）。
 *
 * 用 useState 惰性初始化 client，保证每个浏览器会话只创建一个实例，
 * 不随 React 重渲染重建（重建会清空所有缓存）。
 */
export function QueryProvider({ children }: PropsWithChildren) {
  const [client] = useState(createQueryClient);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
