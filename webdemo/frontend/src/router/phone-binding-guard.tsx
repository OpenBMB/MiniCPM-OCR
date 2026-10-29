import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import { mapAuthApi, mapKeys } from '@/api/map';
import { PageLoading } from '@/components/PageLoading';

/**
 * Portal guard that requires a bound mobile number.
 *
 * Purpose: an email-authenticated session with no mobile number can only enter the binding page; backend middleware also enforces this on the API.
 * @param children Pages rendered after the mobile-number check passes.
 * @returns A loading state while checking, a redirect to the binding page, or the business page.
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
