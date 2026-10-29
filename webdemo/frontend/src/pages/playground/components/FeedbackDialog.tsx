/**
 * 点踩反馈弹窗。
 *
 * 用途：用户点踩助手回答后弹出，可多选原因标签 + 填写可选正文，提交上报后端。
 * 点赞不弹此框（直接静默上报），故本组件仅服务点踩场景。
 *
 * @param open 是否打开
 * @param onOpenChange 开合回调
 * @param submitting 提交中（禁用提交按钮）
 * @param onSubmit 提交回调，回传选中原因与正文
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ChipMultiSelect,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from '@map/ui';

const MAX_COMMENT = 500;

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  onSubmit: (payload: { reasons: string[]; comment: string }) => void;
}

export function FeedbackDialog({ open, onOpenChange, submitting, onSubmit }: FeedbackDialogProps) {
  const { t } = useTranslation('playground');
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState('');

  // 每次打开重置，避免上次选择残留
  useEffect(() => {
    if (open) {
      setReasons([]);
      setComment('');
    }
  }, [open]);

  function handleSubmit() {
    onSubmit({ reasons, comment: comment.trim() });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{t('feedbackTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">{t('feedbackQuestion')}</p>
            <ChipMultiSelect
              options={[
                { value: '响应速度慢', label: t('feedbackSlow') },
                { value: '格式错乱', label: t('feedbackFormatting') },
                { value: '逻辑混乱', label: t('feedbackLogic') },
                { value: '内容重复', label: t('feedbackRepeated') },
                { value: '未遵守指令', label: t('feedbackInstruction') },
                { value: '其他', label: t('feedbackOther') },
              ]}
              value={reasons}
              onChange={setReasons}
              ariaLabel={t('feedbackReasons')}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">{t('feedbackComment')}</p>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
              placeholder={t('feedbackPlaceholder')}
              rows={4}
            />
            <p className="text-right text-xs text-muted-foreground">
              {comment.length}/{MAX_COMMENT}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting ? t('submitting') : t('submitFeedback')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
