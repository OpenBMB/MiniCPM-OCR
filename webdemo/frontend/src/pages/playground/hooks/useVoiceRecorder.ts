/** 麦克风直接采集 PCM/WAV，支持暂停、继续、声纹反馈和有效时长限制。 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { attachSpectrum, pcmToWavBlob } from '../utils/audioEncode';
import {
  mergeRecordingChunks,
  releaseRecordingSession,
  type PcmRecordingSession,
} from './voiceRecorderSession';

const RECORD_BAR_COUNT = 28;

/**
 * 麦克风录音片段编排。
 * @param onClip 录制结束后的 WAV Blob 回调
 * @param maxSeconds 单段录音上限（秒），达上限自动停止；默认 50（对齐官方参考音频时长上限）
 * @returns 录音状态及 start / pause / resume / stop / cancel 操作
 */
export function useVoiceRecorder(onClip: (blob: Blob) => void, maxSeconds = 50) {
  const { t } = useTranslation('playground');
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [bars, setBars] = useState<number[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string>();
  const sessionRef = useRef<PcmRecordingSession | undefined>(undefined);
  const pendingStreamRef = useRef<MediaStream | undefined>(undefined);
  const operationRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const secondsRef = useRef(0);
  const pausedRef = useRef(false);
  const stopVizRef = useRef<(() => void) | undefined>(undefined);
  const vizContextRef = useRef<AudioContext | undefined>(undefined);
  const onClipRef = useRef(onClip);
  useEffect(() => {
    onClipRef.current = onClip;
  }, [onClip]);

  function clearTimer() {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = undefined;
  }

  function teardownViz() {
    stopVizRef.current?.();
    stopVizRef.current = undefined;
    void vizContextRef.current?.close();
    vizContextRef.current = undefined;
    setBars([]);
  }

  async function start() {
    const operation = ++operationRef.current;
    setError(undefined);
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
      setError(t('recorderUnsupported'));
      return;
    }
    if (sessionRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (operation !== operationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      pendingStreamRef.current = stream;
      const context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const sink = context.createGain();
      sink.gain.value = 0;
      const session: PcmRecordingSession = {
        stream,
        context,
        source,
        processor,
        sink,
        chunks: [],
        sampleRate: context.sampleRate,
      };
      pendingStreamRef.current = undefined;
      if (operation !== operationRef.current) {
        releaseRecordingSession(session);
        return;
      }

      processor.onaudioprocess = (event) => {
        if (pausedRef.current) return;
        const input = event.inputBuffer;
        const channelCount = input.numberOfChannels;
        const channels = Array.from({ length: channelCount }, (_, index) =>
          input.getChannelData(index),
        );
        const samples = new Float32Array(input.length);
        for (let index = 0; index < input.length; index += 1) {
          let value = 0;
          channels.forEach((channel) => {
            value += channel[index] ?? 0;
          });
          samples[index] = value / channelCount;
        }
        session.chunks.push(samples);
      };
      source.connect(processor);
      processor.connect(sink);
      sink.connect(context.destination);
      sessionRef.current = session;
      setRecording(true);
      setPaused(false);
      pausedRef.current = false;
      setSeconds(0);
      secondsRef.current = 0;

      // 频谱失败不应影响录音主链路，因此使用独立 AudioContext 并单独容错。
      try {
        const vizContext = new AudioContext();
        vizContextRef.current = vizContext;
        stopVizRef.current = attachSpectrum(
          vizContext,
          stream,
          RECORD_BAR_COUNT,
          (_level, next) => {
            setBars(next);
          },
        );
      } catch {
        // 浏览器禁用 AudioContext 时仍保留录音能力，只是不显示声纹。
      }

      tickRef.current = setInterval(() => {
        if (pausedRef.current || !sessionRef.current) return;
        const nextSeconds = Math.min(maxSeconds, secondsRef.current + 1);
        secondsRef.current = nextSeconds;
        setSeconds(nextSeconds);
        if (nextSeconds >= maxSeconds) stop();
      }, 1000);
    } catch {
      pendingStreamRef.current?.getTracks().forEach((track) => track.stop());
      pendingStreamRef.current = undefined;
      if (operation === operationRef.current) setError(t('microphoneAccessFailed'));
    }
  }

  function pause() {
    if (!sessionRef.current || pausedRef.current) return;
    pausedRef.current = true;
    setPaused(true);
  }

  function resume() {
    if (!sessionRef.current || !pausedRef.current) return;
    pausedRef.current = false;
    setPaused(false);
  }

  function stop() {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = undefined;
    clearTimer();
    teardownViz();
    releaseRecordingSession(session);
    setRecording(false);
    setPaused(false);
    pausedRef.current = false;
    const samples = session.chunks.length
      ? mergeRecordingChunks(session.chunks)
      : new Float32Array([0]);
    onClipRef.current(pcmToWavBlob(samples, session.sampleRate));
  }

  function cancel() {
    operationRef.current += 1;
    pendingStreamRef.current?.getTracks().forEach((track) => track.stop());
    pendingStreamRef.current = undefined;
    clearTimer();
    teardownViz();
    if (sessionRef.current) {
      const session = sessionRef.current;
      sessionRef.current = undefined;
      releaseRecordingSession(session);
    }
    setRecording(false);
    setPaused(false);
    setSeconds(0);
    secondsRef.current = 0;
    pausedRef.current = false;
  }

  useEffect(
    () => () => {
      clearTimer();
      teardownViz();
      if (sessionRef.current) {
        const session = sessionRef.current;
        sessionRef.current = undefined;
        releaseRecordingSession(session);
      }
      pendingStreamRef.current?.getTracks().forEach((track) => track.stop());
      pendingStreamRef.current = undefined;
    },
    [],
  );

  return { recording, paused, bars, seconds, error, start, pause, resume, stop, cancel };
}
