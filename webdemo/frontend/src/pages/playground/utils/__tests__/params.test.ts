/**
 * params 映射纯函数单测：思考字段开关需真实下发，采样参数需透传。
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_PARAMS } from '../../types';
import { buildChatParams, buildThinkingParams, supportsImageDownsampleMode } from '../params';

describe('supportsImageDownsampleMode', () => {
  it.each(['MiniCPM-V-4.7', 'MiniCPM-V-4.7-1B', ' minicpm-v-4.7-35b-a3b '])(
    '支持 v4.7 系列模型 %s',
    (model) => {
      expect(supportsImageDownsampleMode(model)).toBe(true);
    },
  );

  it.each(['', 'text-model', 'MiniCPM-V-4.6', 'MiniCPM-V-4.70', 'MiniCPM-V-4.7preview'])(
    '不误判其他模型 %s',
    (model) => {
      expect(supportsImageDownsampleMode(model)).toBe(false);
    },
  );
});

describe('buildThinkingParams', () => {
  it('both 风格开启：chat_template_kwargs.enable_thinking=true + reasoning_effort', () => {
    expect(buildThinkingParams('on', 'both')).toEqual({
      chat_template_kwargs: { enable_thinking: true },
      reasoning_effort: 'medium',
    });
  });

  it('both 风格关闭：显式 enable_thinking=false（无 reasoning_effort）', () => {
    expect(buildThinkingParams('off', 'both')).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it('reasoning_effort 风格关闭：仍下发 enable_thinking=false 关闭默认思考', () => {
    expect(buildThinkingParams('off', 'reasoning_effort')).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it('thinking 风格开启：下发 thinking.type=enabled（不附 reasoning_effort）', () => {
    expect(buildThinkingParams('on', 'thinking')).toEqual({
      thinking: { type: 'enabled' },
    });
  });
});

describe('buildChatParams', () => {
  const messages = [{ role: 'user' as const, content: '你好' }];
  const imageMessages = [
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: '请描述这张图片' },
        { type: 'image_url' as const, image_url: { url: 'https://example.com/image.png' } },
      ],
    },
  ];

  it('未设置采样参数时不下发对应字段', () => {
    const p = buildChatParams('m1', messages, {
      ...DEFAULT_PARAMS,
      temperature: undefined,
      topP: undefined,
      maxTokens: undefined,
    });
    expect(p.model).toBe('m1');
    expect('temperature' in p).toBe(false);
    expect('top_p' in p).toBe(false);
    expect('max_tokens' in p).toBe(false);
  });

  it('显式 0 是有效值，三个采样字段都必须下发', () => {
    const p = buildChatParams('m1', messages, {
      ...DEFAULT_PARAMS,
      temperature: 0,
      topP: 0,
      maxTokens: 0,
    });
    expect(p.temperature).toBe(0);
    expect(p.top_p).toBe(0);
    expect(p.max_tokens).toBe(0);
  });

  it('max_tokens>0 时下发', () => {
    const p = buildChatParams('m1', messages, { ...DEFAULT_PARAMS, maxTokens: 2048 });
    expect(p.max_tokens).toBe(2048);
  });

  it('默认 both 风格 + 开启思考：请求体含思考字段', () => {
    const p = buildChatParams('m1', messages, { ...DEFAULT_PARAMS, thinkingDepth: 'on' });
    expect(p.chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(p.reasoning_effort).toBe('medium');
  });

  it('关闭思考：显式 enable_thinking=false（覆盖模型默认 true）', () => {
    const p = buildChatParams('m1', messages, { ...DEFAULT_PARAMS, thinkingDepth: 'off' });
    expect(p.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect('reasoning_effort' in p).toBe(false);
  });

  it('模型已配置思考默认值且用户未操作时不发送思考字段', () => {
    const p = buildChatParams('m1', messages, {
      ...DEFAULT_PARAMS,
      thinkingDepth: 'on',
      includeThinkingParams: false,
    });

    expect('chat_template_kwargs' in p).toBe(false);
    expect('reasoning_effort' in p).toBe(false);
  });

  it('thinking 模型的用户关闭操作沿用 thinking 字段协议', () => {
    const p = buildChatParams('m1', messages, {
      ...DEFAULT_PARAMS,
      thinkingDepth: 'off',
      thinkingStyle: 'thinking',
      thinkingControlFormat: 'thinking',
    });

    expect(p.thinking).toEqual({ type: 'disabled' });
    expect('chat_template_kwargs' in p).toBe(false);
  });

  it('开启联网：不下发 web_search_options，由前端分流到 BFF', () => {
    const p = buildChatParams('m1', messages, { ...DEFAULT_PARAMS, webSearch: true });
    expect('web_search_options' in p).toBe(false);
  });

  it('关闭联网：不下发 web_search_options', () => {
    const p = buildChatParams('m1', messages, { ...DEFAULT_PARAMS, webSearch: false });
    expect('web_search_options' in p).toBe(false);
  });

  it('v4.7 未选择图片压缩比例时不下发视觉参数', () => {
    const p = buildChatParams('MiniCPM-V-4.7-1B', messages, DEFAULT_PARAMS);
    expect(p).not.toHaveProperty('mm_processor_kwargs');
  });

  it.each(['4x', '16x'] as const)('显式选择 %s 时在顶层下发图片压缩参数', (mode) => {
    const p = buildChatParams('MiniCPM-V-4.7-1B', imageMessages, {
      ...DEFAULT_PARAMS,
      imageDownsampleMode: mode,
    });
    expect(p.mm_processor_kwargs).toEqual({ downsample_mode: mode });
    expect(p).not.toHaveProperty('extra_body');
  });

  it('思考参数由后端注入时仍发送用户选择的图片压缩比例', () => {
    const p = buildChatParams('MiniCPM-V-4.7-1B', imageMessages, {
      ...DEFAULT_PARAMS,
      includeThinkingParams: false,
      imageDownsampleMode: '16x',
    });
    expect(p.mm_processor_kwargs).toEqual({ downsample_mode: '16x' });
    expect(p).not.toHaveProperty('chat_template_kwargs');
  });

  it('纯文本消息即使选择图片压缩比例也不下发视觉参数', () => {
    const p = buildChatParams('MiniCPM-V-4.7-1B', messages, {
      ...DEFAULT_PARAMS,
      imageDownsampleMode: '4x',
    });
    expect(p).not.toHaveProperty('mm_processor_kwargs');
  });

  it('清空图片压缩比例后不下发视觉参数', () => {
    const p = buildChatParams('MiniCPM-V-4.7-1B', messages, {
      ...DEFAULT_PARAMS,
      imageDownsampleMode: undefined,
    });
    expect(p).not.toHaveProperty('mm_processor_kwargs');
  });

  it('非 v4.7 模型不发送残留的图片压缩偏好', () => {
    const p = buildChatParams('text-model', messages, {
      ...DEFAULT_PARAMS,
      imageDownsampleMode: '4x',
    });
    expect(p).not.toHaveProperty('mm_processor_kwargs');
  });

  it('异常持久化值不会作为图片压缩模式发送', () => {
    const params = JSON.parse(JSON.stringify({ ...DEFAULT_PARAMS, imageDownsampleMode: '8x' }));
    const p = buildChatParams('MiniCPM-V-4.7-1B', messages, params);
    expect(p).not.toHaveProperty('mm_processor_kwargs');
  });
});
