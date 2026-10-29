import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchSelect, type SearchSelectOption } from '../index';

const options = [
  { value: 'user-a', label: '张学仁', description: 'first@example.test' },
  { value: 'user-b', label: '张学仁', description: 'second@example.test' },
  { value: 'user-c', label: '其他用户' },
];

/** Controlled test entry: distinguishes the typed keyword from the selected item saved by identity. */
function Field({ multiple = true, maxSelected }: { multiple?: boolean; maxSelected?: number }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SearchSelectOption[]>([]);
  return (
    <>
      <SearchSelect
        options={options}
        search={search}
        onSearchChange={setSearch}
        selectedOptions={selected}
        onSelectionChange={(next) => {
          setSelected(next);
          if (!multiple) setSearch(next[0]?.label ?? '');
        }}
        multiple={multiple}
        maxSelected={maxSelected}
        placeholder="按用户搜索"
        clearLabel="清除"
        removeLabel={(option) => `移除 ${option.label}`}
      />
      <output aria-label="已选身份">{selected.map((option) => option.value).join(',')}</output>
      <button type="button">外部操作</button>
    </>
  );
}

describe('SearchSelect', () => {
  it('should bound selection count while allowing an existing selection to be removed', async () => {
    const user = userEvent.setup();
    render(<Field maxSelected={1} />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getAllByRole('option')[0]);
    expect(screen.getByRole('option', { name: '其他用户' })).toBeDisabled();
    await user.click(screen.getAllByRole('option')[0]);
    expect(screen.getByLabelText('已选身份')).toBeEmptyDOMElement();
    expect(screen.getByRole('option', { name: '其他用户' })).toBeEnabled();
  });

  it('should not select a candidate when Enter confirms IME composition', async () => {
    const user = userEvent.setup();
    render(<Field />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(screen.getByLabelText('已选身份')).toBeEmptyDOMElement();
  });

  it('should keep multi-selection open, distinguish duplicate names and reset only the search', async () => {
    const user = userEvent.setup();
    render(<Field />);
    const input = screen.getByRole('combobox', { name: '按用户搜索' });
    await user.type(input, '张');
    await user.click(screen.getAllByRole('option', { name: '张学仁' })[0]);
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
    await user.click(screen.getAllByRole('option', { name: '张学仁' })[1]);
    expect(screen.getByLabelText('已选身份')).toHaveTextContent('user-a,user-b');
    expect(screen.getAllByRole('option', { selected: true })).toHaveLength(2);
  });

  it('should reopen a single selection and show all candidates', async () => {
    const user = userEvent.setup();
    render(<Field multiple={false} />);
    const input = screen.getByRole('combobox', { name: '按用户搜索' });
    await user.click(input);
    await user.click(screen.getAllByRole('option', { name: '张学仁' })[0]);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    await user.click(input);
    expect(screen.getByRole('option', { name: '其他用户' })).toBeVisible();
  });

  it('should remove one selection without clearing the others', async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getAllByRole('option')[0]);
    await user.click(screen.getAllByRole('option')[1]);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: '外部操作' }));
    await user.click(screen.getAllByRole('button', { name: '移除 张学仁' })[0]);
    expect(screen.getByLabelText('已选身份')).toHaveTextContent('user-b');
    expect(screen.getByLabelText('已选身份')).not.toHaveTextContent('user-a');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('should support arrow navigation, selection, Escape, re-opening and keyboard clear', async () => {
    const user = userEvent.setup();
    render(<Field />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByLabelText('已选身份')).toHaveTextContent('user-a');
    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await user.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    screen.getByRole('button', { name: '清除' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('已选身份')).toBeEmptyDOMElement();
  });

  it('should dismiss on outside click without losing selections', async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getAllByRole('option')[0]);
    await user.click(screen.getByRole('button', { name: '外部操作' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('已选身份')).toHaveTextContent('user-a');
  });

  it('should reach clear with Tab and activate it without submitting the parent form', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field />
      </form>,
    );
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown}{Enter}{Tab}');
    expect(screen.getByRole('button', { name: '清除' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('已选身份')).toBeEmptyDOMElement();
    expect(screen.getByRole('combobox')).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
  });
});
