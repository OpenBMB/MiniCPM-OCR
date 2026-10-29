import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ImageParseKieSetupPane } from './ImageParseKieSetupPane';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { field?: string; count?: number }) => {
      if (options?.field) return `${key}:${options.field}`;
      if (options?.count !== undefined) return `${key}:${options.count}`;
      return key;
    },
  }),
}));

async function openFieldInput() {
  await userEvent.click(screen.getByRole('button', { name: 'imageParseKieAddField' }));
}

describe('图像解析字段配置面板', () => {
  it('字段配置使用与文档解析结果一致的白色表面', () => {
    const { container } = render(
      <ImageParseKieSetupPane fields={[]} onChange={vi.fn()} onStart={vi.fn()} canStart={false} />,
    );
    expect(container.firstElementChild).toHaveClass('bg-card');
    expect(container.querySelector('footer')).toHaveClass('bg-card');
    expect(
      screen.getByRole('heading', { name: 'imageParseKieSetupTitle' }).closest('header'),
    ).toHaveClass('bg-card');
  });

  it('移除模板入口，添加字段位于列表下方而不是工具栏', async () => {
    render(
      <ImageParseKieSetupPane
        fields={['发票号码']}
        onChange={vi.fn()}
        onStart={vi.fn()}
        canStart
      />,
    );
    const add = screen.getByRole('button', { name: 'imageParseKieAddField' });
    const list = screen.getByRole('list', { name: 'imageParseKieAddedFields' });
    expect(
      screen.queryByRole('button', { name: 'imageParseKieTemplates' }),
    ).not.toBeInTheDocument();
    expect(add.closest('header')).toBeNull();
    expect(list.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(add);
    expect(
      list.compareDocumentPosition(screen.getByLabelText('imageParseKieFieldInputLabel')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText('imageParseKieSetupQuestion')).not.toBeInTheDocument();
    expect(screen.queryByText('imageParseKieFieldsTitle')).not.toBeInTheDocument();
  });

  it('勾选字段后批量删除必须二次确认，取消保留字段和选中状态', async () => {
    const onChange = vi.fn();
    const onStart = vi.fn();
    render(
      <ImageParseKieSetupPane
        fields={['发票号码', '日期', '金额']}
        onChange={onChange}
        onStart={onStart}
        canStart
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'imageParseKieBatchDelete' }));
    const remove = screen.getByRole('button', { name: 'imageParseKieDeleteSelected:0' });
    expect(remove).toBeDisabled();
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'imageParseKieSelectField:发票号码' }),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'imageParseKieSelectField:金额' }));
    await userEvent.click(screen.getByRole('button', { name: 'imageParseKieDeleteSelected:2' }));
    const dialog = screen.getByRole('dialog', { name: 'imageParseKieDeleteFieldsTitle' });
    expect(dialog).toHaveTextContent('imageParseKieDeleteFieldsDescription:2');
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'imageParseKieCancelDelete' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'imageParseKieSelectField:金额' })).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'imageParseKieDeleteSelected:2' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'imageParseKieConfirmDelete',
      }),
    );
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['日期']);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('全选和取消全选支持键盘操作，退出批量模式不删除字段', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ImageParseKieSetupPane
        fields={['日期', '金额']}
        onChange={onChange}
        onStart={vi.fn()}
        canStart
      />,
    );
    await user.click(screen.getByRole('button', { name: 'imageParseKieBatchDelete' }));
    const selectAll = screen.getByRole('checkbox', { name: 'imageParseKieSelectAll' });
    selectAll.focus();
    await user.keyboard(' ');
    expect(
      screen.getAllByRole('checkbox').every((checkbox) => (checkbox as HTMLInputElement).checked),
    ).toBe(true);
    await user.keyboard(' ');
    expect(
      screen.getAllByRole('checkbox').some((checkbox) => (checkbox as HTMLInputElement).checked),
    ).toBe(false);
    await user.click(screen.getByRole('button', { name: 'imageParseKieCancelSelection' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('空字段或处理中禁用批量删除，处理中禁用单项删除', () => {
    const { rerender } = render(
      <ImageParseKieSetupPane fields={[]} onChange={vi.fn()} onStart={vi.fn()} canStart={false} />,
    );
    expect(screen.getByRole('button', { name: 'imageParseKieBatchDelete' })).toBeDisabled();
    rerender(
      <ImageParseKieSetupPane
        fields={['日期']}
        onChange={vi.fn()}
        onStart={vi.fn()}
        canStart
        disabled
      />,
    );
    expect(screen.getByRole('button', { name: 'imageParseKieBatchDelete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'imageParseKieRemoveField:日期' })).toBeDisabled();
  });

  it('全选删除确认后清空字段并恢复新增入口', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ImageParseKieSetupPane
        fields={['日期', '金额']}
        onChange={onChange}
        onStart={vi.fn()}
        canStart
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'imageParseKieBatchDelete' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'imageParseKieSelectAll' }));
    await userEvent.click(screen.getByRole('button', { name: 'imageParseKieDeleteSelected:2' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'imageParseKieConfirmDelete',
      }),
    );
    expect(onChange).toHaveBeenCalledExactlyOnceWith([]);
    rerender(
      <ImageParseKieSetupPane fields={[]} onChange={onChange} onStart={vi.fn()} canStart={false} />,
    );
    expect(screen.getByRole('button', { name: 'imageParseStartKie' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'imageParseKieAddField' })).toBeEnabled();
  });

  it('确认弹窗支持 Esc 取消且不会误删', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ImageParseKieSetupPane fields={['日期']} onChange={onChange} onStart={vi.fn()} canStart />,
    );
    await user.click(screen.getByRole('button', { name: 'imageParseKieBatchDelete' }));
    await user.click(screen.getByRole('checkbox', { name: 'imageParseKieSelectAll' }));
    await user.click(screen.getByRole('button', { name: 'imageParseKieDeleteSelected:1' }));
    expect(screen.getByRole('button', { name: 'imageParseKieCancelDelete' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('列表下方加号打开字段输入，再次点击可收起', async () => {
    render(
      <ImageParseKieSetupPane fields={[]} onChange={vi.fn()} onStart={vi.fn()} canStart={false} />,
    );
    await openFieldInput();
    expect(screen.getByLabelText('imageParseKieFieldInputLabel')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'imageParseKieHideFieldInput' }));
    expect(screen.queryByLabelText('imageParseKieFieldInputLabel')).not.toBeInTheDocument();
  });

  it('字段输入支持 Esc 收起', async () => {
    const user = userEvent.setup();
    render(
      <ImageParseKieSetupPane fields={[]} onChange={vi.fn()} onStart={vi.fn()} canStart={false} />,
    );
    await openFieldInput();
    const input = screen.getByLabelText('imageParseKieFieldInputLabel');
    input.focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('imageParseKieFieldInputLabel')).not.toBeInTheDocument();
  });

  it('逗号分隔的字段一次加入并保留输入顺序', async () => {
    const onChange = vi.fn();
    render(
      <ImageParseKieSetupPane fields={[]} onChange={onChange} onStart={vi.fn()} canStart={false} />,
    );
    await openFieldInput();
    await userEvent.type(
      screen.getByLabelText('imageParseKieFieldInputLabel'),
      '姓名，电话、邮箱{Enter}',
    );
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['姓名', '电话', '邮箱']);
  });

  it('粘贴多行字段直接加入，重复字段整批拒绝且保留输入', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ImageParseKieSetupPane fields={['姓名']} onChange={onChange} onStart={vi.fn()} canStart />,
    );
    await openFieldInput();
    const input = screen.getByLabelText('imageParseKieFieldInputLabel');
    await user.click(input);
    await user.paste('电话\n邮箱');
    expect(onChange).toHaveBeenLastCalledWith(['姓名', '电话', '邮箱']);

    onChange.mockClear();
    const nextInput = screen.getByLabelText('imageParseKieFieldInputLabel');
    await user.click(nextInput);
    await user.paste('姓名\n地址');
    expect(onChange).not.toHaveBeenCalled();
    expect(nextInput).toHaveValue('姓名\n地址');
    expect(screen.getByRole('alert')).toHaveTextContent('imageParseKieFieldsDuplicate');
  });

  it('中文输入法确认文字的回车不提交字段', async () => {
    const onChange = vi.fn();
    render(
      <ImageParseKieSetupPane fields={[]} onChange={onChange} onStart={vi.fn()} canStart={false} />,
    );
    await openFieldInput();
    const input = screen.getByLabelText('imageParseKieFieldInputLabel');
    fireEvent.change(input, { target: { value: '姓名' } });
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('达到字段上限后禁用新增入口', () => {
    render(
      <ImageParseKieSetupPane
        fields={Array.from({ length: 20 }, (_, index) => `字段${index}`)}
        onChange={vi.fn()}
        onStart={vi.fn()}
        canStart
      />,
    );
    expect(screen.getByRole('button', { name: 'imageParseKieAddField' })).toBeDisabled();
    expect(screen.queryByLabelText('imageParseKieFieldInputLabel')).not.toBeInTheDocument();
  });

  it('批量加入超限时保留草稿与原字段，不静默截断', async () => {
    const onChange = vi.fn();
    render(
      <ImageParseKieSetupPane
        fields={Array.from({ length: 19 }, (_, index) => `字段${index}`)}
        onChange={onChange}
        onStart={vi.fn()}
        canStart
      />,
    );
    await openFieldInput();
    const input = screen.getByLabelText('imageParseKieFieldInputLabel');
    await userEvent.type(input, '姓名，电话{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('姓名，电话');
    expect(screen.getByRole('alert')).toHaveTextContent('imageParseKieFieldsTooMany');
  });

  it('字段数量只在工具栏显示', () => {
    render(
      <ImageParseKieSetupPane
        fields={['发票号码', '开票日期']}
        onChange={vi.fn()}
        onStart={vi.fn()}
        canStart
      />,
    );
    expect(screen.getAllByText('2 / 20')).toHaveLength(1);
    expect(screen.getByRole('list', { name: 'imageParseKieAddedFields' })).toBeInTheDocument();
    expect(screen.queryByText('imageParseKieSetupDescription')).not.toBeInTheDocument();
    expect(screen.queryByText('imageParseKieSetupStartHint')).not.toBeInTheDocument();
  });

  it('空字段时禁用开始抽取并说明原因', () => {
    render(
      <ImageParseKieSetupPane
        fields={[]}
        onChange={vi.fn()}
        onStart={vi.fn()}
        canStart={false}
        blockedReason="imageParseKieFieldsRequired"
      />,
    );

    expect(screen.getByRole('heading', { name: 'imageParseKieSetupTitle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'imageParseStartKie' })).toBeDisabled();
    expect(screen.getByText('imageParseKieFieldsRequired')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'imageParseKieBackToResult' }),
    ).not.toBeInTheDocument();
  });

  it('支持添加字段并在提交时回传完整列表', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <ImageParseKieSetupPane fields={[]} onChange={onChange} onStart={vi.fn()} canStart={false} />,
    );

    await openFieldInput();
    await user.type(screen.getByLabelText('imageParseKieFieldInputLabel'), '发票号码{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['发票号码']);

    rerender(
      <ImageParseKieSetupPane
        fields={['发票号码']}
        onChange={onChange}
        onStart={vi.fn()}
        canStart
      />,
    );
    expect(screen.getByText('发票号码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'imageParseStartKie' })).toBeEnabled();
  });

  it('拒绝重复字段并提示具体原因', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ImageParseKieSetupPane
        fields={['发票号码']}
        onChange={onChange}
        onStart={vi.fn()}
        canStart
      />,
    );

    await openFieldInput();
    await user.type(screen.getByLabelText('imageParseKieFieldInputLabel'), '发票号码{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('imageParseKieFieldsDuplicate');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('支持移除字段、开始抽取与返回结果', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onStart = vi.fn();
    const onBack = vi.fn();
    render(
      <ImageParseKieSetupPane
        fields={['发票号码', '开票日期']}
        onChange={onChange}
        onStart={onStart}
        onBack={onBack}
        canStart
      />,
    );

    await user.click(screen.getByRole('button', { name: 'imageParseKieRemoveField:发票号码' }));
    expect(onChange).toHaveBeenLastCalledWith(['开票日期']);

    await user.click(screen.getByRole('button', { name: 'imageParseStartKie' }));
    expect(onStart).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'imageParseKieBackToResult' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
