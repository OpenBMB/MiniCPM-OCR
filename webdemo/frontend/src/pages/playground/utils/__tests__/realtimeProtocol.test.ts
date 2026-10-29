/**
 * Unit tests for realtimeProtocol pure functions: frame construction must match the MiniCPM-O API V2 wire protocol,
 * downlink event normalization must branch correctly by type/kind, and unknown or corrupt frames safely degrade to other.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSessionInit,
  buildInputAppend,
  buildSessionClose,
  parseServerEvent,
  withHangupProtocol,
  stripHangupMarker,
  HANGUP_MARKER,
  type RealtimeConfig,
} from '../realtimeProtocol';

const CONFIG: RealtimeConfig = { length_penalty: 1.05, max_tokens: 1024, temperature: 0.7 };

describe('buildSessionInit', () => {
  it('下发官方实时配置字段', () => {
    const frame = JSON.parse(buildSessionInit('你是助手', CONFIG));
    expect(frame).toEqual({
      type: 'session.init',
      payload: {
        system_prompt: '你是助手',
        config: { length_penalty: 1.05, max_tokens: 1024, temperature: 0.7 },
      },
    });
  });

  it('video 模式附 max_slice_nums', () => {
    const frame = JSON.parse(buildSessionInit('sys', CONFIG, { maxSliceNums: 1 }));
    expect(frame.payload.max_slice_nums).toBe(1);
  });

  it('参考音频同时写入对话侧与 TTS 侧字段（音色克隆）', () => {
    const frame = JSON.parse(buildSessionInit('sys', CONFIG, { refAudioBase64: 'REF' }));
    expect(frame.payload.voice.ref_audio_base64).toBe('REF');
    expect(frame.payload.voice.tts_ref_audio_base64).toBe('REF');
  });

  it('独立 TTS 参考音频覆盖 TTS 字段但保留 LLM 参考音频', () => {
    const frame = JSON.parse(
      buildSessionInit('sys', CONFIG, { refAudioBase64: 'LLM', ttsRefAudioBase64: 'TTS' }),
    );
    expect(frame.payload.voice.ref_audio_base64).toBe('LLM');
    expect(frame.payload.voice.tts_ref_audio_base64).toBe('TTS');
  });

  it('参考音频按官方协议嵌套在 payload.voice', () => {
    const frame = JSON.parse(
      buildSessionInit('sys', CONFIG, { refAudioBase64: 'LLM', ttsRefAudioBase64: 'TTS' }),
    );
    expect(frame.payload.voice).toEqual({
      ref_audio_base64: 'LLM',
      tts_ref_audio_base64: 'TTS',
    });
  });

  it('无 opts 时不含参考音频与切片字段', () => {
    const frame = JSON.parse(buildSessionInit('sys', CONFIG));
    expect(frame.payload).not.toHaveProperty('max_slice_nums');
    expect(frame.payload).not.toHaveProperty('ref_audio_base64');
  });
});

describe('buildInputAppend', () => {
  it('仅音频时只带 audio 字段', () => {
    expect(JSON.parse(buildInputAppend('AAAA'))).toEqual({
      type: 'input.append',
      input: { audio: 'AAAA' },
    });
  });

  it('forceListen=true 时附 force_listen', () => {
    const frame = JSON.parse(buildInputAppend('AAAA', { forceListen: true }));
    expect(frame.input.force_listen).toBe(true);
  });

  it('forceListen 为 false/undefined 时不带该键', () => {
    expect(JSON.parse(buildInputAppend('AAAA', { forceListen: false })).input).not.toHaveProperty(
      'force_listen',
    );
    expect(JSON.parse(buildInputAppend('AAAA', {})).input).not.toHaveProperty('force_listen');
  });

  it('有视频帧时附 video_frames，空数组则忽略', () => {
    expect(JSON.parse(buildInputAppend('A', { videoFrames: ['f1'] })).input.video_frames).toEqual([
      'f1',
    ]);
    expect(JSON.parse(buildInputAppend('A', { videoFrames: [] })).input).not.toHaveProperty(
      'video_frames',
    );
  });
});

describe('buildSessionClose', () => {
  it('携带挂断原因', () => {
    expect(JSON.parse(buildSessionClose('user_stop'))).toEqual({
      type: 'session.close',
      reason: 'user_stop',
    });
  });
});

describe('parseServerEvent', () => {
  it('session.queued / session.queue_update 保留排队进度', () => {
    expect(
      parseServerEvent(
        '{"type":"session.queued","position":3,"estimated_wait_s":12,"queue_length":8}',
      ),
    ).toEqual({
      kind: 'queue',
      position: 3,
      estimatedWaitSeconds: 12,
      queueLength: 8,
    });
    expect(parseServerEvent('{"type":"session.queue_update","position":1}')).toEqual({
      kind: 'queue',
      position: 1,
      estimatedWaitSeconds: undefined,
      queueLength: undefined,
    });
  });

  it('session.queue_done / queue_done 均归一为 queue_done', () => {
    expect(parseServerEvent('{"type":"session.queue_done"}').kind).toBe('queue_done');
    expect(parseServerEvent('{"type":"queue_done"}').kind).toBe('queue_done');
  });

  it('session.created → created', () => {
    expect(parseServerEvent('{"type":"session.created","session_id":"s1"}').kind).toBe('created');
  });

  it('session.closed 携带 reason', () => {
    expect(parseServerEvent('{"type":"session.closed","reason":"timeout"}')).toEqual({
      kind: 'closed',
      reason: 'timeout',
    });
  });

  it('error 对象/字符串两种形态都能取出消息', () => {
    expect(parseServerEvent('{"type":"error","error":{"message":"boom"}}')).toEqual({
      kind: 'error',
      message: 'boom',
    });
    expect(parseServerEvent('{"type":"error","error":"oops"}')).toEqual({
      kind: 'error',
      message: 'oops',
    });
  });

  it('legacy response.output_audio.delta → audio', () => {
    expect(parseServerEvent('{"type":"response.output_audio.delta","audio":"B64"}')).toEqual({
      kind: 'audio',
      audio: 'B64',
    });
  });

  it('response.listen 携带用户转写文本', () => {
    expect(parseServerEvent('{"type":"response.listen","text":"你好"}')).toEqual({
      kind: 'listen',
      text: '你好',
    });
    expect(parseServerEvent('{"type":"response.listen"}')).toEqual({ kind: 'listen' });
  });

  it('response.output.delta 按 kind 分流（audio/text/listen）', () => {
    expect(
      parseServerEvent('{"type":"response.output.delta","kind":"audio","audio":"B64"}'),
    ).toEqual({ kind: 'audio', audio: 'B64' });
    expect(
      parseServerEvent(
        '{"type":"response.output.delta","kind":"text","text":"你好","end_of_turn":true}',
      ),
    ).toEqual({
      kind: 'text',
      text: '你好',
      endOfTurn: true,
    });
    expect(parseServerEvent('{"type":"response.output.delta","kind":"listen"}').kind).toBe(
      'listen',
    );
  });

  it('空音频降级为 other', () => {
    expect(
      parseServerEvent('{"type":"response.output.delta","kind":"audio","audio":""}').kind,
    ).toBe('other');
  });

  it('未知类型与损坏 JSON 均降级为 other', () => {
    expect(parseServerEvent('{"type":"response.metrics"}').kind).toBe('other');
    expect(parseServerEvent('not-json').kind).toBe('other');
  });
});

describe('挂断标记约定', () => {
  it('约定追加在系统提示词之后，保留用户原文', () => {
    const out = withHangupProtocol('你是客服。');
    expect(out.startsWith('你是客服。')).toBe(true);
    expect(out).toContain(HANGUP_MARKER);
  });

  it('剥离标记：命中时从展示文本中去掉，并报告命中', () => {
    expect(stripHangupMarker(`再见啦${HANGUP_MARKER}`)).toEqual({ clean: '再见啦', hangup: true });
  });

  it('未命中时原样返回；单纯"提及"挂断不触发', () => {
    expect(stripHangupMarker('你可以随时挂断')).toEqual({ clean: '你可以随时挂断', hangup: false });
    expect(stripHangupMarker('需要我帮你做什么吗')).toEqual({
      clean: '需要我帮你做什么吗',
      hangup: false,
    });
  });

  it('模型不输出标记时靠告别语兜底（实测 MiniCPM-o 只说自然语言）', () => {
    // These sentences are real replies that were actually observed
    expect(stripHangupMarker('好的，我这就帮你挂断通话。').hangup).toBe(true);
    expect(stripHangupMarker('好的，我可以帮你挂断。你还有其他需要帮助的事情吗？').hangup).toBe(
      true,
    );
    expect(stripHangupMarker('那我们就先告别啦！祝你今天过得愉快').hangup).toBe(true);
  });

  it('标记出现多次时全部剥离', () => {
    expect(stripHangupMarker(`a${HANGUP_MARKER}b${HANGUP_MARKER}`)).toEqual({
      clean: 'ab',
      hangup: true,
    });
  });
});
