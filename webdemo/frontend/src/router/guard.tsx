import { type PropsWithChildren } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getToken } from '@/api/map';
import { whiteList } from './constants';

/**
 * Login guard: mirrors the old portal — logged in when `localStorage['map_token']` exists.
 *
 * Purpose: an unauthenticated visit to a protected route redirects to `/login`. MAP auth is decided live by the backend `platform_role`;
 * the frontend has no built-in role or permission system, so the guard only checks that a token exists and does not check permission codes.
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
