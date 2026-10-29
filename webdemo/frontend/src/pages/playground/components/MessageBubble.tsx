/**
 * 单条对话消息气泡。
 *
 * 用途：用户消息右对齐实心气泡；助手消息左对齐，自上而下为过程时间线（思考与工具交错的
 * 单一折叠区）+ markdown 正文 + 来源胶囊 + 流式光标 + usage/错误标注 + 操作栏。
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage, Citation, MessageFeedback } from '../types';
import { LazyMarkdownRenderer } from './MarkdownRenderer';
import { AnswerProcessTimeline } from './AnswerProcessTimeline';
import { SourcesChip } from './SourcesChip';
import { ImageLightbox } from './ImageLightbox';
import { AttachmentPreview } from './AttachmentPreview';
import { MessageMetrics } from './MessageMetrics';
import { MessageActions } from './MessageActions';
import { normalizeAssistantReply } from '../utils/thinkSplit';

interface MessageBubbleProps {
  message: ChatMessage;
  /** 重新生成该条 assistant 消息（截断重发） */
  onRegenerate?: (assistantId: string) => void;
  /** 切换该条 assistant 消息的反馈态（赞/踩） */
  onFeedback?: (assistantId: string, kind: MessageFeedback) => void;
  /** 切换该条 assistant 消息显示的回答版本（‹n/N› 翻页） */
  onSwitchVersion?: (assistantId: string, index: number) => void;
  /** 是否正在生成（生成中禁用重新生成按钮） */
  loading?: boolean;
  /** 是否为最后一条 assistant 消息：仅此条展示「重新生成」，避免对中间轮次重发误删其后对话 */
  isLastAssistant?: boolean;
  /** 当前模型是否允许展示思考（false 时不渲染思考折叠区，含历史会话已存的 reasoning） */
  showReasoning?: boolean;
  /**
   * 打开布局级引用侧栏。
   * 第三参 activeUrl 由正文角标点击带上，让面板滚到该条并高亮；「查看全部」不带，表示只开面板。
   */
  onOpenCitations?: (messageId: string, citations: Citation[], activeUrl?: string) => void;
  /** 当前消息是否正在展示引用侧栏。 */
  citationsOpen?: boolean;
}

/**
 * 渲染一条消息。
 * @param message 消息数据
 * @param onRegenerate 重新生成回调
 * @param onFeedback 反馈回调
 * @param onSwitchVersion 版本切换回调
 * @param loading 是否生成中
 * @param isLastAssistant 是否为最后一条 assistant
 * @param showReasoning 是否允许展示思考
 */
