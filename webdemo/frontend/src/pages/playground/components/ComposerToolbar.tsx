/**
 * Tool row at the bottom of the input.
 *
 * Purpose: present the tool button group under the input. Attachment upload (image/video/audio/file), web search, and reasoning depth are all real features. Click toggles them on/off (web search → L3 Playground BFF, reasoning → reasoning_effort/enable_thinking).
 */

import { useTranslation } from 'react-i18next';

import { useAppStore } from '@map/store';
import { cn, Tooltip, TooltipContent, TooltipTrigger } from '@map/ui';

import type { AttachmentKind, ThinkingDepth } from '../types';

interface ComposerToolbarProps {
  thinkingDepth: ThinkingDepth;
  onThinkingDepthChange: (depth: ThinkingDepth) => void;
  /** Whether the current model may show reasoning (when false, hide the reasoning switch) */
  showReasoning: boolean;
  /** Whether the current model may show the web-search entry */
  webSearchAvailable: boolean;
  /** Web-search switch */
  webSearch: boolean;
  onWebSearchChange: (webSearch: boolean) => void;
  /** Click the attachment button (upload image/video/audio/file) */
  onAttach: () => void;
  /** Whether the current model supports at least one attachment modality */
  canAttach: boolean;
  /** Attachment modalities the current model allows uploading */
  attachmentKinds: AttachmentKind[];
}

/**
 * Tool row.
 * @param thinkingDepth Current reasoning depth (off/on)
 * @param onThinkingDepthChange Reasoning-depth change callback
 * @param showReasoning Whether the current model may show reasoning (when false, do not render the reasoning button)
 * @param webSearchAvailable Whether the current model may show the web-search entry
 * @param webSearch Whether web search is on
 * @param onWebSearchChange Web-search switch change callback
 * @param onAttach Attachment-upload trigger
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
      {/* Attachment +: upload image/video/audio/file */}
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

      {/* Web search: the entry stays consistent with the backend deployment switch. */}
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

      {/* Reasoning depth: shown only for models that support deep reasoning; off by default and can still be turned on manually. */}
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
 * Styles for a tool-row toggle button.
 *
 * Web search and reasoning depth share one visual treatment: both are peer switches that "add a capability to this answer." Earlier, web search used a solid fill and reasoning a weak fill, and side by side their visual weights fought. Use the reasoning-depth weak fill for both (a solid fill inside the input is reserved for the send button). Pulling it into one place also keeps the two switches from drifting apart later.
 * @param active Whether the switch is on
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
