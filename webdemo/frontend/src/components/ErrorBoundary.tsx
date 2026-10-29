import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_NAME } from '@/config/brand';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** 'page' renders inside admin layout; 'app' renders full-screen */
  level?: 'page' | 'app';
}

interface State {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryCopy {
  pageAssetLoadFailed: string;
  pageUnexpectedError: string;
  pageAssetLoadDescription: string;
  appLoadFailed: string;
  appAssetLoadDescription: string;
  appUnexpectedDescription: string;
  retry: string;
  reload: string;
  home: string;
}

interface ErrorBoundaryViewProps extends Props {
  copy: ErrorBoundaryCopy;
}

/**
 * Internationalized error boundary.
 *
 * Purpose: keep a retry entry when a route or the app fails to render, and let an already shown fallback respond to language changes.
 * @param props Children, an optional custom fallback, and the render level.
 * @returns A boundary that catches render errors in its subtree.
 */
export function ErrorBoundary({ children, fallback, level }: Props) {
  const { t } = useTranslation('status');
  const copy: ErrorBoundaryCopy = {
    pageAssetLoadFailed: t('errorBoundary.pageAssetLoadFailed'),
    pageUnexpectedError: t('errorBoundary.pageUnexpectedError'),
    pageAssetLoadDescription: t('errorBoundary.pageAssetLoadDescription'),
    appLoadFailed: t('errorBoundary.appLoadFailed'),
    appAssetLoadDescription: t('errorBoundary.appAssetLoadDescription'),
    appUnexpectedDescription: t('errorBoundary.appUnexpectedDescription'),
    retry: t('retry'),
    reload: t('errorBoundary.reload'),
    home: t('home'),
  };

  return (
    <ErrorBoundaryView fallback={fallback} level={level} copy={copy}>
      {children}
    </ErrorBoundaryView>
  );
}

class ErrorBoundaryView extends Component<ErrorBoundaryViewProps, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const isChunkError =
      this.state.error?.message?.includes('Failed to fetch dynamically imported module') ||
      this.state.error?.message?.includes('Loading chunk') ||
      this.state.error?.message?.includes('Loading CSS chunk');

    const level = this.props.level ?? 'page';

    if (level === 'app') {
      return (
        <AppCrashFallback
          error={this.state.error}
          isChunkError={!!isChunkError}
          copy={this.props.copy}
          onReload={this.handleReload}
        />
      );
    }

    return (
      <PageErrorFallback
        error={this.state.error}
        isChunkError={!!isChunkError}
        copy={this.props.copy}
        onRetry={this.handleReset}
        onReload={this.handleReload}
      />
    );
  }
}

function PageErrorFallback({
  error,
  isChunkError,
  copy,
  onRetry,
  onReload,
}: {
  error: Error | null;
  isChunkError: boolean;
  copy: ErrorBoundaryCopy;
  onRetry: () => void;
  onReload: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5 p-6 text-center animate-[fadeInUp_0.5s_ease-out]">
      {/* Icon */}
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10">
        {isChunkError ? (
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="hsl(var(--destructive))"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="hsl(var(--destructive))"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        )}
      </div>

      {/* Text */}
      <div className="space-y-1.5">
        <h3 className="text-lg font-semibold text-foreground">
          {isChunkError ? copy.pageAssetLoadFailed : copy.pageUnexpectedError}
        </h3>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {isChunkError
            ? copy.pageAssetLoadDescription
            : (error?.message ?? copy.pageUnexpectedError)}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        {!isChunkError && (
          <button
            type="button"
            onClick={onRetry}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted cursor-pointer"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
            {copy.retry}
          </button>
        )}
        <button
          type="button"
          onClick={onReload}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/25 transition-colors hover:bg-primary/90 cursor-pointer"
        >
          {copy.reload}
        </button>
      </div>
    </div>
  );
}

function AppCrashFallback({
  error,
  isChunkError,
  copy,
  onReload,
}: {
  error: Error | null;
  isChunkError: boolean;
  copy: ErrorBoundaryCopy;
  onReload: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/60 p-6 text-center">
      <div className="mx-auto max-w-md animate-[fadeInUp_0.5s_ease-out]">
        {/* Icon */}
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-destructive/10 to-warning/10">
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="hsl(var(--destructive))"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        {/* Text */}
        <h1 className="mt-6 text-2xl font-bold text-foreground">{copy.appLoadFailed}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {isChunkError ? copy.appAssetLoadDescription : copy.appUnexpectedDescription}
        </p>
        {error && !isChunkError && (
          <pre className="mx-auto mt-4 max-w-full overflow-auto rounded-lg bg-muted p-3 text-left text-xs text-muted-foreground">
            {error.message}
          </pre>
        )}

        {/* Actions */}
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={onReload}
            className="flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/25 transition-all hover:bg-primary/90 hover:shadow-lg cursor-pointer"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
            {copy.reload}
          </button>
          <a
            href={import.meta.env.BASE_URL}
            className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted cursor-pointer"
          >
            {copy.home}
          </a>
        </div>

        {/* Brand */}
        <p className="mt-10 text-xs text-muted-foreground/50">{APP_NAME}</p>
      </div>
    </div>
  );
}
