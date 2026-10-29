/**
 * modelExperience classification tests: routing trusts only the capabilities checked in admin, and no longer guesses from model-name keywords.
 */

import { describe, it, expect } from 'vitest';
import type { MapModel } from '@/api/map';
import {
  classifyModel,
  isFreeModel,
  languageModels,
  modelsByExperience,
} from '../utils/modelExperience';

/** Build a minimal usable model; only id, display_name, and capabilities matter for the decision. */
function model(id: string, capabilities: Record<string, boolean> = {}, displayName = ''): MapModel {
  return {
    id,
    display_name: displayName,
    context_window: 0,
    max_output_tokens: 0,
    capabilities,
  };
}

describe('classifyModel', () => {
  it('按管理端勾选的能力判定，与模型名无关', () => {
    expect(classifyModel(model('foo-1', { speech_synthesis: true }))).toBe('tts');
    expect(classifyModel(model('bar-2', { realtime_dialog: true }))).toBe('realtime');
    expect(classifyModel(model('ocr-1', { document_parse: true, input_image: true }))).toBe(
      'image-parse',
    );
  });

  it('能力优先于名字：名字像对话模型但勾了语音合成，仍判为 tts', () => {
    expect(classifyModel(model('deepseek-chat', { speech_synthesis: true }))).toBe('tts');
  });

  it('同时勾选两项时按 realtime 处理（全双工优先于单向合成）', () => {
    expect(classifyModel(model('x', { speech_synthesis: true, realtime_dialog: true }))).toBe(
      'realtime',
    );
  });

  it('勾了 document_parse 但未声明图像输入时，不进入图像解析体验', () => {
    expect(classifyModel(model('ocr-no-image', { document_parse: true }))).toBe('language');
  });

  it('语言对话里能看图的模型，不等于图像解析模型', () => {
    expect(classifyModel(model('vl-chat', { input_image: true, vision: true }))).toBe('language');
  });

  it('兼容归一前的历史 key audio_speech', () => {
    expect(classifyModel(model('voxcpm2', { audio_speech: true }))).toBe('tts');
  });

  it('名字像语音模型但没勾能力，一律算普通对话模型（不再靠关键词猜）', () => {
    expect(classifyModel(model('voxcpm2'))).toBe('language');
    expect(classifyModel(model('minicpm-o-realtime'))).toBe('language');
    expect(classifyModel(model('x', {}, '实时语音'))).toBe('language');
  });

  it('显式 false 不算具备该能力', () => {
    expect(classifyModel(model('x', { speech_synthesis: false }))).toBe('language');
  });
});

describe('languageModels / modelsByExperience', () => {
  const all = [
    model('deepseek-chat'),
    model('vox-a', { speech_synthesis: true, input_text: true }),
    model('vox-b', { audio_speech: true, input_text: true }),
    model('duplex-x', { realtime_dialog: true, input_text: true }),
    model('ocr-md', { document_parse: true, input_image: true }),
    model('vl-chat-ocr', { document_parse: true, input_image: true, input_text: true }),
  ];

  it('语言对话包含支持文本的图像解析模型，仍排除语音、实时与纯图像模型', () => {
    const expected = ['deepseek-chat', 'vl-chat-ocr'];
    expect(languageModels(all).map((m) => m.id)).toEqual(expected);
    expect(modelsByExperience(all, 'language').map((m) => m.id)).toEqual(expected);
  });

  it('返回该类别下全部模型（含历史 key），保持原顺序', () => {
    expect(modelsByExperience(all, 'tts').map((m) => m.id)).toEqual(['vox-a', 'vox-b']);
    expect(modelsByExperience(all, 'realtime').map((m) => m.id)).toEqual(['duplex-x']);
    expect(modelsByExperience(all, 'image-parse').map((m) => m.id)).toEqual([
      'ocr-md',
      'vl-chat-ocr',
    ]);
  });

  it('显式关闭文本输入的图像解析模型只出现在图像解析列表', () => {
    const imageOnly = model('image-only', {
      document_parse: true,
      input_image: true,
      input_text: false,
    });
    expect(languageModels([imageOnly])).toEqual([]);
    expect(modelsByExperience([imageOnly], 'image-parse')).toEqual([imageOnly]);
  });

  it('语言对话排除未启用 OpenAI 协议的特殊模型', () => {
    const ocr = {
      ...model('ocr-special', {
        document_parse: true,
        input_image: true,
        input_text: true,
      }),
      protocols: ['document_parse'],
    } as MapModel;
    const dualProtocol = {
      ...model('dual-protocol', {
        document_parse: true,
        input_image: true,
        input_text: true,
      }),
      protocols: ['openai', 'document_parse'],
    } as MapModel;
    const noProtocol = { ...model('no-protocol'), protocols: [] } as MapModel;

    expect(languageModels([ocr, dualProtocol, noProtocol]).map((m) => m.id)).toEqual([
      'dual-protocol',
    ]);
    expect(modelsByExperience([ocr], 'image-parse')).toEqual([ocr]);
  });

  it('该类别无模型时返回空数组', () => {
    expect(modelsByExperience([model('deepseek-chat')], 'tts')).toEqual([]);
  });
});

describe('isFreeModel', () => {
  it('只认后端按定价时间窗计算的 is_free，不再读取旧能力位', () => {
    expect(isFreeModel({ ...model('free-now'), is_free: true })).toBe(true);
    expect(isFreeModel({ ...model('legacy', { limited_free: true }), is_free: false })).toBe(false);
  });
});
