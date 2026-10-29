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

/** CaptchaDialog props (supplied by dialogProps from useCaptchaGate). */
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
 * Captcha dialog (slide puzzle). Presentation only: renders the title and SlideCaptcha, and forwards events to useCaptchaGate.
 * Purpose: the security check shown before login or sending a code, used together with useCaptchaGate.
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
