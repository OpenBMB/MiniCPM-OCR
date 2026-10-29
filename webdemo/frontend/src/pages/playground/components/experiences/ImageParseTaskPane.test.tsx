import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ImageParseTaskPane } from './ImageParseTaskPane';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./ImageParseResultPane', () => ({
  ImageParseResultPane: () => <div>saved-result</div>,
}));

type PaneProps = ComponentProps<typeof ImageParseTaskPane>;
function props(): PaneProps {
  return {
    parse: {
      mode: 'kie',
      fields: ['原字段'],
      loading: false,
      canParse: true,
      documentKey: 'document:kie',
      parse: vi.fn(),
    } as unknown as PaneProps['parse'],
    unsupported: false,
    awaitingStart: false,
    showKieSetup: true,
    uploading: false,
    hasKieResult: true,
    fieldDraftKey: 'scope:document',
    onSetupClose: vi.fn(),
    onDocumentMode: vi.fn(),
    onReplace: vi.fn(),
    resultProps: {} as PaneProps['resultProps'],
  };
}

describe('字段配置提交与返回', () => {
  it('修改只是草稿，返回结果后再次打开仍是原来的已提交字段', async () => {
    const user = userEvent.setup();
    const original = props();
    const { rerender } = render(<ImageParseTaskPane {...original} />);
    await user.click(screen.getByRole('button', { name: 'imageParseKieAddField' }));
    await user.type(screen.getByLabelText('imageParseKieFieldInputLabel'), '新字段{Enter}');
    expect(screen.getByText('新字段')).toBeInTheDocument();
    expect(original.parse.fields).toEqual(['原字段']);
    expect(original.parse.parse).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'imageParseKieBackToResult' }));
    expect(original.onSetupClose).toHaveBeenCalledOnce();
    rerender(<ImageParseTaskPane {...original} showKieSetup={false} />);
    expect(screen.getByText('saved-result')).toBeInTheDocument();
    rerender(<ImageParseTaskPane {...original} />);
    expect(screen.getByText('原字段')).toBeInTheDocument();
    expect(screen.queryByText('新字段')).not.toBeInTheDocument();
  });

  it('开始提取提交当前草稿，不使用原结果字段', async () => {
    const user = userEvent.setup();
    const original = props();
    render(<ImageParseTaskPane {...original} />);
    await user.click(screen.getByRole('button', { name: 'imageParseKieAddField' }));
    await user.type(screen.getByLabelText('imageParseKieFieldInputLabel'), '新字段{Enter}');
    await user.click(screen.getByRole('button', { name: 'imageParseStartKie' }));
    expect(original.parse.parse).toHaveBeenCalledExactlyOnceWith({
      fields: ['原字段', '新字段'],
    });
    expect(original.onSetupClose).toHaveBeenCalledOnce();
  });

  it('直接开始抽取包含尚未点击加号的输入，不需要额外确认', async () => {
    const user = userEvent.setup();
    const original = props();
    original.parse.fields = [];
    render(<ImageParseTaskPane {...original} />);
    await user.click(screen.getByRole('button', { name: 'imageParseKieAddField' }));
    await user.type(screen.getByLabelText('imageParseKieFieldInputLabel'), '姓名，电话');
    await user.click(screen.getByRole('button', { name: 'imageParseStartKie' }));
    expect(original.parse.parse).toHaveBeenCalledExactlyOnceWith({ fields: ['姓名', '电话'] });
  });

  it('尚未加入的重复输入禁用开始，防止忽略无效草稿后提交旧字段', async () => {
    const user = userEvent.setup();
    const original = props();
    render(<ImageParseTaskPane {...original} />);
    await user.click(screen.getByRole('button', { name: 'imageParseKieAddField' }));
    await user.type(screen.getByLabelText('imageParseKieFieldInputLabel'), '原字段');
    expect(screen.getByRole('button', { name: 'imageParseStartKie' })).toBeDisabled();
    expect(original.parse.parse).not.toHaveBeenCalled();
  });

  it('切换文件清空未加入的输入草稿，避免新文件提交上一个文件字段', async () => {
    const user = userEvent.setup();
    const original = props();
    const { rerender } = render(<ImageParseTaskPane {...original} />);
    await user.click(screen.getByRole('button', { name: 'imageParseKieAddField' }));
    await user.type(screen.getByLabelText('imageParseKieFieldInputLabel'), '上一文件的草稿');
    rerender(<ImageParseTaskPane {...original} fieldDraftKey="scope:next-document" />);
    await user.click(screen.getByRole('button', { name: 'imageParseKieAddField' }));
    expect(screen.getByLabelText('imageParseKieFieldInputLabel')).toHaveValue('');
  });
});
