/**
 * 语音合成（TTS）编排 Hook。
 *
 * 用途：把「合成文本」「声音描述（预设/自定义）」「音色选择」「上传/录制参考音频」「引导
 * 强度/高级开关」状态与一次真实合成请求收敛为状态机。合成走 synthesizeSpeech（L2 `/v1/audio/speech`），
 * 成功后拿到可播放/下载的 Object URL，并在重合成/卸载时释放旧 URL。音色三态：默认（无 ref）/ 预置（内置
 * wav → data URI）/ 平台私有音色（voice_xxx 由 MAP 按用户归属解析，仅语音复刻模式可用）。
 * 明文密钥经 usePlaygroundModel 懒取，不落盘。
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

// 供视图直接从本 Hook 取用音色目录 / 声音描述预设 / 输出格式与合成参数常量（避免视图跨层再引 utils）
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
 * 语音合成编排。
 * @param model usePlaygroundModel 返回（提供模型、密钥）
 * @param allowSavedVoices 是否为语音复刻模式；仅该模式读取用户私有音色
 */
export function useTtsSynthesis(model: PlaygroundModel, allowSavedVoices: boolean) {
  const { t, i18n } = useTranslation('playground');
  const [text, setText] = useState(() => t('ttsSample1'));
  const defaultSampleRef = useRef(t('ttsSample1'));
  const [voice, setVoice] = useState(VOICE_DEFAULT);
  // 声音描述（Control Instruction）：预设选择 + 自定义/预设共用的描述文本 + 引导强度（cfg_value）
  const [controlPreset, setControlPreset] = useState(CONTROL_NONE);
  const [control, setControl] = useState('');
  const [cfg, setCfg] = useState(TTS_CFG_DEFAULT);
  // 高级开关：参考音频降噪 / 文本规范化（透传上游，生效取决于 LIS 能力）
  const [denoise, setDenoise] = useState(false);
  const [normalize, setNormalize] = useState(false);
  // 上传复刻的参考音频（16k wav data URI）与原文件名
  const [uploadRef, setUploadRef] = useState<string>();
  const [uploadName, setUploadName] = useState<string>();
  // 录音路径错误（权限/时长）——上传路径的错误由视图 try/catch 弹 toast
  const [recordError, setRecordError] = useState<string>();
  const [audioUrl, setAudioUrl] = useState<string>();
  // 结果音频的实际格式（随合成落定，与 format 选择解耦——切了格式但未重合成时下载名仍对应现有音频）
  const [audioFormat, setAudioFormat] = useState<TtsFormat>('wav');
  const urlRef = useRef<string | undefined>(undefined);
  const voicesQuery = useVoicesQuery(allowSavedVoices);
  const savedVoices = useMemo<MapVoiceResource[]>(
    () => voicesQuery.data?.list ?? [],
    [voicesQuery.data?.list],
  );
  // 查询完成后若历史音色已删除，视图和请求都回退默认值；不在 effect 里同步 setState，
  // 避免查询结果到达时产生额外级联渲染，同时保留用户刚选择的有效私有音色。
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
  // 自定义项才展开描述输入框；预设项直接用其固定描述，不可编辑
  const isCustomControl = controlPreset === CONTROL_CUSTOM;

  /**
   * 选择声音描述预设：预设→套用其描述并（若有）填入配套示例文案；
   * 自定义→清空描述交由用户输入；不使用→清空描述。
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

  // 预置/临时录音通过 ref_audio 传递；私有音色只传 voice_xxx，
  // 由后端按当前用户归属解析对象存储资源，避免浏览器重复下载大文件。
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
        // cfg 门控：仅在用户从默认调开时下发，保护默认合成路径；denoise/normalize 仅开启时下发（透传上游）
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
      // 合成终态后刷新免费次数，额度用尽时立即回退用户自有 Key。
      model.refreshTrial();
    },
  });

  /** 上传/录音参考音频：转 16k wav data URI 存入状态；超 50s 或转码失败回抛可读文案 */
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

  // 录音路径：录完的整段音频复用 uploadReference（含 50s 校验），错误落 recordError 供视图内联展示
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

  // 卸载时释放最后一个 Object URL
  useEffect(() => () => void (urlRef.current && URL.revokeObjectURL(urlRef.current)), []);

  // 可合成：有文本 + 有模型 + 非合成中；选「上传复刻」时须已上传参考音频
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
    // 声音描述（预设下拉 + 自定义展开）与引导强度
    controlPreset,
    selectControlPreset,
    isCustomControl,
    control,
    setControl,
    cfg,
    setCfg,
    // 高级开关：降噪 / 文本规范化（透传，生效取决于上游）
    denoise,
    setDenoise,
    normalize,
    setNormalize,
    isUpload,
    savedVoices,
    savedVoicesLoading: voicesQuery.isLoading,
    savedVoicesError: voicesQuery.isError,
    uploadName,
    // 参考音频 data URI，可直接喂 <audio> 试听（重录/重传会自动覆盖，无需先清除）
    referenceUrl: uploadRef,
    uploadReference,
    clearReference,
    // 录音入口（对齐官方 microphone 来源）
    recording: recorder.recording,
    // 录制中的实时频谱条与已录秒数，供视图显示声纹，让用户确认在收音
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
