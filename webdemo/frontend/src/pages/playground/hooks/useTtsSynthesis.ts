/**
 * Speech-synthesis (TTS) orchestration hook.
 *
 * Purpose: collapse the state of "synthesis text", "voice description (preset or custom)", "voice selection", "uploaded or recorded reference audio", and "guidance
 * strength / advanced switches" together with one real synthesis request into a state machine. Synthesis goes through synthesizeSpeech (L2 `/v1/audio/speech`),
 * and on success receives an Object URL that can be played and downloaded; the old URL is released on re-synthesis or unmount. A voice has three states: default (no ref) / preset (built-in
 * wav → data URI) / a platform private voice (voice_xxx is resolved by MAP from user ownership, and is available only in voice-clone mode).
 * The plaintext secret is read lazily through usePlaygroundModel and is not persisted to disk.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { synthesizeSpeech } from '@/api/map/audio';
import type { TtsFormat } from '@/api/map/audio';
import { useVoicesQuery, type MapVoiceResource } from '@/api/map';
import { blobToWav16k } from '../utils/audioEncode';
import {
  TTS_VOICES,
  VOICE_DEFAULT,
  VOICE_UPLOAD,
  TTS_CONTROL_PRESETS,
  TTS_CFG_DEFAULT,
  TTS_REF_MAX_SECONDS,
  CONTROL_CUSTOM,
  CONTROL_NONE,
  fetchRefAudioDataUri,
  isSavedVoiceReady,
  resolveTtsVoice,
} from '../utils/ttsVoices';
import { useVoiceRecorder } from './useVoiceRecorder';
import type { usePlaygroundModel } from './usePlaygroundModel';

type PlaygroundModel = ReturnType<typeof usePlaygroundModel>;

// The view takes the voice catalog, voice-description presets, output format, and synthesis-parameter constants directly from this hook (so the view does not import utils across layers)
export {
  TTS_VOICES,
  VOICE_DEFAULT,
  VOICE_UPLOAD,
  resolveTtsMode,
  ttsVoicesForMode,
  TTS_SAMPLES,
  TTS_MAX_LEN,
} from '../utils/ttsVoices';
export {
  TTS_CFG_MIN,
  TTS_CFG_MAX,
  TTS_CFG_STEP,
  TTS_CFG_DEFAULT,
  TTS_REF_MAX_SECONDS,
} from '../utils/ttsVoices';
export {
  TTS_CONTROL_PRESETS,
  TTS_CONTROL_EXAMPLES,
  CONTROL_NONE,
  CONTROL_CUSTOM,
} from '../utils/ttsVoices';

/**
 * Speech-synthesis orchestration.
 * @param model return value of usePlaygroundModel (provides the model and the secret)
 * @param allowSavedVoices whether this is voice-clone mode; only that mode reads the user's private voices
 */
