import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import { mapAuthApi, mapKeys } from '@/api/map';
import { PageLoading } from '@/components/PageLoading';

/**
 * Portal 强制绑定手机号守卫。
 *
 * 用途：邮箱认证且没有手机号的会话只能进入绑定页；后端中间件同时做接口级兜底。
 * @param children 已通过手机号绑定检查后渲染的页面
 * @returns 绑定检查中的加载态、绑定页跳转或业务页面
 */
export function PhoneBindingGuard({ children }: PropsWithChildren) {
  const location = useLocation();
  const isBindingPage = location.pathname.endsWith('/bind-phone');
  const meQuery = useQuery({
    queryKey: mapKeys.me(),
    queryFn: mapAuthApi.me,
    enabled: !isBindingPage,
  });

  if (isBindingPage) {
    return <>{children}</>;
  }
  if (meQuery.isLoading) {
    return <PageLoading />;
  }

  const user = meQuery.data;
  if (user?.phone_binding_required && !user.phone) {
    return <Navigate to="/bind-phone" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
