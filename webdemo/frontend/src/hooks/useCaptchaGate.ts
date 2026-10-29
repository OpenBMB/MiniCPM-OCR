import { useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SlideCaptchaChallenge } from '@map/ui';
import { useTranslation } from 'react-i18next';
import { mapAuthApi } from '@/api/map';

/** Resolver waiting for the captcha result. */
interface Resolver {
  resolve: (captchaId: string) => void;
  reject: (err: unknown) => void;
}

/** Return value of useCaptchaGate. */
export interface CaptchaGate {
  /** Whether captcha is enabled (probed from backend config). */
  enabled: boolean;
  /** Controlled props passed to CaptchaDialog. */
  dialogProps: {
    open: boolean;
    challenge: SlideCaptchaChallenge | null;
    loading: boolean;
    error: string | null;
    status: 'default' | 'success' | 'error';
    onConfirm: (point: { x: number; y: number }, reset: () => void) => void;
    onRefresh: () => void;
    onOpenChange: (open: boolean) => void;
  };
  /**
   * Wrap an action in a captcha gate: when captcha is off, run it directly (captchaId='');
   * when it is on, open the slider, and after verification run the action with the one-time token; if the user cancels, reject.
   */
  runWithCaptcha: <T>(action: (captchaId: string) => Promise<T>) => Promise<T>;
}

/**
 * Captcha orchestration hook (before sending a code or logging in).
 *
 * Purpose: gather "fetch a challenge → show the slider → check the drop point → take a one-time token → run the protected action" in one place,
 * for login, password recovery, email binding, and other code or login call sites. Logic only; it does not render UI (see CaptchaDialog).
 */
export function useCaptchaGate(): CaptchaGate {
  const { t } = useTranslation('status');
  const { data: config } = useQuery({
    queryKey: ['auth', 'public-config'],
    queryFn: mapAuthApi.publicConfig,
    staleTime: Infinity,
  });
  const enabled = !!config?.captcha_enabled;

  const [open, setOpen] = useState(false);
  const [challenge, setChallenge] = useState<SlideCaptchaChallenge | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'default' | 'success' | 'error'>('default');
  const resolverRef = useRef<Resolver | null>(null);
  const idRef = useRef('');
  const verifyingRef = useRef(false);
  const completingRef = useRef(false);
  const sessionRef = useRef(0);
  const challengeRequestRef = useRef(0);
  const completionTimerRef = useRef<number | null>(null);

  /** Fetch a new challenge and fill it into the dialog. */
  const loadChallenge = useCallback(async (session: number) => {
    const request = ++challengeRequestRef.current;
    setStatus('default');
    setChallenge(null);
    setLoading(true);
    setError(null);
    try {
      const dto = await mapAuthApi.getCaptcha();
      if (
        session !== sessionRef.current ||
        request !== challengeRequestRef.current ||
        !resolverRef.current
      ) {
        return;
      }
      idRef.current = dto.id;
      setChallenge({
        masterB64: dto.master_b64,
        tileB64: dto.tile_b64,
        tileX: dto.tile_x,
        tileY: dto.tile_y,
        tileWidth: dto.tile_width,
        tileHeight: dto.tile_height,
      });
    } catch {
      if (
        session !== sessionRef.current ||
        request !== challengeRequestRef.current ||
        !resolverRef.current
      ) {
        return;
      }
      idRef.current = '';
      setError(t('captcha.loadFailed'));
    } finally {
      if (
        session === sessionRef.current &&
        request === challengeRequestRef.current &&
        resolverRef.current
      ) {
        setLoading(false);
      }
    }
  }, [t]);

  const runWithCaptcha = useCallback(
    async <T,>(action: (captchaId: string) => Promise<T>): Promise<T> => {
      if (!enabled) return action('');
      if (resolverRef.current) {
        // A verification flow is already in progress; do not open another dialog.
        return Promise.reject(new Error('captcha in progress'));
      }
      const captchaId = await new Promise<string>((resolve, reject) => {
        resolverRef.current = { resolve, reject };
        const session = ++sessionRef.current;
        setOpen(true);
        void loadChallenge(session);
      });
      return action(captchaId);
    },
    [enabled, loadChallenge],
  );

  /** User releases the drag: check the drop point. On success, leave the slider in place, show the success state briefly, then close and continue; on failure, load a new challenge and retry. */
  const onConfirm = useCallback(
    async (point: { x: number; y: number }, reset: () => void) => {
      if (verifyingRef.current || completingRef.current) return;
      verifyingRef.current = true;
      const session = sessionRef.current;
      try {
        const res = await mapAuthApi.verifyCaptcha({ id: idRef.current, x: point.x, y: point.y });
        if (session !== sessionRef.current || !resolverRef.current) return;
        // Success: mark the success state, leave the slider in the gap without resetting, wait about 0.6s so the user sees the feedback, then close and continue.
        completingRef.current = true;
        setStatus('success');
        completionTimerRef.current = window.setTimeout(() => {
          if (session !== sessionRef.current) return;
          const resolver = resolverRef.current;
          resolverRef.current = null;
          completingRef.current = false;
          setOpen(false);
          setStatus('default');
          resolver?.resolve(res.id);
        }, 600);
      } catch {
        if (session !== sessionRef.current || !resolverRef.current) return;
        // Check failed (wrong drop point or expired challenge): flash red, pause briefly, then reset and load a new challenge.
        setStatus('error');
        window.setTimeout(() => {
          if (session !== sessionRef.current || !resolverRef.current) return;
          reset();
          void loadChallenge(session);
        }, 500);
      } finally {
        verifyingRef.current = false;
      }
    },
    [loadChallenge],
  );

  const onRefresh = useCallback(() => {
    if (!resolverRef.current || verifyingRef.current || completingRef.current) return;
    void loadChallenge(sessionRef.current);
  }, [loadChallenge]);

  /** Closing the dialog counts as cancel and rejects the waiting action. */
  const onOpenChange = useCallback((next: boolean) => {
    if (next) return;
    sessionRef.current += 1;
    challengeRequestRef.current += 1;
    completingRef.current = false;
    if (completionTimerRef.current !== null) {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    setChallenge(null);
    setLoading(false);
    setError(null);
    setStatus('default');
    resolver?.reject(new Error('captcha_cancelled'));
  }, []);

  return {
    enabled,
    dialogProps: { open, challenge, loading, error, status, onConfirm, onRefresh, onOpenChange },
    runWithCaptcha,
  };
}
