import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ImageParseTaskBar } from './ImageParseTaskBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { field?: string }) =>
      options?.field ? `${key}:${options.field}` : key,
  }),
}));

const available = {
  enabled: true,
  modes: ['standard'],
  seal: true,
  kie: true,
  upright: true,
};

describe('图像解析任务栏', () => {
  it('能力未开放时不占用工作台空间', () => {
    const { container } = render(
      <ImageParseTaskBar
        mode="scored"
        capabilities={{ ...available, enabled: false, seal: false, kie: false }}
        onModeChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('只展示文档识别与信息抽取任务', async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    const { rerender } = render(
      <ImageParseTaskBar mode="scored" capabilities={available} onModeChange={onModeChange} />,
    );
    expect(screen.getByRole('tab', { name: 'imageParseTaskDocument' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'imageParseTaskKie' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    await user.click(screen.getByRole('tab', { name: 'imageParseTaskKie' }));
    expect(onModeChange).toHaveBeenLastCalledWith('kie');

    rerender(<ImageParseTaskBar mode="kie" capabilities={available} onModeChange={onModeChange} />);
    expect(screen.getByRole('tab', { name: 'imageParseTaskKie' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(screen.getByRole('tab', { name: 'imageParseTaskDocument' }));
    expect(onModeChange).toHaveBeenLastCalledWith('standard');
  });

  it('上传前就能选择字段提取，不要求先执行全文识别', async () => {
    const onModeChange = vi.fn();
    render(
      <ImageParseTaskBar
        mode="scored"
        capabilities={available}
        onModeChange={onModeChange}
        hasDocument={false}
      />,
    );
    const kie = screen.getByRole('tab', { name: 'imageParseTaskKie' });
    expect(kie).toBeEnabled();
    await userEvent.click(kie);
    expect(onModeChange).toHaveBeenCalledWith('kie');
  });

  it('PDF 支持字段提取入口，不再显示不支持提示', () => {
    render(<ImageParseTaskBar mode="kie" capabilities={available} onModeChange={vi.fn()} isPdf />);
    expect(screen.getByRole('tab', { name: 'imageParseTaskDocument' })).toBeEnabled();
    expect(screen.getByRole('tab', { name: 'imageParseTaskKie' })).toBeEnabled();
    expect(screen.queryByText('imageParsePipelinePdfUnsupported')).not.toBeInTheDocument();
  });

  it('任务栏只负责切换任务，不再重复字段摘要和结果操作', () => {
    render(<ImageParseTaskBar mode="kie" capabilities={available} onModeChange={vi.fn()} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.queryByText(/imageParseKieFields/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
