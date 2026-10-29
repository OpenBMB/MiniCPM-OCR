/**
 * Attachment preview list (shared by the pending-send state and the read-only state in a message bubble).
 *
 * Purpose: render uploaded multimodal attachments by category as thumbnails, players, or file cards.
 * - Passing `onRemove` is the "pending-send" state: compact tiles + a remove button at the top right, no inline playback.
 * - Omitting `onRemove` is the "read-only" state: images can be clicked to enlarge, video/audio play inline, and files can be downloaded.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mapBlobUrl } from '@/api/map';
import type { Attachment } from '../types';
import { formatBytes } from '../utils/attachments';

interface AttachmentPreviewProps {
  attachments: Attachment[];
  /** When provided, enter the pending-send state and render the remove button */
  onRemove?: (id: string) => void;
  /** Click an image to enlarge it in the read-only state */
  onImageClick?: (src: string) => void;
  /** Align to the right (user-bubble case) */
  align?: 'start' | 'end';
}

/**
 * Renders the attachment list.
 * @param attachments Attachment array
 * @param onRemove Remove callback (present means the pending-send state)
 * @param onImageClick Image-enlarge callback (read-only state)
 * @param align Alignment direction
 */
export function AttachmentPreview({
  attachments,
  onRemove,
  onImageClick,
  align = 'start',
}: AttachmentPreviewProps) {
  const { t } = useTranslation('playground');
  if (attachments.length === 0) return null;
  const readOnly = !onRemove;
  return (
    <div className={`flex flex-wrap gap-2 ${align === 'end' ? 'justify-end' : ''}`}>
      {attachments.map((att) => (
        <div key={att.id} className="group/att relative">
          <AttachmentItem att={att} readOnly={readOnly} onImageClick={onImageClick} />
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(att.id)}
              aria-label={t('removeAttachment', { name: att.name })}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/80 text-background opacity-0 transition-opacity group-hover/att:opacity-100"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** A single attachment: render by kind */
function AttachmentItem({
  att,
  readOnly,
  onImageClick,
}: {
  att: Attachment;
  readOnly: boolean;
  onImageClick?: (src: string) => void;
}) {
  const src = useProtectedAssetSrc(att);
  if (att.kind === 'image') {
    return (
      <img
        src={src}
        alt={att.name}
        onClick={() => onImageClick?.(src)}
        className={
          readOnly
            ? 'max-h-44 cursor-zoom-in rounded-xl border border-border/60 object-cover'
            : 'h-16 w-16 cursor-zoom-in rounded-lg border border-border/60 object-cover'
        }
      />
    );
  }

  // Read-only state: play video/audio inline
  if (readOnly && att.kind === 'video') {
    return <video src={src} controls className="max-h-44 rounded-xl border border-border/60" />;
  }
  if (readOnly && att.kind === 'audio') {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 p-2">
        <span className="max-w-[220px] truncate text-xs text-foreground">{att.name}</span>
        <audio src={src} controls className="h-8" />
      </div>
    );
  }

  // Everything else (pending-send video/audio, and files in any state) uses a file card
  return <FileChip att={att} readOnly={readOnly} />;
}

function useProtectedAssetSrc(att: Attachment): string {
  const fallback = att.dataUrl || att.url || '';
  const protectedPath =
    att.proxyUrl && att.proxyUrl.startsWith('/api/') ? att.proxyUrl.slice('/api'.length) : '';
  const [src, setSrc] = useState<string>(protectedPath ? fallback : att.proxyUrl || fallback);

  useEffect(() => {
    if (!protectedPath) {
      setSrc(att.proxyUrl || fallback);
      return;
    }
    let revoked = false;
    let objectUrl = '';
    mapBlobUrl(protectedPath)
      .then((url) => {
        if (revoked) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setSrc(url);
      })
      .catch(() => {
        setSrc(fallback || att.url || att.proxyUrl || '');
      });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [protectedPath, att.proxyUrl, att.url, fallback]);

  return src;
}

/** Card display for a file or media item: icon + name + size; downloadable in the read-only state */
function FileChip({ att, readOnly }: { att: Attachment; readOnly: boolean }) {
  const { t } = useTranslation('playground');
  const inner = (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <KindIcon kind={att.kind} />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="max-w-[160px] truncate text-xs font-medium text-foreground">
          {att.name}
        </span>
        <span className="text-[11px] text-muted-foreground">{formatBytes(att.size)}</span>
      </div>
    </div>
  );
  if (readOnly) {
    return (
      <a
        href={att.proxyUrl || att.url || att.dataUrl}
        download={att.name}
        className="block transition-shadow hover:shadow-sm"
        title={t('downloadAttachment', { name: att.name })}
      >
        {inner}
      </a>
    );
  }
  return inner;
}

/** Icon by kind */
function KindIcon({ kind }: { kind: Attachment['kind'] }) {
  if (kind === 'video') {
    return (
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
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    );
  }
  if (kind === 'audio') {
    return (
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
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    );
  }
  return (
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
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

/** The X on the remove button */
function CloseIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
