import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Loader2, RefreshCw } from 'lucide-react';

import type { useImageParseRegeneration } from '../../hooks/useImageParseRegeneration';
import { useImageParsePreviewAction } from '../../hooks/useImageParsePreviewAction';
import { imageParseBlockId } from '../../utils/imageParseBlocks';
import type { ImageParseTextRange } from '../../utils/imageParseBlocks';
import { imageParseBlockCanRegenerate } from '../../utils/imageParseQuality';
import type { ImageParseBlockKind } from '../../utils/imageParseSample';
import { ImageParseToolButton } from './ImageParseToolButton';

interface ImageParsePreviewReviewProps {
  root: RefObject<HTMLElement | null>;
  selectedId?: string;
  blockKind?: ImageParseBlockKind;
  content: string;
  visible: boolean;
  ranges?: ReadonlyMap<string, ImageParseTextRange>;
  regeneration?: ReturnType<typeof useImageParseRegeneration>;
  onCopyRegion?: (id: string) => void;
}

/** Gap between the action bar and the bottom edge of the selected block, so it floats outside the block. */
const PREVIEW_ACTION_GAP = 6;

/** Action-bar buttons reuse the workspace control size: compact on desktop, and a click target kept on coarse-pointer devices. */
const PREVIEW_ACTION_BUTTON_CLASS =
  'h-7 min-h-7 gap-1.5 rounded-full px-2.5 text-xs [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:min-h-9';

/** Type badge at the top left of the selected block, positioned along the block bounds. */
const PREVIEW_ACTION_LABEL_CLASS =
  'pointer-events-none absolute z-20 -translate-y-full rounded-t-sm bg-ocr-link px-1.5 py-0 text-[10px] font-medium leading-4 text-primary-foreground';

/** Show the action bar at the bottom right of the selected block; do not show it on hover. When review is hidden, keep only region copy. */
export function ImageParsePreviewReview({
  root,
  selectedId,
  blockKind,
  content,
  visible,
  ranges,
  regeneration,
  onCopyRegion,
}: ImageParsePreviewReviewProps) {
  const { t } = useTranslation('playground');
  const position = useImageParsePreviewAction(root, selectedId, content, visible);
  if (!position) return null;
  const actionId = position.id;
  const mapped = Boolean(ranges?.has(actionId));
  const pending = regeneration?.pending.has(actionId) ?? false;
  const result = regeneration?.results[actionId];
  const block = regeneration?.layout.find(
    (item, index) => imageParseBlockId(item, index) === actionId,
  );
  const supported = !block || imageParseBlockCanRegenerate(block);
  let hint = 'imageParseRegenerateBlock';
  if (!regeneration) hint = 'imageParseRegenerateUnavailable';
  else if (!regeneration.available)
    hint = regeneration.unavailableReason ?? 'imageParseRegenerateUnavailable';
  else if (!supported) hint = 'imageParseRegenerateUnsupported';
  else if (!mapped) hint = 'imageParseRegenerateUnmapped';
  else if (pending) hint = 'imageParseReviewRunning';
  else if (result?.error) hint = result.error;
  else if (result?.improved) hint = 'imageParseRegenerateImproved';
  return (
    <>
      {blockKind ? (
        <span
          data-preview-label={actionId}
          className={PREVIEW_ACTION_LABEL_CLASS}
          style={{ left: position.left, top: position.top }}
        >
          {t(`imageParseBlock_${blockKind}`)}
        </span>
      ) : null}
      <div
        data-preview-review={actionId}
        className="absolute z-20 max-w-[min(100%,28rem)]"
        style={{
          top: position.top + position.height + PREVIEW_ACTION_GAP,
          right: position.right,
        }}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div
          data-preview-review-toolbar=""
          className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-border/60 bg-card p-0.5 shadow-card"
        >
          {onCopyRegion ? (
            <ImageParseToolButton
              label={t('imageParseCopyRegion')}
              showLabel
              disabled={!mapped}
              className={PREVIEW_ACTION_BUTTON_CLASS}
              onClick={() => onCopyRegion(actionId)}
            >
              <Copy className="size-3.5" aria-hidden="true" />
            </ImageParseToolButton>
          ) : null}
          {regeneration ? (
            <ImageParseToolButton
              label={t(pending ? 'imageParseReviewRunning' : 'imageParseRegenerateBlock')}
              hint={t(hint)}
              showLabel
              className={PREVIEW_ACTION_BUTTON_CLASS}
              disabled={
                regeneration.busy ||
                !regeneration.available ||
                !mapped ||
                !supported ||
                Boolean(result)
              }
              onClick={() => void regeneration.regenerateBlock(actionId)}
            >
              {pending ? (
                <Loader2
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden="true" />
              )}
            </ImageParseToolButton>
          ) : null}
        </div>
      </div>
    </>
  );
}
