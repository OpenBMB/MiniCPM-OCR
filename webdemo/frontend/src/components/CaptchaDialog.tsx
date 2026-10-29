import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Button,
  SlideCaptcha,
  type SlideCaptchaChallenge,
} from '@map/ui';
import { useTranslation } from 'react-i18next';

/** CaptchaDialog 入参（由 useCaptchaGate 的 dialogProps 提供） */
export interface CaptchaDialogProps {
  open: boolean;
  challenge: SlideCaptchaChallenge | null;
  loading: boolean;
  error: string | null;
  status: 'default' | 'success' | 'error';
  onConfirm: (point: { x: number; y: number }, reset: () => void) => void;
  onRefresh: () => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * 人机验证弹窗（拼图滑块）。纯展示：渲染标题 + SlideCaptcha，事件透传给 useCaptchaGate。
 * 用途：登录/发码前置的安全验证弹层，与 useCaptchaGate 配套使用。
 */
export function CaptchaDialog({
  open,
  challenge,
  loading,
  error,
  status,
  onConfirm,
  onRefresh,
  onOpenChange,
}: CaptchaDialogProps) {
  const { t } = useTranslation('status');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[360px]" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{t('captcha.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-[236px] items-center justify-center py-2">
          {error ? (
            <div className="flex w-[300px] flex-col items-center gap-3 rounded-md border border-destructive/20 bg-destructive/5 px-5 py-7 text-center">
              <p className="text-sm text-foreground">{error}</p>
              <p className="text-xs text-muted-foreground">{t('captcha.reloadDescription')}</p>
              <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
                {t('captcha.reload')}
              </Button>
            </div>
          ) : loading || !challenge ? (
            <div className="flex h-[220px] w-[300px] items-center justify-center rounded-md bg-muted/50">
              <span className="text-sm text-muted-foreground">{t('captcha.loading')}</span>
            </div>
          ) : (
            <SlideCaptcha
              challenge={challenge}
              status={status}
              title={t('captcha.dragPrompt')}
              onConfirm={onConfirm}
              onRefresh={onRefresh}
              onClose={() => onOpenChange(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
