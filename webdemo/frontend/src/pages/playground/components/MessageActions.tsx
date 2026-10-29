/**
 * 助手消息操作栏（复制 / 重新生成 / 点赞 / 点踩）。
 *
 * 用途：挂在每条已完成的 assistant 消息下方。复制正文到剪贴板；重新生成截断重发；
 * 点赞/点踩切换本地高亮并触发 /feedback 上报（二者互斥、可再次点击取消）。
 * 联网来源不在这里：由回答正文下方的来源胶囊 SourcesChip 通往来源抽屉。
 *
 * @param content     待复制的助手正文
 * @param feedback    当前反馈态（'up' | 'down' | undefined）
 * @param showRegenerate 是否展示「重新生成」（仅最后一条 assistant 为真，避免中间轮次重发误删后续对话）
 * @param onRegenerate 重新生成回调
 * @param onFeedback  切换反馈态回调（传入点击的类型，由上层做互斥/取消）
 * @param disableRegenerate 生成中禁用重新生成
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger, useToast } from '@map/ui';

import { copyText } from '../utils/copyText';
import type { MessageFeedback } from '../types';

interface MessageActionsProps {
  content: string;
  feedback?: MessageFeedback;
  showRegenerate?: boolean;
  onRegenerate: () => void;
  onFeedback: (kind: MessageFeedback) => void;
  disableRegenerate?: boolean;
  /** 版本总数（>1 时显示 ‹n/N› 翻页器） */
  versionCount?: number;
  /** 当前版本索引（0 起） */
  activeVersion?: number;
  /** 切换到指定版本 */
  onSwitchVersion?: (index: number) => void;
}

export function MessageActions({
  content,
  feedback,
  showRegenerate,
  onRegenerate,
  onFeedback,
  disableRegenerate,
  versionCount,
  activeVersion,
  onSwitchVersion,
}: MessageActionsProps) {
  const { toast } = useToast();
  const { t } = useTranslation('playground');
  // 复制成功后短暂把图标切成对勾，给出即时反馈
  const [copied, setCopied] = useState(false);
  // 定时器 ref：组件卸载（切换会话等）时清理，避免卸载后 setState
  const copiedTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copiedTimerRef.current), []);

  async function handleCopy() {
    const ok = await copyText(content);
    if (ok) {
      setCopied(true);
      window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } else {
      toast({ title: t('copyFailed'), variant: 'error' });
    }
  }

  const showVersions = Boolean(
    versionCount && versionCount > 1 && onSwitchVersion && activeVersion !== undefined,
  );

  // 无「重新生成」、无正文、无多版本则整栏不渲染
  if (!showRegenerate && !content && !showVersions) return null;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-0.5">
        {/* 版本翻页器：仅多版本回答显示 ‹ n/N › */}
        {showVersions && (
          <VersionSwitcher
            count={versionCount!}
            active={activeVersion!}
            onSwitch={onSwitchVersion!}
          />
        )}

        {showRegenerate && (
          <ActionButton
            label={t('regenerateAnswer')}
            onClick={onRegenerate}
            disabled={disableRegenerate}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
          </ActionButton>
        )}

        {/* 复制/点赞/点踩仅在有正文时有意义；失败消息(无正文)只保留「重新生成」。 */}
        {content && (
          <>
            <ActionButton label={copied ? t('copied') : t('copy')} onClick={handleCopy}>
              {copied ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
            </ActionButton>

            <ActionButton
              label={t('thumbsUp')}
              active={feedback === 'up'}
              onClick={() => onFeedback('up')}
            >
              <ThumbsUp
                className="size-3.5"
                fill={feedback === 'up' ? 'currentColor' : 'none'}
                aria-hidden="true"
              />
            </ActionButton>

            <ActionButton
              label={t('thumbsDown')}
              active={feedback === 'down'}
              onClick={() => onFeedback('down')}
            >
              <ThumbsDown
                className="size-3.5"
                fill={feedback === 'down' ? 'currentColor' : 'none'}
                aria-hidden="true"
              />
            </ActionButton>
          </>
        )}
      </div>
    </div>
  );
}

/** 版本翻页器：‹ 2/3 ›，左右箭头切换回答版本；到头/到尾时对应箭头禁用 */
function VersionSwitcher({
  count,
  active,
  onSwitch,
}: {
  count: number;
  active: number;
  onSwitch: (index: number) => void;
}) {
  const { t } = useTranslation('playground');
  return (
    <div className="mr-1 flex items-center gap-0.5 text-xs text-muted-foreground">
      <button
        type="button"
        aria-label={t('previousVersion')}
        disabled={active <= 0}
        onClick={() => onSwitch(active - 1)}
        className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronLeft className="size-3.5" aria-hidden="true" />
      </button>
      <span className="min-w-[2.5rem] text-center tabular-nums">
        {active + 1}/{count}
      </span>
      <button
        type="button"
        aria-label={t('nextVersion')}
        disabled={active >= count - 1}
        onClick={() => onSwitch(active + 1)}
        className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronRight className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** 单个图标按钮：带 Tooltip、hover 高亮、激活态（点赞/点踩选中）配色 */
function ActionButton({
  label,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            active
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          }`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
