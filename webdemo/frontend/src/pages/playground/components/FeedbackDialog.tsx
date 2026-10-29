/**
 * Thumbs-down feedback dialog.
 *
 * Purpose: after the user thumbs-down an assistant answer, this opens so they can select several reason tags and optionally write a body, then submit it to the backend. A thumbs-up does not open this dialog (it is reported silently), so this component serves only the thumbs-down case.
 *
 * @param open Whether it is open
 * @param onOpenChange Open/close callback
 * @param submitting Submitting (disables the submit button)
 * @param onSubmit Submit callback; returns the selected reasons and body
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

  // Reset on every open so the previous selection does not linger
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
