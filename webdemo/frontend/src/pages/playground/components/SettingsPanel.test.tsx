import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PARAMS } from '../types';
import { SettingsPanel } from './SettingsPanel';

describe('SettingsPanel', () => {
  it('未支持深度思考时隐藏思考参数风格设置', () => {
    render(
      <SettingsPanel
        open
        modelId="text-model"
        showReasoning={false}
        onOpenChange={vi.fn()}
        params={DEFAULT_PARAMS}
        onUpdate={vi.fn()}
        onStreamChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.queryByRole('combobox', { name: 'thinkingStyle' })).not.toBeInTheDocument();
  });

  it('未设置数值参数时显示空输入框', () => {
    render(
      <SettingsPanel
        open
        modelId="text-model"
        onOpenChange={vi.fn()}
        params={{
          ...DEFAULT_PARAMS,
          temperature: undefined,
          topP: undefined,
          maxTokens: undefined,
        }}
        onUpdate={vi.fn()}
        onStreamChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('temperature')).toHaveValue(null);
    expect(screen.getByLabelText('topP')).toHaveValue(null);
    expect(screen.getByLabelText('maxTokens')).toHaveValue(null);
  });

  it('清空数字输入时写入 undefined，而不是数字 0', () => {
    const onUpdate = vi.fn();
    render(
      <SettingsPanel
        open
        modelId="text-model"
        onOpenChange={vi.fn()}
        params={{ ...DEFAULT_PARAMS, temperature: 0.7 }}
        onUpdate={onUpdate}
        onStreamChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('temperature'), { target: { value: '' } });

    expect(onUpdate).toHaveBeenLastCalledWith({ temperature: undefined });
  });

  it('v4.7 模型初始图片压缩比例为空，不自动写入偏好', () => {
    const onUpdate = vi.fn();
    render(
      <SettingsPanel
        open
        modelId="MiniCPM-V-4.7-1B"
        onOpenChange={vi.fn()}
        params={DEFAULT_PARAMS}
        onUpdate={onUpdate}
        onStreamChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    const field = screen.getByRole('combobox', { name: 'imageDownsampleMode' });
    expect(field).toHaveAttribute('data-placeholder');
    expect(field).toHaveTextContent('imageDownsampleUnset');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('切换到非 v4.7 模型时隐藏图片压缩控件', () => {
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      params: DEFAULT_PARAMS,
      onUpdate: vi.fn(),
      onStreamChange: vi.fn(),
      onReset: vi.fn(),
    };
    const { rerender } = render(<SettingsPanel {...props} modelId="MiniCPM-V-4.7-35B-A3B" />);
    expect(screen.getByRole('combobox', { name: 'imageDownsampleMode' })).toBeInTheDocument();

    rerender(<SettingsPanel {...props} modelId="MiniCPM-V-4.70" />);
    expect(screen.queryByRole('combobox', { name: 'imageDownsampleMode' })).not.toBeInTheDocument();
  });

  it('已选比例回显，恢复默认仍调用当前模型的重置操作', () => {
    const onReset = vi.fn();
    render(
      <SettingsPanel
        open
        modelId="MiniCPM-V-4.7-1B"
        onOpenChange={vi.fn()}
        params={{ ...DEFAULT_PARAMS, imageDownsampleMode: '16x' }}
        onUpdate={vi.fn()}
        onStreamChange={vi.fn()}
        onReset={onReset}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'imageDownsampleMode' })).toHaveTextContent('16x');
    fireEvent.click(screen.getByRole('button', { name: 'restoreDefaults' }));
    expect(onReset).toHaveBeenCalledOnce();
  });
});
