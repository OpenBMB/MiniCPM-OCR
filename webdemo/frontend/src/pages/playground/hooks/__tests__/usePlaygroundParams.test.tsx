import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '@map/store';
import { usePlaygroundParams } from '../usePlaygroundParams';
import { buildChatParams } from '../../utils/params';

const REASONING_CAPABILITIES = { deep_thinking: true };
const REASONING_DEFAULT_OFF = { deep_thinking: true, show_reasoning: false };

beforeEach(() => {
  useAppStore.setState((state) => ({
    playground: {
      ...state.playground,
      paramsByModel: {},
    },
  }));
});

describe('usePlaygroundParams', () => {
  it('模型未开启联网能力时忽略历史开启状态', () => {
    useAppStore.getState().setModelParams('model-a', { webSearch: true });

    const { result } = renderHook(() => usePlaygroundParams('model-a'));

    expect(result.current.params.webSearch).toBe(false);
  });

  it('模型开启联网能力时保留用户状态', () => {
    useAppStore.getState().setModelParams('model-a', { webSearch: true });

    const { result } = renderHook(() =>
      usePlaygroundParams('model-a', REASONING_CAPABILITIES, undefined, true),
    );

    expect(result.current.params.webSearch).toBe(true);
  });

  it('模型不支持联网时强制关闭历史开启状态', () => {
    useAppStore.getState().setModelParams('model-a', { webSearch: true });

    const { result } = renderHook(() =>
      usePlaygroundParams('model-a', REASONING_CAPABILITIES, {}, false),
    );

    expect(result.current.params.webSearch).toBe(false);
  });

  it('MiniCPM-OCR-Jev 默认关闭流式但保留用户开关状态', () => {
    const { result } = renderHook(() =>
      usePlaygroundParams('MiniCPM-OCR-Jev', REASONING_CAPABILITIES, { stream: true }),
    );

    expect(result.current.params.stream).toBe(false);

    act(() => result.current.setStream(true));

    expect(result.current.params.stream).toBe(true);
  });

  it('模型未配置默认值时数值参数保持未设置', () => {
    const { result } = renderHook(() => usePlaygroundParams('model-a', REASONING_CAPABILITIES, {}));

    expect(result.current.params.temperature).toBeUndefined();
    expect(result.current.params.topP).toBeUndefined();
    expect(result.current.params.maxTokens).toBeUndefined();
  });

  it('使用模型配置作为未设置字段的默认值', () => {
    const { result } = renderHook(() =>
      usePlaygroundParams('model-a', REASONING_CAPABILITIES, {
        temperature: 0.6,
        top_p: 0.8,
        max_tokens: 0,
        stream: false,
      }),
    );

    expect(result.current.params.temperature).toBe(0.6);
    expect(result.current.params.topP).toBe(0.8);
    expect(result.current.params.maxTokens).toBe(0);
    expect(result.current.params.stream).toBe(false);
  });

  it('max_completion_tokens 保持由 L2 按原字段名注入', () => {
    const { result } = renderHook(() =>
      usePlaygroundParams('model-a', REASONING_CAPABILITIES, {
        max_completion_tokens: 2048,
      }),
    );

    expect(result.current.params.maxTokens).toBeUndefined();
  });

  it('默认关闭与模型配置一致时未操作的参数由 L2 原样注入', () => {
    const { result } = renderHook(() =>
      usePlaygroundParams('model-a', REASONING_DEFAULT_OFF, {
        chat_template_kwargs: { enable_thinking: false },
        reasoning_effort: 'high',
      }),
    );

    expect(result.current.params.thinkingDepth).toBe('off');
    expect(result.current.params.thinkingStyle).toBe('both');
    expect(result.current.params.includeThinkingParams).toBe(false);
  });

  it('模型 thinking 配置未被用户修改时也由 L2 原样注入', () => {
    const { result } = renderHook(() =>
      usePlaygroundParams('model-a', REASONING_DEFAULT_OFF, {
        thinking: { type: 'disabled' },
      }),
    );

    expect(result.current.params.thinkingDepth).toBe('off');
    expect(result.current.params.thinkingStyle).toBe('thinking');
    expect(result.current.params.includeThinkingParams).toBe(false);
    expect(result.current.params.thinkingControlFormat).toBe('thinking');
  });

  it('用户修改思考开关后显式发送用户设置', () => {
    const { result } = renderHook(() =>
      usePlaygroundParams('model-a', REASONING_CAPABILITIES, {
        reasoning_effort: 'high',
      }),
    );

    act(() => result.current.setThinkingDepth('off'));

    expect(result.current.params.thinkingDepth).toBe('off');
    expect(result.current.params.includeThinkingParams).toBe(true);
  });

  it('用户显式设置的 0 优先于模型默认值', () => {
    useAppStore.getState().setModelParams('model-a', { temperature: 0 });

    const { result } = renderHook(() =>
      usePlaygroundParams('model-a', REASONING_CAPABILITIES, { temperature: 0.7 }),
    );

    expect(result.current.params.temperature).toBe(0);
  });

  it('修改其他设置时不会把模型默认值固化为用户设置', () => {
    const { result } = renderHook(() =>
      usePlaygroundParams('model-a', REASONING_CAPABILITIES, { temperature: 0.7 }),
    );

    act(() => result.current.update({ stream: false }));

    expect(useAppStore.getState().playground.paramsByModel['model-a']?.temperature).toBeUndefined();
    expect(useAppStore.getState().playground.paramsByModel['model-a']?.stream).toBe(false);
  });

  it('恢复默认时删除当前模型的全部用户覆盖', () => {
    useAppStore.getState().setModelParams('model-a', {
      temperature: 1.2,
      topP: 0.5,
      maxTokens: 1024,
      stream: false,
    });
    const { result } = renderHook(() => usePlaygroundParams('model-a', REASONING_CAPABILITIES, {}));

    act(() => result.current.reset());

    expect(useAppStore.getState().playground.paramsByModel['model-a']).toBeUndefined();
    expect(result.current.params.temperature).toBeUndefined();
    expect(result.current.params.topP).toBeUndefined();
    expect(result.current.params.maxTokens).toBeUndefined();
    expect(result.current.params.stream).toBe(true);
  });

  it('后台配置压缩默认值时仍保持未选择，由 L2 注入默认值', () => {
    const model = 'MiniCPM-V-4.7-1B';
    const { result, rerender } = renderHook(
      ({ mode }) =>
        usePlaygroundParams(model, REASONING_CAPABILITIES, {
          mm_processor_kwargs: { downsample_mode: mode, max_slice_nums: 9 },
        }),
      { initialProps: { mode: '16x' } },
    );

    expect(result.current.params.imageDownsampleMode).toBeUndefined();
    expect(buildChatParams(model, [], result.current.params)).not.toHaveProperty(
      'mm_processor_kwargs',
    );

    act(() => result.current.update({ stream: false }));
    expect(
      useAppStore.getState().playground.paramsByModel[model]?.imageDownsampleMode,
    ).toBeUndefined();

    rerender({ mode: '4x' });
    expect(result.current.params.imageDownsampleMode).toBeUndefined();
  });

  it('图片压缩偏好按模型分别保存，清空与恢复默认后不再发送', () => {
    const first = 'MiniCPM-V-4.7-1B';
    const second = 'MiniCPM-V-4.7-35B-A3B';
    const imageMessages = [
      {
        role: 'user' as const,
        content: [
          { type: 'image_url' as const, image_url: { url: 'https://example.com/image.png' } },
        ],
      },
    ];
    const { result, rerender } = renderHook(({ model }) => usePlaygroundParams(model), {
      initialProps: { model: first },
    });

    act(() => result.current.update({ imageDownsampleMode: '4x' }));
    expect(
      buildChatParams(first, imageMessages, result.current.params).mm_processor_kwargs,
    ).toEqual({
      downsample_mode: '4x',
    });

    rerender({ model: second });
    expect(result.current.params.imageDownsampleMode).toBeUndefined();
    act(() => result.current.update({ imageDownsampleMode: '16x' }));

    rerender({ model: first });
    expect(result.current.params.imageDownsampleMode).toBe('4x');
    act(() => result.current.update({ imageDownsampleMode: undefined }));
    expect(buildChatParams(first, [], result.current.params)).not.toHaveProperty(
      'mm_processor_kwargs',
    );

    rerender({ model: second });
    expect(result.current.params.imageDownsampleMode).toBe('16x');
    act(() => result.current.reset());
    expect(result.current.params.imageDownsampleMode).toBeUndefined();
    expect(useAppStore.getState().playground.paramsByModel[second]).toBeUndefined();
  });
});
