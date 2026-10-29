import { type PropsWithChildren } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getToken } from '@/api/map';
import { whiteList } from './constants';

/**
 * 登录守卫：照搬老 portal 的判定——以 `localStorage['map_token']` 是否存在判断登录态。
 *
 * 用途：未登录访问受保护路由时跳转 `/login`。MAP 鉴权由后端 `platform_role` 实时判定，
 * 前端无内置角色/权限体系，故守卫只判断 token 是否存在，不做权限码校验。
 */
export function AuthGuard({ children }: PropsWithChildren) {
  const location = useLocation();
  const authed = Boolean(getToken());

  if (whiteList.includes(location.pathname)) {
    return <>{children}</>;
  }

  if (!authed) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
