import { ChevronDown, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, cn, Tooltip, TooltipContent, TooltipTrigger } from '@map/ui';

/** The history list consumes only a lightweight title and identity; it does not hold document or conversation body text. */
export interface SidebarSession {
  id: string;
  title: string;
  /** Built-in OCR examples and user-upload history are shown separately, without changing the local record identity. */
  category?: 'example';
}

/** Each experience supplies its own data and behavior; history display shares one component. */
export interface PlaygroundSidebarHistory {
  sessions: readonly SidebarSession[];
  activeSessionId?: string;
  /** Cloud record being restored; only the current row shows status, and the user is not blocked from switching to other records. */
  pendingSessionId?: string;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onNewChat: () => void;
  loading?: boolean;
  storageError?: string;
  /** Non-blocking hints such as a temporary save, distinguished from a real data error. */
  storageNotice?: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

interface PlaygroundHistoryListProps extends PlaygroundSidebarHistory {
  kind: 'language' | 'image-parse' | 'image-parse-cases';
  /** After grouping, still judge the first load from the full cache, so an empty group does not change height during a background refresh. */
  hasCachedSessions?: boolean;
  /** When several groups share the parent scroll container, do not create an inner scroll region that would break the scroll chain. */
  scrollMode?: 'self' | 'parent';
}

const LIST_LABELS = {
  language: { title: 'recentConversations', region: 'recentConversationsList' },
  'image-parse': { title: 'imageParseHistory', region: 'imageParseHistoryList' },
  'image-parse-cases': { title: 'imageParseCases', region: 'imageParseCasesList' },
} as const;

/** Left history shared by language chat and OCR: scroll on its own or with the parent, current item, new, delete, and paging. */
export function PlaygroundHistoryList({
  kind,
  sessions,
  hasCachedSessions = sessions.length > 0,
  scrollMode = 'self',
  activeSessionId,
  pendingSessionId,
  onSelectSession,
  onDeleteSession,
  onNewChat,
  loading,
  storageError,
  storageNotice,
  hasMore,
  loadingMore,
  onLoadMore,
}: PlaygroundHistoryListProps) {
  const { t } = useTranslation('playground');
  const documentHistory = kind !== 'language';
  const caseList = kind === 'image-parse-cases';
  const initialLoading = loading && !hasCachedSessions;
  const visibleStorageError =
    kind === 'image-parse' && storageError === 'imageParseHistoryStorageError'
      ? undefined
      : storageError;
  const labels = LIST_LABELS[kind];
  const newLabel = t(documentHistory ? 'imageParseNewDocument' : 'newConversation');
  return (
    <div
      className={cn(
        'mt-4 flex min-h-0 flex-col',
        scrollMode === 'parent' ? 'shrink-0' : !caseList && 'flex-1',
      )}
      data-tour={documentHistory ? `image-parse-${caseList ? 'cases' : 'history'}` : undefined}
    >
      <div className="flex shrink-0 items-center justify-between px-5 pb-1 pt-2">
        <span className="text-[11px] font-medium text-muted-foreground/70">{t(labels.title)}</span>
        {!caseList ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onNewChat}
                aria-label={newLabel}
                className="size-6 rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground [@media(pointer:coarse)]:size-11"
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{newLabel}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div
        role="region"
        aria-label={t(labels.region)}
        aria-busy={Boolean(loading || pendingSessionId)}
        className={cn(
          'px-2 pb-2',
          scrollMode === 'parent'
            ? 'shrink-0 overflow-visible'
            : 'min-h-0 flex-1 overflow-y-auto overscroll-contain',
        )}
      >
        {visibleStorageError ? (
          <p role="alert" className="px-3 py-2 text-xs text-destructive">
            {t(visibleStorageError)}
          </p>
        ) : null}
        {!caseList && !storageError && storageNotice ? (
          <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
            {t(storageNotice)}
          </p>
        ) : null}
        {/* When entries already exist, a background refresh does not insert a placeholder row, so switching history does not shift the whole column. */}
        {initialLoading && !sessions.length ? (
          <p
            role="status"
            className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
          >
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            {t(documentHistory ? 'imageParseHistoryLoading' : 'loadingConversations')}
          </p>
        ) : null}
        {!sessions.length && !initialLoading && !storageError ? (
          <p className="px-3 py-2 text-xs text-muted-foreground/60">
            {t(documentHistory ? 'imageParseHistoryEmpty' : 'noConversationRecords')}
          </p>
        ) : null}
        <div className="flex flex-col gap-0.5">
          {sessions.map((session) => {
            const active = session.id === activeSessionId;
            const pending = session.id === pendingSessionId;
            const deleteLabel = t(
              documentHistory ? 'imageParseHistoryDelete' : 'deleteConversationWithTitle',
              { title: session.title, name: session.title },
            );
            return (
              <div
                key={session.id}
                data-history-row=""
                className={cn(
                  'group/session flex items-center gap-1 rounded-lg pr-1 transition-colors',
                  active
                    ? 'bg-muted/70 text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50',
                )}
              >
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onSelectSession(session.id)}
                  aria-label={
                    documentHistory
                      ? t('imageParseHistoryOpen', { name: session.title })
                      : undefined
                  }
                  aria-busy={pending}
                  aria-current={active ? 'true' : undefined}
                  title={session.title}
                  className="h-8 min-w-0 flex-1 justify-start px-3 py-1.5 text-left text-[13px] font-normal text-inherit hover:bg-transparent hover:text-foreground [@media(pointer:coarse)]:h-11"
                >
                  {pending ? (
                    <LoaderCircle
                      className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="min-w-0 truncate">{session.title}</span>
                </Button>
                {!caseList ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onDeleteSession(session.id)}
                        aria-label={deleteLabel}
                        className="size-6 shrink-0 rounded text-muted-foreground/60 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover/session:opacity-100 [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:opacity-100"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{deleteLabel}</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            );
          })}
        </div>
        {hasMore && onLoadMore ? (
          <div className="px-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="w-full gap-1.5 text-xs font-normal text-muted-foreground disabled:cursor-wait"
            >
              {t(loadingMore ? 'loadingConversations' : 'loadMoreConversations')}
              {!loadingMore ? <ChevronDown className="size-3.5" aria-hidden="true" /> : null}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
