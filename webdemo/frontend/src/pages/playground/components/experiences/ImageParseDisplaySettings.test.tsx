import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@map/store';

import { ImageParseDisplaySettings } from './ImageParseDisplaySettings';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('原文显示设置', () => {
  beforeEach(() => {
    useAppStore.getState().setPlaygroundPrefs({
      imageParseHideHeaderFooter: false,
      imageParseShowOrder: false,
    });
  });

  it('收拢识别框、阅读顺序、页眉页脚与双栏联动', async () => {
    render(
      <ImageParseDisplaySettings
        showBlocks
        hasBlocks
        onToggleBlocks={vi.fn()}
        linked
        onToggleLinked={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'imageParseDisplaySettings' }));
    expect(screen.getAllByRole('menuitemcheckbox')).toHaveLength(4);
    for (const name of [
      'imageParseShowConfidence',
      'imageParseShowOrder',
      'imageParseHideHeaderFooter',
      'imageParseLinked',
    ]) {
      expect(screen.getByRole('menuitemcheckbox', { name })).toBeInTheDocument();
    }
  });

  it('展开后支持切识别框、页眉页脚和双栏联动', async () => {
    const onToggleBlocks = vi.fn();
    const onToggleLinked = vi.fn();
    render(
      <ImageParseDisplaySettings
        showBlocks
        hasBlocks
        onToggleBlocks={onToggleBlocks}
        linked
        onToggleLinked={onToggleLinked}
      />,
    );
    expect(screen.queryByRole('menuitemcheckbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'imageParseDisplaySettings' }));
    await userEvent.click(
      screen.getByRole('menuitemcheckbox', { name: 'imageParseShowConfidence' }),
    );
    await userEvent.click(
      screen.getByRole('menuitemcheckbox', { name: 'imageParseHideHeaderFooter' }),
    );
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'imageParseLinked' }));
    expect(onToggleBlocks).toHaveBeenCalledOnce();
    expect(onToggleLinked).toHaveBeenCalledOnce();
    expect(useAppStore.getState().playground.imageParseHideHeaderFooter).toBe(true);
  });

  it('未传联动状态时默认选中双栏联动', async () => {
    render(
      <ImageParseDisplaySettings
        showBlocks
        hasBlocks
        onToggleBlocks={vi.fn()}
        onToggleLinked={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'imageParseDisplaySettings' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'imageParseLinked' })).toBeChecked();
  });
});
