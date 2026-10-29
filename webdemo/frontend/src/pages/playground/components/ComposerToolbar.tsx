/**
 * 输入框底部工具行。
 *
 * 用途：呈现输入框底部的工具按钮组。附件上传（图像/视频/音频/文件）、联网搜索与思考深度均为真功能，
 * 点击切换开/关（联网 → L3 Playground BFF，思考 → reasoning_effort/enable_thinking）。
 */

import { useTranslation } from 'react-i18next';

import { useAppStore } from '@map/store';
import { cn, Tooltip, TooltipContent, TooltipTrigger } from '@map/ui';

import type { AttachmentKind, ThinkingDepth } from '../types';

interface ComposerToolbarProps {
  thinkingDepth: ThinkingDepth;
  onThinkingDepthChange: (depth: ThinkingDepth) => void;
  /** 当前模型是否允许展示思考（false 时隐藏思考开关） */
  showReasoning: boolean;
  /** 当前模型是否允许展示联网搜索入口 */
  webSearchAvailable: boolean;
  /** 联网搜索开关 */
  webSearch: boolean;
  onWebSearchChange: (webSearch: boolean) => void;
  /** 点击附件按钮（上传图像/视频/音频/文件） */
  onAttach: () => void;
  /** 当前模型是否支持至少一种附件模态 */
  canAttach: boolean;
  /** 当前模型允许上传的附件模态 */
  attachmentKinds: AttachmentKind[];
}

/**
 * 工具行。
 * @param thinkingDepth 当前思考深度（off/on）
 * @param onThinkingDepthChange 思考深度变更回调
 * @param showReasoning 当前模型是否允许展示思考（false 时不渲染思考按钮）
 * @param webSearchAvailable 当前模型是否允许展示联网搜索入口
 * @param webSearch 是否开启联网搜索
 * @param onWebSearchChange 联网开关变更回调
 * @param onAttach 附件上传触发
 */
export function ComposerToolbar({
  thinkingDepth,
  onThinkingDepthChange,
  showReasoning,
  webSearchAvailable,
  webSearch,
  onWebSearchChange,
  onAttach,
  canAttach,
  attachmentKinds,
}: ComposerToolbarProps) {
  const { t } = useTranslation('playground');
  const locale = useAppStore((state) => state.locale);
  const attachmentSeparator = locale === 'zh-CN' ? '、' : ', ';
  const enabled = thinkingDepth !== 'off';
  return (
    <div className="flex items-center gap-1.5">
      {/* 附件 +：上传图像/视频/音频/文件 */}
      {canAttach && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onAttach}
              aria-label={t('uploadAttachment')}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
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
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {t('supportedUploads', {
              types: attachmentKinds
                .map((kind) => attachmentKindLabel(kind, t))
                .join(attachmentSeparator),
            })}
          </TooltipContent>
        </Tooltip>
      )}

      {/* 联网搜索：入口与后端部署开关保持一致。 */}
      {webSearchAvailable ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="switch"
              aria-checked={webSearch}
              aria-label={t('webSearch')}
              onClick={() => onWebSearchChange(!webSearch)}
              className={toolbarToggleClassName(webSearch)}
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
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20" />
              </svg>
              <span className="hidden sm:inline">{t('webSearch')}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{webSearch ? t('webSearchOn') : t('webSearchOff')}</TooltipContent>
        </Tooltip>
      ) : null}

      {/* 思考深度：仅支持深度思考的模型展示，默认关闭仍可手动开启。 */}
      {showReasoning && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={t('reasoningDepth')}
              onClick={() => onThinkingDepthChange(enabled ? 'off' : 'on')}
              className={toolbarToggleClassName(enabled)}
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
                <path d="M9.5 2A7.5 7.5 0 0 0 5 15.5V18a2 2 0 0 0 2 2h.5M14.5 2A7.5 7.5 0 0 1 19 15.5V18a2 2 0 0 1-2 2h-.5M9 22h6" />
              </svg>
              <span>
                {t('reasoningDepth')}: {t(`reasoningState.${thinkingDepth}`)}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{enabled ? t('reasoningOn') : t('reasoningOff')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * 工具行开关按钮的样式。
 *
 * 联网搜索与思考深度共用同一套视觉：两者都是「给本次回答附加一种能力」的同级开关，
 * 早先联网用实底、思考用弱底，并排时视觉权重打架。统一取思考深度的弱底方案
 * （实底在输入框里只留给发送按钮）。抽成一处也避免两个开关日后再次漂移。
 * @param active 开关是否处于开启态
 */
function toolbarToggleClassName(active: boolean): string {
  return cn(
    'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors',
    active
      ? 'bg-primary/10 text-primary hover:bg-primary/15'
      : 'text-muted-foreground/70 hover:bg-muted/40',
  );
}

function attachmentKindLabel(kind: AttachmentKind, t: (key: string) => string): string {
  return t(kind);
}
