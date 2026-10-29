/**
 * 消息流容器。
 *
 * 用途：渲染消息气泡列表并自动吸底（流式增量时滚到底，用户上滚阅读时停止吸底）。
 * 用原生滚动容器（而非 OverlayScrollArea），以便 useAutoScroll 直接控制 scrollTop。
 */

import { useAutoScroll } from '../hooks/useAutoScroll';
import { useTranslation } from 'react-i18next';
import type { ChatMessage, Citation, MessageFeedback } from '../types';
import { MessageBubble } from './MessageBubble';

interface MessageListProps {
  messages: ChatMessage[];
  /** 重新生成某条 assistant 消息 */
  onRegenerate?: (assistantId: string) => void;
  /** 切换某条 assistant 消息的反馈态 */
  onFeedback?: (assistantId: string, kind: MessageFeedback) => void;
  /** 切换某条 assistant 消息显示的回答版本 */
  onSwitchVersion?: (assistantId: string, index: number) => void;
  /** 是否正在生成（透传给操作栏禁用重新生成） */
  loading?: boolean;
  /** 当前模型是否允许展示思考（false 时不渲染任何消息的思考区，含历史会话） */
  showReasoning?: boolean;
  /** 打开布局级引用侧栏。 */
  onOpenCitations?: (messageId: string, citations: Citation[], activeUrl?: string) => void;
  /** 当前正在展示引用侧栏的消息 ID。 */
  openCitationsMessageId?: string;
}

/**
 * 滚动消息流。
 * @param messages 消息列表
 * @param onRegenerate 重新生成回调
 * @param onFeedback 反馈回调
 * @param onSwitchVersion 版本切换回调
 * @param loading 是否生成中
 * @param showReasoning 是否允许展示思考
 */
export function MessageList({
  messages,
  onRegenerate,
  onFeedback,
  onSwitchVersion,
  loading,
  showReasoning = true,
  onOpenCitations,
  openCitationsMessageId,
}: MessageListProps) {
  const { t } = useTranslation('playground');
  // 工具状态与引用也会改变消息高度；内容容器的 ResizeObserver 负责兜住异步排版变化。
  const last = messages[messages.length - 1];
  const updateKey = [
    messages.length,
    last?.content.length ?? 0,
    last?.reasoning?.length ?? 0,
    last?.searchStep ?? '',
    last?.searchResultCount ?? '',
    last?.searchActiveTool ?? '',
    last?.searchBrowseCount ?? '',
    last?.searchQueries?.join('|') ?? '',
    last?.searchTools?.join('|') ?? '',
    last?.searchStatus ?? '',
    last?.citations?.length ?? 0,
    last?.error?.length ?? 0,
    last?.streaming ? 'streaming' : 'idle',
  ].join(':');

  // 最后一条 assistant 消息用于操作栏；最后一条 user 消息作为“新一轮”滚动重置标识。
  let lastAssistantId: string | undefined;
  let lastUserId: string | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!lastAssistantId && messages[i].role === 'assistant' && !messages[i].divider) {
      lastAssistantId = messages[i].id;
    }
    if (!lastUserId && messages[i].role === 'user' && !messages[i].divider) {
      lastUserId = messages[i].id;
    }
    if (lastAssistantId && lastUserId) break;
  }
  const { scrollRef, contentRef, onScroll, onWheel, onTouchMove, onKeyDown, onPointerDown } =
    useAutoScroll(updateKey, lastUserId ?? last?.id ?? 'empty');

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      onWheel={onWheel}
      onTouchMove={onTouchMove}
      onKeyDown={onKeyDown}
      /* 点击引起的高度变化（展开思考过程、切换版本）不吸底，见 useAutoScroll 里的说明 */
      onPointerDown={onPointerDown}
      className="h-full overflow-y-auto"
    >
      <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        {messages.map((m) =>
          m.divider ? (
            <ContextDivider key={m.id} label={t('contextCleared')} />
          ) : (
            <MessageBubble
              key={m.id}
              message={m}
              onRegenerate={onRegenerate}
              onFeedback={onFeedback}
              onSwitchVersion={onSwitchVersion}
              loading={loading}
              isLastAssistant={m.id === lastAssistantId}
              showReasoning={showReasoning}
              onOpenCitations={onOpenCitations}
              citationsOpen={m.id === openCitationsMessageId}
            />
          ),
        )}
      </div>
    </div>
  );
}

/** 上下文分隔线：一条带「上下文已清除」居中文案的横线，标记此后对话不再携带其上历史 */
function ContextDivider({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-3 py-1 text-[11px] text-muted-foreground/60"
      role="separator"
    >
      <span className="h-px flex-1 bg-border" />
      <span className="shrink-0">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
