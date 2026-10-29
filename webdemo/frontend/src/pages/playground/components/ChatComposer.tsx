/**
 * Chat input (bottom tool row + send/stop button).
 *
 * Purpose: a large rounded input in the Volcano Ark style. Enter sends, Shift+Enter inserts a newline; while streaming, the send key becomes a stop key. The textarea grows with content (capped).
 */

import { useEffect, useRef, useState } from 'react';
import { Textarea, useToast } from '@map/ui';
import { useTranslation } from 'react-i18next';
import type { Attachment, ThinkingDepth } from '../types';
import { ComposerToolbar } from './ComposerToolbar';
import { ImageLightbox } from './ImageLightbox';
import { AttachmentPreview } from './AttachmentPreview';
import { MAX_ATTACHMENTS, readFileAsAttachment } from '../utils/attachments';
import { linkPlaygroundFile } from '@/api/map/fileUploads';
import {
  attachmentAcceptForCapabilities,
  supportedAttachmentKinds,
  validateAttachmentCapability,
} from '../utils/attachmentCapabilities';

interface ChatComposerProps {
  thinkingDepth: ThinkingDepth;
  onThinkingDepthChange: (depth: ThinkingDepth) => void;
  /** Whether the current model may show reasoning (when false, hide the reasoning switch) */
  showReasoning: boolean;
  /** Whether the current model may show the web-search entry */
  webSearchAvailable: boolean;
  /** Input modalities the current model allows, from model capabilities.input_* */
  attachmentCapabilities?: Record<string, boolean>;
  /** Web-search switch */
  webSearch: boolean;
  onWebSearchChange: (webSearch: boolean) => void;
  /** Whether generation is currently streaming */
  loading: boolean;
  /** Whether sending is disabled (for example, no model or no secret) */
  disabled?: boolean;
  /** User-readable reason when sending is disabled */
  disabledReason?: string;
  /** Send (with optional multimodal attachments) */
  onSend: (text: string, attachments?: Attachment[]) => void;
  /** Stop generation */
  onStop: () => void;
  /** Controlled input value (filled by task cards) */
  value: string;
  onValueChange: (v: string) => void;
}

const MAX_TEXTAREA_HEIGHT = 200;

/**
 * Input component.
 */
