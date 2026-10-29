import { useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SlideCaptchaChallenge } from '@map/ui';
import { useTranslation } from 'react-i18next';
import { mapAuthApi } from '@/api/map';

/** 等待人机验证结果的 resolver */
interface Resolver {
  resolve: (captchaId: string) => void;
  reject: (err: unknown) => void;
}

/** useCaptchaGate 返回值 */
export interface CaptchaGate {
  /** 是否启用人机验证（后端配置探测） */
  enabled: boolean;
  /** 传给 CaptchaDialog 的受控属性 */
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
   * 用人机验证「门」包裹一个动作：未启用时直接执行（captchaId=''）；
   * 启用时弹出滑块，验证通过后用拿到的一次性凭证执行 action；用户取消则 reject。
   */
  runWithCaptcha: <T>(action: (captchaId: string) => Promise<T>) => Promise<T>;
}

/**
 * 人机验证编排 hook（发码/登录前置）。
 *
 * 用途：把「取题 → 弹窗滑块 → 校验落点 → 拿一次性凭证 → 执行受保护动作」的流程收敛到一处，
 * 供登录、找回密码、绑定邮箱等发码/登录调用点复用。仅编排逻辑，不渲染 UI（视图见 CaptchaDialog）。
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

  /** 取一道新题并填充到弹窗 */
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
        // 已有验证流程进行中，避免重复弹窗
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

  /** 用户拖动释放：校验落点。通过则保持滑块停留并短暂展示成功态后再关闭放行；失败则换一题重试。 */
  const onConfirm = useCallback(
    async (point: { x: number; y: number }, reset: () => void) => {
      if (verifyingRef.current || completingRef.current) return;
      verifyingRef.current = true;
      const session = sessionRef.current;
      try {
        const res = await mapAuthApi.verifyCaptcha({ id: idRef.current, x: point.x, y: point.y });
        if (session !== sessionRef.current || !resolverRef.current) return;
        // 成功：标记成功态，滑块停在缺口处不复位，停留约 0.6s 让用户看到反馈后再关闭放行。
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
        // 校验失败（落点不对/题目过期）：先闪红，短暂停留后复位并换一道新题。
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

  /** 关闭弹窗视为取消，reject 等待中的动作 */
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
