import { ChevronDown, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, cn, Tooltip, TooltipContent, TooltipTrigger } from '@map/ui';

/** 历史列表只消费轻量标题与身份，不持有文档或对话正文。 */
export interface SidebarSession {
  id: string;
  title: string;
  /** 内置 OCR 案例与用户上传历史分开展示，不改变本地记录身份。 */
  category?: 'example';
}

/** 各体验提供自己的数据与行为，历史展示共用同一组件。 */
export interface PlaygroundSidebarHistory {
  sessions: readonly SidebarSession[];
  activeSessionId?: string;
  /** 正在恢复的云端记录；仅当前行显示状态，不禁止用户切换其他记录。 */
  pendingSessionId?: string;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onNewChat: () => void;
  loading?: boolean;
  storageError?: string;
  /** 临时保存等非阻断提示，与真正的数据错误区分。 */
  storageNotice?: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

interface PlaygroundHistoryListProps extends PlaygroundSidebarHistory {
  kind: 'language' | 'image-parse' | 'image-parse-cases';
  /** 分组后仍按完整缓存判断首次加载，避免空分组在后台刷新时改变高度。 */
  hasCachedSessions?: boolean;
  /** 多个分组共用父级滚动容器时，内部不创建会阻断滚动链的滚动区域。 */
  scrollMode?: 'self' | 'parent';
}

const LIST_LABELS = {
  language: { title: 'recentConversations', region: 'recentConversationsList' },
  'image-parse': { title: 'imageParseHistory', region: 'imageParseHistoryList' },
  'image-parse-cases': { title: 'imageParseCases', region: 'imageParseCasesList' },
} as const;

/** 语言对话与 OCR 共用的左侧历史：独立或随父级滚动、当前条目、新建、删除和分页。 */
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
        {/* 已有条目时后台刷新不插入占位行，避免切换历史引发整列位移。 */}
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
