/**
 * 对话输入框（含底部工具行 + 发送/停止按钮）。
 *
 * 用途：火山方舟风格的大圆角输入框。Enter 发送、Shift+Enter 换行；流式生成时发送键变停止键。
 * 文本域随内容自适应高度（上限受控）。
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
  /** 当前模型是否允许展示思考（false 时隐藏思考开关） */
  showReasoning: boolean;
  /** 当前模型是否允许展示联网搜索入口 */
  webSearchAvailable: boolean;
  /** 当前模型允许的输入模态，来自模型 capabilities.input_* */
  attachmentCapabilities?: Record<string, boolean>;
  /** 联网搜索开关 */
  webSearch: boolean;
  onWebSearchChange: (webSearch: boolean) => void;
  /** 是否正在流式生成 */
  loading: boolean;
  /** 是否禁用发送（如无模型/无密钥） */
  disabled?: boolean;
  /** 禁用发送时的用户可读原因 */
  disabledReason?: string;
  /** 发送（带可选多模态附件） */
  onSend: (text: string, attachments?: Attachment[]) => void;
  /** 停止生成 */
  onStop: () => void;
  /** 受控输入值（供任务卡片填充） */
  value: string;
  onValueChange: (v: string) => void;
}

const MAX_TEXTAREA_HEIGHT = 200;

/**
 * 输入框组件。
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
  // 待发送附件（base64 data URL），仅会话内存，发送后清空
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const reservedRef = useRef(0);
  // 拖拽悬停高亮
  const [dragging, setDragging] = useState(false);
  // 点击放大预览的图片
  const [preview, setPreview] = useState<string | null>(null);
  const attachmentAccept = attachmentAcceptForCapabilities(attachmentCapabilities);
  const attachmentKinds = supportedAttachmentKinds(attachmentCapabilities);
  const canAttach = attachmentKinds.length > 0;

  useEffect(() => {
    // 模型能力切换需要同步清理已选附件，避免把不支持的输入带进下一次请求。
    // 这里是受控的状态归一化，不是异步数据获取。
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

  // 自适应高度：内容变化时按 scrollHeight 调整（上限封顶后转内部滚动）
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [value]);

  // 外部把文案填入输入框（如点击「试试以下任务」卡片）后，焦点并不在输入框，导致回车发送失效。
  // 若已有内容但焦点不在输入框，则自动聚焦并把光标移到末尾，保证「填入即可回车发送」。
  // 正常打字时焦点已在输入框，activeElement 判断会跳过，不会重复抢焦。
  useEffect(() => {
    const el = taRef.current;
    if (!el || !value || document.activeElement === el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [value]);

  // 读取并追加附件：超出总数上限截断，逐个校验，失败项弹 toast
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
    if (fileRef.current) fileRef.current.value = ''; // 允许重复选同一文件
  }

  // 粘贴含文件时（截图/复制文件）自动加入，并阻止把文件名当文本贴入
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

  // 拖拽上传：仅在真正含文件时高亮/接收，避免拖拽文本触发
  function handleDragOver(e: React.DragEvent) {
    if (!canAttach || !Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setDragging(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    // 仅当离开整个容器（而非子元素间移动）时取消高亮
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
      {/* 拖拽悬停提示 */}
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

      {/* 待发送附件预览 */}
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

/** 发送/停止按钮：流式时显示停止方块，否则显示上箭头 */
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
