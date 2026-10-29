/**
 * Assistant message action bar (copy / regenerate / thumbs-up / thumbs-down).
 *
 * Purpose: hangs under every completed assistant message. Copy the body to the clipboard; regenerate truncates and resends; thumbs-up/thumbs-down toggle the local highlight and report to /feedback (the two are mutually exclusive, and clicking again cancels). Web sources are not here: the SourcesChip under the answer body is the path to the source drawer.
 *
 * @param content     Assistant body to copy
 * @param feedback    Current feedback state ('up' | 'down' | undefined)
 * @param showRegenerate Whether to show "regenerate" (true only for the last assistant message, so resending a middle turn does not delete the conversation after it)
 * @param onRegenerate Regenerate callback
 * @param onFeedback  Toggle-feedback callback (the clicked type is passed in; the parent does mutual exclusion / cancel)
 * @param disableRegenerate Disable regenerate while generating
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
  /** Version count (show the ‹n/N› pager when >1) */
  versionCount?: number;
  /** Current version index (starting at 0) */
  activeVersion?: number;
  /** Switch to the given version */
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
  // After a successful copy, briefly switch the icon to a check for immediate feedback
  const [copied, setCopied] = useState(false);
  // Timer ref: clear it when the component unmounts (switching sessions and the like) so setState does not run after unmount
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

  // Render nothing for the whole bar when there is no "regenerate," no body, and no multiple versions
  if (!showRegenerate && !content && !showVersions) return null;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-0.5">
        {/* Version pager: show ‹ n/N › only for multi-version answers */}
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

        {/* Copy / thumbs-up / thumbs-down are meaningful only when there is a body; a failed message (no body) keeps only "regenerate." */}
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

/** Version pager: ‹ 2/3 ›. Left and right arrows switch the answer version; the matching arrow is disabled at the start or the end */
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

/** A single icon button: Tooltip, hover highlight, and active-state color (thumbs-up / thumbs-down selected) */
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
