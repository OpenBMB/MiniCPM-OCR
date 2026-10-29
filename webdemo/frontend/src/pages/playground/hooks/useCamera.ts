/**
 * 摄像头预览 Hook。
 *
 * 用途：为「实时语音」的全双工通话提供真实的摄像头预览——请求 getUserMedia 视频流并以
 * state 暴露，由组件用 useEffect 挂到自己的 <video>（避免「设 srcObject 时元素尚未挂载」
 * 的时序问题）。video 模式下该流既作本地预览，也由会话按 ~1fps 抽帧上行给模型做视频理解。
 * start() 同时返回流，供开始通话时同步取用；组件卸载或 stop 时释放视频轨。
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface UseCameraResult {
  /** 当前视频流（供组件挂到 <video>），未开启为 null */
  stream: MediaStream | null;
  /** 摄像头是否已开启 */
  active: boolean;
  /** 用户可见错误文案 */
  error?: string;
  /** 开启摄像头（需用户手势触发）；成功返回流，失败返回 null */
  start: () => Promise<MediaStream | null>;
  /** 切换前后摄像头；未开启时无操作 */
  flip: () => Promise<MediaStream | null>;
  /** 关闭摄像头 */
  stop: () => void;
}

/**
 * 摄像头预览。
 */
export function useCamera(): UseCameraResult {
  const { t } = useTranslation('playground');
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string>();
  const facingModeRef = useRef<'user' | 'environment'>('user');

  async function start(): Promise<MediaStream | null> {
    setError(undefined);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t('cameraUnsupported'));
      return null;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingModeRef.current },
      });
      streamRef.current = s;
      setStream(s);
      return s;
    } catch (e) {
      const name = (e as DOMException)?.name;
      setError(name === 'NotAllowedError' ? t('cameraPermissionDenied') : t('cameraAccessFailed'));
      return null;
    }
  }

  async function flip(): Promise<MediaStream | null> {
    if (!streamRef.current) return null;
    const nextFacingMode = facingModeRef.current === 'user' ? 'environment' : 'user';
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacingMode },
      });
      streamRef.current.getTracks().forEach((track) => track.stop());
      facingModeRef.current = nextFacingMode;
      streamRef.current = next;
      setStream(next);
      setError(undefined);
      return next;
    } catch {
      setError(t('cameraFlipFailed'));
      return null;
    }
  }

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  return { stream, active: stream != null, error, start, flip, stop };
}
