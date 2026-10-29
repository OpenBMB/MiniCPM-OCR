import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ImageParseResultPane } from './ImageParseResultPane';
import type { useImageParse } from '../../hooks/useImageParse';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { found?: number; total?: number }) =>
      key === 'imageParseKieResultCount' ? `${key}:${options?.found}/${options?.total}` : key,
  }),
}));
const mocks = vi.hoisted(() => ({ copy: vi.fn().mockResolvedValue(true) }));
vi.mock('../../utils/copyText', () => ({ copyText: mocks.copy }));

const parse = {
  resultKey: 'kie-a',
  markdown: '{"1024":"1024"}',
  loading: false,
  layout: [],
  crops: [],
  mode: 'kie',
  fields: ['1024'],
} as unknown as ReturnType<typeof useImageParse>;

describe('信息抽取预览', () => {
  it('结果页签、命中统计、修改字段、复制与下载集中在同一工具栏', async () => {
    const onEditFields = vi.fn();
    const onDownload = vi.fn();
    const content = '{"店名":"面壁智能","金额":"###","日期":null,"数量":2}';
    const { container } = render(
      <ImageParseResultPane
        parse={{ ...parse, markdown: content, fields: ['店名', '金额', '日期', '数量', '地址'] }}
        draft={{
          value: content,
          dirty: false,
          ranges: new Map(),
          setValue: vi.fn(),
          reset: vi.fn(),
        }}
        onEditFields={onEditFields}
        onDownload={onDownload}
        reviewEnabled={false}
      />,
    );
    const navigation = container.querySelector<HTMLElement>('[data-result-navigation]');
    expect(navigation).not.toBeNull();
    if (!navigation) throw new Error('result toolbar missing');
    const toolbar = within(navigation);
    expect(toolbar.getByRole('tab', { name: 'imageParseKiePreview' })).toBeInTheDocument();
    expect(toolbar.getByText('imageParseKieResultCount:2/5')).toBeInTheDocument();
    expect(toolbar.getByRole('button', { name: 'imageParseDownload' })).toBeEnabled();
    await userEvent.click(toolbar.getByRole('button', { name: 'imageParseKieModifyFields' }));
    expect(onEditFields).toHaveBeenCalledOnce();
    await userEvent.click(toolbar.getByRole('button', { name: 'imageParseKieCopy' }));
    expect(mocks.copy).toHaveBeenCalledWith(
      JSON.stringify({ 店名: '面壁智能', 金额: '###', 数量: '2' }, null, 2),
    );
    expect(toolbar.getByRole('button', { name: 'imageParseKieCopied' })).toBeInTheDocument();
    await userEvent.click(toolbar.getByRole('tab', { name: 'imageParseKieSource' }));
    expect(toolbar.getByRole('button', { name: 'imageParseKieModifyFields' })).toBeEnabled();
    expect(container.querySelector('[aria-label="imageParseKieResult"] header')).toBeNull();
  });

  it('提取失败且没有正文时仍可修改字段，不显示无效统计或复制', async () => {
    const onEditFields = vi.fn();
    render(
      <ImageParseResultPane
        parse={{ ...parse, markdown: '', error: 'failed', canParse: true, parse: vi.fn() }}
        draft={{ value: '', dirty: false, ranges: new Map(), setValue: vi.fn(), reset: vi.fn() }}
        onEditFields={onEditFields}
        reviewEnabled={false}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('failed');
    await userEvent.click(screen.getByRole('button', { name: 'imageParseKieModifyFields' }));
    expect(onEditFields).toHaveBeenCalledOnce();
    expect(screen.queryByText(/imageParseKieResultCount/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'imageParseKieCopy' })).not.toBeInTheDocument();
  });

  it('解析成功后只展示结果表，不再把原始 JSON 当正文重复渲染', () => {
    const { container } = render(
      <ImageParseResultPane
        parse={parse}
        draft={{
          value: parse.markdown,
          dirty: false,
          ranges: new Map(),
          setValue: vi.fn(),
          reset: vi.fn(),
        }}
        reviewEnabled={false}
      />,
    );

    const result = screen.getByRole('region', { name: 'imageParseKieResult' });
    expect(within(result).getAllByText('1024')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'imageParseKiePreview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'imageParseKieSource' })).toBeInTheDocument();
    expect(container.querySelector('[data-edit-block]')).toBeNull();
  });

  it('成功的空输出使用已完成空态，不再提示尚未开始', () => {
    render(
      <ImageParseResultPane
        parse={{ ...parse, mode: 'standard', markdown: '', finished: true }}
        draft={{
          value: '',
          dirty: false,
          ranges: new Map(),
          setValue: vi.fn(),
          reset: vi.fn(),
        }}
        reviewEnabled={false}
      />,
    );
    expect(screen.getByText('imageParseNoTextTitle')).toBeInTheDocument();
    expect(screen.queryByText('imageParseEmptyHint')).not.toBeInTheDocument();
  });
});
