import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImageParseKieSummary } from './ImageParseKieSummary';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('信息抽取结果摘要', () => {
  it('按字段展开 JSON，并将 ### 显示为未找到', () => {
    render(
      <ImageParseKieSummary
        content={'{"店名":"面壁智能","金额":"###"}'}
        fields={['店名', '金额']}
      />,
    );
    expect(screen.getByText('店名')).toBeInTheDocument();
    expect(screen.getByText('面壁智能')).toBeInTheDocument();
    expect(screen.getByText('金额')).toBeInTheDocument();
    expect(screen.getByText('imageParseKieMissing')).toBeInTheDocument();
  });

  it('模型漏掉的请求字段也按未找到展示', () => {
    render(<ImageParseKieSummary content={'{"店名":"面壁智能"}'} fields={['店名', '金额']} />);
    expect(screen.getByText('店名')).toBeInTheDocument();
    expect(screen.getByText('面壁智能')).toBeInTheDocument();
    expect(screen.getByText('金额')).toBeInTheDocument();
    expect(screen.getByText('imageParseKieMissing')).toBeInTheDocument();
    expect(screen.queryByText('{"店名":"面壁智能"}')).toBeNull();
  });

  it('模型未返回合法 JSON 时不渲染结果摘要或格式提示', () => {
    const { container } = render(<ImageParseKieSummary content="普通 Markdown" />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['{}', '{"店名":null,"金额":null}'])('全部未找到时仍展示完整请求字段：%s', (content) => {
    render(<ImageParseKieSummary content={content} fields={['店名', '金额']} />);
    expect(screen.getAllByText('imageParseKieMissing')).toHaveLength(2);
  });

  it('空结果不插入格式错误提示', () => {
    const { container } = render(<ImageParseKieSummary content="  " />);
    expect(container).toBeEmptyDOMElement();
  });

  it('字段正文不再重复统计、标题和复制操作', () => {
    const { container } = render(
      <ImageParseKieSummary content={'{"店名":"面壁智能"}'} fields={['店名']} />,
    );
    expect(screen.getByRole('region', { name: 'imageParseKieResult' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'imageParseKieCopy' })).not.toBeInTheDocument();
    expect(container.querySelector('header')).toBeNull();
  });
});
