/**
 * Camera preview hook.
 *
 * Purpose: provide a real camera preview for full-duplex calls in "realtime voice" — request a getUserMedia video stream and expose it as
 * state, and the component attaches it to its own <video> in useEffect (avoiding the timing problem of "setting srcObject before the element is mounted").
 * In video mode that stream is both the local preview and the frames the session grabs at ~1fps and sends up for the model to understand the video.
 * start() also returns the stream, so the call can take it synchronously when it starts; the video track is released when the component unmounts or stop is called.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface UseCameraResult {
  /** Current video stream (for the component to attach to <video>); null when it is off */
  stream: MediaStream | null;
  /** Whether the camera is on */
  active: boolean;
  /** User-visible error copy */
  error?: string;
  /** Turn the camera on (must be triggered by a user gesture); return the stream on success, or null on failure */
  start: () => Promise<MediaStream | null>;
  /** Switch between front and back cameras; no-op when the camera is off */
  flip: () => Promise<MediaStream | null>;
  /** Turn the camera off */
  stop: () => void;
}

/**
 * Camera preview.
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