export function useTtsSynthesis(model: PlaygroundModel, allowSavedVoices: boolean) {
  const { t, i18n } = useTranslation('playground');
  const [text, setText] = useState(() => t('ttsSample1'));
  const defaultSampleRef = useRef(t('ttsSample1'));
  const [voice, setVoice] = useState(VOICE_DEFAULT);
  // Voice description (Control Instruction): preset selection + description text shared by custom and preset + guidance strength (cfg_value)
  const [controlPreset, setControlPreset] = useState(CONTROL_NONE);
  const [control, setControl] = useState('');
  const [cfg, setCfg] = useState(TTS_CFG_DEFAULT);
  // Advanced switches: reference-audio denoise / text normalization (forwarded upstream; whether they take effect depends on LIS capability)
  const [denoise, setDenoise] = useState(false);
  const [normalize, setNormalize] = useState(false);
  // Reference audio of an uploaded clone (16k wav data URI) and the original file name
  const [uploadRef, setUploadRef] = useState<string>();
  const [uploadName, setUploadName] = useState<string>();
  // Recording-path errors (permission or duration) — upload-path errors are toasted by the view in try/catch
  const [recordError, setRecordError] = useState<string>();
  const [audioUrl, setAudioUrl] = useState<string>();
  // Actual format of the result audio (settled with the synthesis, decoupled from the format selection — if the format was switched but not re-synthesized, the download name still matches the existing audio)
  const [audioFormat, setAudioFormat] = useState<TtsFormat>('wav');
  const urlRef = useRef<string | undefined>(undefined);
  const voicesQuery = useVoicesQuery(allowSavedVoices);
  const savedVoices = useMemo<MapVoiceResource[]>(
    () => voicesQuery.data?.list ?? [],
    [voicesQuery.data?.list],
  );
  // After the query finishes, if a history voice was deleted, both the view and the request fall back to the default; do not setState synchronously in an effect,
  // so the query result arriving does not cause an extra cascading render, while a valid private voice the user just selected is kept.
  const effectiveVoice = resolveTtsVoice(
    voice,
    allowSavedVoices,
    savedVoices,
    voicesQuery.isSuccess,
  );
  const privateVoiceReady =
    !voice.startsWith('voice_') ||
    (allowSavedVoices && isSavedVoiceReady(voice, savedVoices, voicesQuery.isSuccess));

  useEffect(() => {
    const nextDefaultSample = t('ttsSample1');
    setText((current) => (current === defaultSampleRef.current ? nextDefaultSample : current));
    defaultSampleRef.current = nextDefaultSample;
  }, [i18n.resolvedLanguage, t]);

  const isUpload = effectiveVoice === VOICE_UPLOAD;
  // Only the custom item expands the description input; a preset item uses its fixed description directly and cannot be edited
  const isCustomControl = controlPreset === CONTROL_CUSTOM;

  /**
   * Select a voice-description preset: a preset applies its description and, if any, fills in the matching example copy;
   * custom clears the description for the user to type; none clears the description.
   */
  function selectControlPreset(value: string) {
    setControlPreset(value);
    const preset = TTS_CONTROL_PRESETS.find((p) => p.value === value);
    if (value === CONTROL_CUSTOM) {
      setVoice(VOICE_DEFAULT);
      setControl('');
      return;
    }
    setControl(preset?.control ?? '');
    if (preset?.sampleText) setText(preset.sampleText);
  }

  // A preset or a temporary recording is passed through ref_audio; a private voice passes only voice_xxx,
  // and the backend resolves the object-storage resource from the current user's ownership, so the browser does not download a large file again.
  async function resolveRefAudio(): Promise<string | undefined> {
    if (effectiveVoice === VOICE_DEFAULT) return undefined;
    if (effectiveVoice.startsWith('voice_')) return undefined;
    if (isUpload) return uploadRef;
    const preset = TTS_VOICES.find((v) => v.value === effectiveVoice);
    return preset?.refPath ? fetchRefAudioDataUri(preset.refPath) : undefined;
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const modelId = model.ttsModel?.id;
      if (!modelId) throw new Error(t('ttsNoModel'));
      const secret = model.getSecret();
      if (!secret) throw new Error(t('apiKeyNotReady'));
      const refAudio = await resolveRefAudio();
      return synthesizeSpeech({
        model: modelId,
        secret,
        text: text.trim(),
        voice: effectiveVoice.startsWith('voice_') ? effectiveVoice : undefined,
        control,
        refAudio,
        // cfg gating: send it only when the user has moved it off the default, protecting the default synthesis path; denoise and normalize are sent only when turned on (forwarded upstream)
        cfg: cfg !== TTS_CFG_DEFAULT ? cfg : undefined,
        denoise: denoise || undefined,
        normalize: normalize || undefined,
      });
    },
    onSuccess: (result) => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = result.objectUrl;
      setAudioUrl(result.objectUrl);
      setAudioFormat(result.format);
    },
    onSettled: () => {
      // After synthesis reaches a terminal state, refresh the free count, and fall back to the user's own key immediately when the quota is used up.
      model.refreshTrial();
    },
  });

  /** Upload or record reference audio: convert to a 16k wav data URI and store it in state; over 50s, or a transcode failure, rethrows readable copy */
  async function uploadReference(file: Blob, name?: string) {
    const { base64, durationSeconds } = await blobToWav16k(file);
    if (durationSeconds > TTS_REF_MAX_SECONDS) {
      throw new Error(
        t('referenceAudioTooLong', {
          duration: Math.round(durationSeconds),
          max: TTS_REF_MAX_SECONDS,
        }),
      );
    }
    setUploadRef(`data:audio/wav;base64,${base64}`);
    setUploadName(name ?? (file instanceof File ? file.name : t('recordingClip')));
  }

  // Recording path: the finished clip reuses uploadReference (including the 50s check), and errors land in recordError for inline display in the view
  const recorder = useVoiceRecorder(async (blob) => {
    try {
      await uploadReference(blob, `${t('recordingClip')}.wav`);
      setRecordError(undefined);
    } catch (e) {
      setRecordError((e as Error).message);
    }
  }, TTS_REF_MAX_SECONDS);

  function clearReference() {
    setUploadRef(undefined);
    setUploadName(undefined);
    setRecordError(undefined);
  }

  // On unmount, release the last Object URL
  useEffect(() => () => void (urlRef.current && URL.revokeObjectURL(urlRef.current)), []);

  // Can synthesize: has text + has a model + not synthesizing; when "upload a clone" is selected, reference audio must already be uploaded
  const credentialAvailable = model.trialRemaining.tts > 0 || model.hasKeys;
  const canSynthesize = useMemo(
    () =>
      text.trim().length > 0 &&
      Boolean(model.ttsModel) &&
      Boolean(model.keyId) &&
      model.secretReady &&
      !mutation.isPending &&
      privateVoiceReady &&
      credentialAvailable &&
      (!isUpload || Boolean(uploadRef)),
    [
      text,
      model.ttsModel,
      model.keyId,
      model.secretReady,
      mutation.isPending,
      privateVoiceReady,
      credentialAvailable,
      isUpload,
      uploadRef,
    ],
  );

  return {
    text,
    setText,
    voice: effectiveVoice,
    setVoice,
    // Voice description (preset dropdown + custom expand) and guidance strength
    controlPreset,
    selectControlPreset,
    isCustomControl,
    control,
    setControl,
    cfg,
    setCfg,
    // Advanced switches: denoise / text normalization (passed through; whether they take effect depends on the upstream)
    denoise,
    setDenoise,
    normalize,
    setNormalize,
    isUpload,
    savedVoices,
    savedVoicesLoading: voicesQuery.isLoading,
    savedVoicesError: voicesQuery.isError,
    uploadName,
    // Reference-audio data URI, which can be fed straight to <audio> for a preview (re-recording or re-uploading overwrites it; no need to clear first)
    referenceUrl: uploadRef,
    uploadReference,
    clearReference,
    // Recording entry (aligned with the official microphone source)
    recording: recorder.recording,
    // Live spectrum bars and recorded seconds while recording, so the view can show a voiceprint and the user can confirm it is picking up sound
    recordBars: recorder.bars,
    recordSeconds: recorder.seconds,
    startRecording: () => {
      setRecordError(undefined);
      recorder.start();
    },
    stopRecording: recorder.stop,
    recordError: recordError ?? recorder.error,
    audioUrl,
    audioFormat,
    synthesize: () => mutation.mutate(),
    loading: mutation.isPending,
    error: mutation.isError ? (mutation.error as Error).message : undefined,
    canSynthesize,
  };
}