export function ChatComposer({
  thinkingDepth,
  onThinkingDepthChange,
  showReasoning,
  webSearchAvailable,
  attachmentCapabilities,
  webSearch,
  onWebSearchChange,
  loading,
  disabled,
  disabledReason,
  onSend,
  onStop,
  value,
  onValueChange,
}: ChatComposerProps) {
  const { t } = useTranslation('playground');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  // Pending attachments (base64 data URL), held only in session memory and cleared after send
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const reservedRef = useRef(0);
  // Drag-hover highlight
  const [dragging, setDragging] = useState(false);
  // Image opened in the enlarge preview
  const [preview, setPreview] = useState<string | null>(null);
  const attachmentAccept = attachmentAcceptForCapabilities(attachmentCapabilities);
  const attachmentKinds = supportedAttachmentKinds(attachmentCapabilities);
  const canAttach = attachmentKinds.length > 0;

  useEffect(() => {
    // Switching model capabilities must also clear selected attachments, so an unsupported input is not carried into the next request.
    // This is controlled state normalization, not an async data fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAttachments((current) => {
      const compatible = current.filter(
        (attachment) => !validateAttachmentCapability(attachmentCapabilities, attachment.mime),
      );
      if (compatible.length !== current.length) {
        toast({ title: t('unsupportedAttachmentsRemoved'), variant: 'error' });
      }
      return compatible;
    });
  }, [attachmentCapabilities, t, toast]);

  // Auto height: on content change, adjust by scrollHeight (once capped, switch to internal scrolling)
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [value]);

  // After outside copy is filled into the input (for example, clicking a "try these tasks" card), focus is not in the input, so Enter-to-send fails.
  // If there is already content but focus is not in the input, focus it and move the caret to the end, so "fill in and press Enter to send" works.
  // During normal typing focus is already in the input, so the activeElement check skips and does not steal focus again.
  useEffect(() => {
    const el = taRef.current;
    if (!el || !value || document.activeElement === el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [value]);

  // Read and append attachments: truncate past the total cap, validate one by one, and toast the failures
  async function addFiles(files: File[]) {
    if (files.length === 0 || !canAttach) {
      if (files.length > 0) toast({ title: t('modelDoesNotSupportAttachments'), variant: 'error' });
      return;
    }
    const supportedFiles: File[] = [];
    for (const file of files) {
      const error = validateAttachmentCapability(attachmentCapabilities, file.type);
      if (error) {
        toast({ title: error, variant: 'error' });
      } else {
        supportedFiles.push(file);
      }
    }
    if (supportedFiles.length === 0) return;
    const room = MAX_ATTACHMENTS - attachments.length - reservedRef.current;
    if (room <= 0) {
      toast({ title: t('tooManyAttachments', { count: MAX_ATTACHMENTS }), variant: 'error' });
      return;
    }
    const picked = supportedFiles.slice(0, room);
    reservedRef.current += picked.length;
    setUploadingCount((count) => count + 1);
    let results;
    try {
      results = await Promise.all(picked.map((file) => readFileAsAttachment(file)));
    } finally {
      reservedRef.current -= picked.length;
      setUploadingCount((count) => count - 1);
    }
    const ok: Attachment[] = [];
    for (const r of results) {
      if (r.ok && r.attachment) ok.push(r.attachment);
      else if (r.error) toast({ title: r.error, variant: 'error' });
    }
    if (ok.length) setAttachments((prev) => [...prev, ...ok]);
  }

  function handlePickFiles(files: FileList | null) {
    if (files) void addFiles(Array.from(files));
    if (fileRef.current) fileRef.current.value = ''; // Allow selecting the same file again
  }

  // When a paste contains files (screenshot / copied file), add them automatically and do not paste the file name as text
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;
    e.preventDefault();
    if (!canAttach) {
      toast({ title: t('modelDoesNotSupportAttachments'), variant: 'error' });
      return;
    }
    void addFiles(files);
  }

  // Drag-and-drop upload: highlight and accept only when there are real files, so dragging text does not trigger it
  function handleDragOver(e: React.DragEvent) {
    if (!canAttach || !Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setDragging(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    // Cancel the highlight only when leaving the whole container, not when moving between child elements
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragging(false);
  }
  function handleDrop(e: React.DragEvent) {
    if (!canAttach || !Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setDragging(false);
    void addFiles(Array.from(e.dataTransfer.files));
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  async function submit() {
    const text = value.trim();
    if (
      (!text && attachments.length === 0) ||
      loading ||
      uploadingCount > 0 ||
      submittingRef.current
    )
      return;
    if (disabled) {
      toast({ title: disabledReason || t('unavailableToSend'), variant: 'error' });
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const ready = await Promise.all(
        attachments.map(async (attachment) => {
          if (!attachment.fileId) return attachment;
          const publicUrl = await linkPlaygroundFile(attachment.fileId);
          return { ...attachment, publicUrl };
        }),
      );
      onSend(text, ready);
      onValueChange('');
      setAttachments([]);
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : '文件读取链接签发失败',
        variant: 'error',
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  const canSubmit =
    (Boolean(value.trim()) || attachments.length > 0) &&
    !loading &&
    !submitting &&
    uploadingCount === 0;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative rounded-2xl bg-card p-2.5 shadow-[0_2px_16px_rgba(0,0,0,0.08)] ring-1 transition-shadow focus-within:ring-primary/30 ${
        dragging ? 'ring-2 ring-primary/60' : 'ring-border/60'
      }`}
    >
      {/* Drag-hover hint */}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-primary/5 text-sm font-medium text-primary">
          {t('releaseToUpload')}
        </div>
      )}
      {uploadingCount > 0 && (
        <p role="status" aria-live="polite" className="px-2 py-1 text-sm text-muted-foreground">
          {t('attachmentUploading')}
        </p>
      )}

      {/* Pending-attachment preview */}
      {attachments.length > 0 && (
        <div className="mb-1.5 px-1">
          <AttachmentPreview
            attachments={attachments}
            onRemove={removeAttachment}
            onImageClick={setPreview}
          />
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={attachmentAccept}
        multiple
        className="hidden"
        onChange={(e) => handlePickFiles(e.target.files)}
      />
      <Textarea
        ref={taRef}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        rows={1}
        placeholder={webSearch ? t('webSearchPlaceholder') : t('messagePlaceholder')}
        className="min-h-[44px] resize-none border-0 bg-transparent px-2 py-1.5 text-[15px] shadow-none focus-visible:ring-0"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <ComposerToolbar
          thinkingDepth={thinkingDepth}
          onThinkingDepthChange={onThinkingDepthChange}
          showReasoning={showReasoning}
          webSearchAvailable={webSearchAvailable}
          webSearch={webSearch}
          onWebSearchChange={onWebSearchChange}
          canAttach={canAttach}
          attachmentKinds={attachmentKinds}
          onAttach={() => fileRef.current?.click()}
        />
        <SendButton
          loading={loading}
          disabled={!canSubmit}
          blocked={disabled}
          onSend={() => {
            void submit();
          }}
          onStop={onStop}
        />
      </div>
      <ImageLightbox src={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

/** Send/stop button: a stop square while streaming, otherwise an up arrow */
function SendButton({
  loading,
  disabled,
  blocked,
  onSend,
  onStop,
}: {
  loading: boolean;
  disabled?: boolean;
  blocked?: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  const { t } = useTranslation('playground');
  if (loading) {
    return (
      <button
        type="button"
        onClick={onStop}
        aria-label={t('stop')}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <span className="h-3 w-3 rounded-[3px] bg-current" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onSend}
      disabled={disabled}
      aria-disabled={blocked || disabled ? true : undefined}
      aria-label={t('send')}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors disabled:bg-muted disabled:text-muted-foreground ${
        blocked
          ? 'bg-muted text-muted-foreground'
          : 'bg-primary text-primary-foreground hover:bg-primary/90'
      }`}
      data-blocked={blocked ? 'true' : undefined}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="12" y1="19" x2="12" y2="5" />
        <polyline points="5 12 12 5 19 12" />
      </svg>
    </button>
  );
}