export function MessageBubble({
  message,
  onRegenerate,
  onFeedback,
  onSwitchVersion,
  loading,
  isLastAssistant,
  showReasoning = true,
  onOpenCitations,
  citationsOpen = false,
}: MessageBubbleProps) {
  const { t } = useTranslation('playground');
  // 点击放大预览的图片（用户消息内）
  const [preview, setPreview] = useState<string | null>(null);

  // 展示层兜底：剥离正文中残留的内联 think 标签，合并进 reasoning 折叠区
  const display = useMemo(
    () => normalizeAssistantReply(message.content, message.reasoning),
    [message.content, message.reasoning],
  );
  // 改写过的思考与工具事件里记的字符偏移对不上，时间线要据此退化为「思考整块置顶」
  const reasoningRewritten = display.reasoning !== (message.reasoning ?? '');

  // 必须 useCallback：这个回调会进 MarkdownRenderer 的 memo 比较与 components 的 useMemo 依赖，
  // 每渲染新建会让流式期间每一帧都重解析整篇 Markdown。
  const activateCitation = useCallback(
    (citation: Citation) => {
      onOpenCitations?.(message.id, message.citations ?? [], citation.url);
    },
    [message.citations, message.id, onOpenCitations],
  );

  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {message.attachments && message.attachments.length > 0 && (
          <div className="max-w-[80%]">
            <AttachmentPreview
              attachments={message.attachments}
              align="end"
              onImageClick={setPreview}
            />
          </div>
        )}
        {message.content && (
          <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2.5 text-[14px] leading-6 text-primary-foreground">
            {message.content}
          </div>
        )}
        <ImageLightbox src={preview} onClose={() => setPreview(null)} />
      </div>
    );
  }

  // 等待首增量：已有过程区（联网块或思考块）时由它承担状态反馈，避免其下方重复出现悬空等待点。
  const showCursor = message.streaming && !display.content && !display.reasoning;
  // 与 AnswerProcessTimeline 的渲染条件保持一致：过程区在场就由它承担等待反馈
  const hasAnswerProcess = Boolean(
    (showReasoning && display.reasoning.trim()) ||
    message.toolEvents?.length ||
    (message.searching && message.streaming) ||
    message.searchStep === 'failed',
  );
  const citations = message.citations ?? [];

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[88%]">
        <AnswerProcessTimeline
          reasoning={display.reasoning}
          showReasoning={showReasoning}
          reasoningRewritten={reasoningRewritten}
          streaming={message.streaming}
          toolEvents={message.toolEvents}
          citations={message.citations}
          searching={message.searching}
          searchStep={message.searchStep}
          searchActiveTool={message.searchActiveTool}
          searchStatus={message.searchStatus}
          /* 过程里的搜索行与回答末尾的胶囊通往同一个抽屉，不带 activeUrl 表示只开面板 */
          onOpenSources={onOpenCitations ? () => onOpenCitations(message.id, citations) : undefined}
          hasAnswer={Boolean(display.content)}
        />

        {display.content && (
          <LazyMarkdownRenderer
            content={display.content}
            streaming={message.streaming}
            citations={message.citations}
            onCitationActivate={onOpenCitations ? activateCitation : undefined}
          />
        )}
        {!display.content && !hasAnswerProcess && showCursor && <ThinkingDots />}

        {/* 来源胶囊：正文落地后再出现，避免流式期间反复重排 */}
        {!message.streaming && (
          <SourcesChip
            citations={citations}
            onOpen={onOpenCitations ? () => onOpenCitations(message.id, citations) : undefined}
            panelOpen={citationsOpen}
          />
        )}

        {message.errorCode === 'content_policy_violation' && (
          <LazyMarkdownRenderer content={message.error ?? ''} streaming={false} />
        )}

        {message.error && message.errorCode !== 'content_policy_violation' && (
          <div className="mt-2 max-w-full whitespace-pre-wrap break-words rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            {message.error}
          </div>
        )}

        {message.interrupted && (
          <div className="mt-2 text-xs text-muted-foreground">{t('answerInterrupted')}</div>
        )}

        {(message.usage || message.metrics) && !message.streaming && (
          <MessageMetrics metrics={message.metrics} usage={message.usage} />
        )}

        {/* 操作栏：已完成的 assistant 消息展示。失败(仅 error 无正文)时只保留「重新生成」，
            由 MessageActions 内部按 content 是否为空决定是否渲染复制/点赞/点踩；多版本消息显示 ‹n/N›。 */}
        {!message.streaming &&
          !message.contextExcluded &&
          (display.content || message.error || message.interrupted) &&
          onRegenerate &&
          onFeedback && (
            <MessageActions
              content={display.content}
              feedback={message.feedback}
              showRegenerate={isLastAssistant}
              disableRegenerate={loading}
              onRegenerate={() => onRegenerate(message.id)}
              onFeedback={(kind) => onFeedback(message.id, kind)}
              versionCount={message.versions?.length}
              activeVersion={message.activeVersion}
              onSwitchVersion={onSwitchVersion ? (i) => onSwitchVersion(message.id, i) : undefined}
            />
          )}
      </div>
    </div>
  );
}

/** 等待首个增量时的「正在生成」动画 */
function ThinkingDots() {
  const { t } = useTranslation('playground');
  return (
    <div className="flex items-center gap-1 py-2" aria-label={t('generating')}>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}
