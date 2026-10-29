import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageParseWorkspace } from './ImageParseWorkspace';
import {
  IMAGE_PARSE_SHARED_EXAMPLES,
  IMAGE_PARSE_WORKSPACE_EXAMPLES,
} from '../../utils/imageParseExamples';
import { imageParseUploadRules } from '../../utils/documentUpload';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@map/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@map/ui')>()),
  useToast: () => ({ toast }),
}));

describe('ImageParseWorkspace empty workbench', () => {
  it('空态复用原上传框，不渲染双栏标题和结果占位', () => {
    const onExample = vi.fn();
    const onNewDocument = vi.fn();
    render(<ImageParseWorkspace onExample={onExample} onNewDocument={onNewDocument} />);
    expect(
      screen.queryByRole('heading', { name: 'imageParseWorkspaceTitle' }),
    ).not.toBeInTheDocument();
    const uploadRegion = screen.getByRole('region', { name: 'imageParseOriginal' });
    expect(uploadRegion.className).not.toMatch(/\bborder(?:-|\b)/);
    expect(screen.queryByRole('region', { name: 'imageParseResult' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'imageParseOriginal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'imageParseResult' })).not.toBeInTheDocument();
    expect(screen.queryByText('imageParseWorkspaceResultEmpty')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'imageParseCasePhysics' })).toHaveAttribute(
      'src',
      expect.stringContaining('physics-thumb.webp'),
    );
    const upload = screen.getByRole('button', { name: 'imageParseUploadAction' });
    expect(upload).toBeVisible();
    expect(upload).toHaveClass('border-dashed', 'bg-card');
    expect(upload).not.toContainElement(screen.getByText('imageParseLimitSize'));
    expect(screen.queryByText('imageParseLimitPages')).not.toBeInTheDocument();
    expect(screen.getByText('imageParseLimitPaste')).toBeVisible();
    expect(screen.queryByText('imageParseLimitAuto')).not.toBeInTheDocument();
    expect(screen.queryByText('imageParseWorkspaceOriginalEmpty')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'imageParseCasePhysics' }));
    expect(onExample).toHaveBeenCalledExactlyOnceWith('physics');
    expect(onNewDocument).not.toHaveBeenCalled();
  });

  it('未提供文件回调时上传入口可沿用新建文档流程', () => {
    const onNewDocument = vi.fn();
    render(<ImageParseWorkspace onNewDocument={onNewDocument} allowAreaUpload />);
    fireEvent.click(screen.getByRole('button', { name: 'imageParseUploadAction' }));
    expect(onNewDocument).toHaveBeenCalledOnce();
  });

  it('有文件回调时直接选择图片或 PDF，不打开新建弹窗', () => {
    const onPick = vi.fn();
    const onNewDocument = vi.fn();
    const { container } = render(
      <ImageParseWorkspace onNewDocument={onNewDocument} onPick={onPick} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    const choose = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'imageParseUploadAction' }));
    expect(choose).toHaveBeenCalledOnce();
    expect(input.accept).toContain('application/pdf');
    expect(input.accept).toContain('image/png');
    const file = new File(['%PDF'], 'document.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onPick).toHaveBeenCalledWith(file);
    expect(onNewDocument).not.toHaveBeenCalled();
    expect(input.value).toBe('');
  });

  it('忙碌状态禁用直接上传，多份 PDF 不能静默上传第一个文件', () => {
    const onPick = vi.fn();
    const { container, rerender } = render(
      <ImageParseWorkspace onNewDocument={vi.fn()} onPick={onPick} disabled />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['png'], 'page.png', { type: 'image/png' });
    expect(screen.getByRole('button', { name: 'imageParseUploadAction' })).toBeDisabled();
    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { files: [file] } });
    expect(onPick).not.toHaveBeenCalled();
    rerender(<ImageParseWorkspace onNewDocument={vi.fn()} onPick={onPick} />);
    const pdf = new File(['%PDF'], 'document.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [pdf, pdf] } });
    expect(onPick).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ title: 'documentOnePdf', variant: 'error' });
  });

  it('首屏展示全部用户提供的案例原件', () => {
    expect(IMAGE_PARSE_SHARED_EXAMPLES).toHaveLength(11);
    expect(IMAGE_PARSE_WORKSPACE_EXAMPLES.map(({ type }) => type)).toEqual([
      'physics',
      'student-sports',
      'egdi',
      'mechanics',
      'electric-field',
      'ft-newspaper',
      'civil-trial',
      'dombey-son',
      'financial-table',
      'newspaper',
      'leave-calendar',
    ]);
    expect(
      IMAGE_PARSE_WORKSPACE_EXAMPLES.filter((example) => example.format === 'PDF'),
    ).toHaveLength(2);
    const onExample = vi.fn();
    render(<ImageParseWorkspace onNewDocument={vi.fn()} onExample={onExample} />);
    for (const { type, label: name, thumbnail } of IMAGE_PARSE_WORKSPACE_EXAMPLES) {
      expect(screen.getByRole('img', { name })).toBeInTheDocument();
      expect(screen.getByRole('img', { name })).toHaveAttribute('src', thumbnail);
      fireEvent.click(screen.getByRole('button', { name }));
      expect(onExample).toHaveBeenLastCalledWith(type);
    }
    expect(screen.getByRole('button', { name: 'imageParseCaseNewspaper' })).toBeInTheDocument();
  });

  it('示例展示文档标题、格式和 PDF 页数，不用重复的上传式边框', () => {
    render(<ImageParseWorkspace onNewDocument={vi.fn()} onExample={vi.fn()} />);
    expect(screen.getByText('imageParseCasePhysics')).toBeVisible();
    expect(screen.getAllByText('PNG')).toHaveLength(9);
    expect(screen.queryByText('imageParseCasePdfPages')).not.toBeInTheDocument();
    expect(screen.getAllByText('imageParseCasePdfPageCount')).toHaveLength(2);
    expect(screen.queryByText('imageParseCaseCaptured')).not.toBeInTheDocument();
    for (const { label: name } of IMAGE_PARSE_WORKSPACE_EXAMPLES) {
      const example = screen.getByRole('button', { name });
      expect(example.className).not.toMatch(/border-dashed/);
      expect(example).toBeEnabled();
    }
  });

  it('示例区使用自适应网格，不渲染轮播按钮和滚动轨道', () => {
    render(<ImageParseWorkspace onNewDocument={vi.fn()} onExample={vi.fn()} />);
    const grid = document.querySelector('[data-image-parse-example-grid]');
    expect(grid).toBeInstanceOf(HTMLDivElement);
    expect(grid).toHaveClass('grid', 'grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-4');
    expect(grid).not.toHaveClass('overflow-x-auto', 'snap-x');
    expect(
      screen.queryByRole('button', { name: 'imageParseExamplesScrollLeft' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'imageParseExamplesScrollRight' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'imageParseCasePhysics' })).toBeEnabled();
  });

  it('字段提取保留上传入口，不展示会切回全文识别的案例', () => {
    render(
      <ImageParseWorkspace
        onNewDocument={vi.fn()}
        onExample={vi.fn()}
        uploadRules={imageParseUploadRules('kie')}
      />,
    );
    expect(screen.queryByRole('button', { name: 'imageParseCaseNewspaper' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'imageParseCasePhysics' })).toBeNull();
    expect(screen.getByRole('button', { name: 'imageParseUploadAction' })).toBeVisible();
  });

  it('信息抽取与文档解析使用相同的工作区背景、标题和上传面样式', () => {
    const { container, rerender } = render(<ImageParseWorkspace onNewDocument={vi.fn()} />);
    const workspaceClass = container.firstElementChild?.className;
    const contentClass = container.firstElementChild?.firstElementChild?.className;
    const headingClass = screen.getByRole('heading', {
      name: 'imageParseUploadDocumentTitle',
    }).className;
    const uploadClass = screen.getByRole('button', {
      name: 'imageParseUploadAction',
    }).className;
    expect(container.firstElementChild).toHaveClass('bg-muted/30');

    rerender(
      <ImageParseWorkspace
        onNewDocument={vi.fn()}
        onKieExample={vi.fn()}
        uploadRules={imageParseUploadRules('kie')}
      />,
    );
    expect(container.firstElementChild).toHaveClass(workspaceClass!);
    expect(container.firstElementChild?.firstElementChild).toHaveClass(contentClass!);
    expect(screen.getByRole('heading', { name: 'imageParseUploadImageTitle' })).toHaveClass(
      headingClass,
    );
    expect(screen.getByRole('button', { name: 'imageParseUploadAction' })).toHaveClass(uploadClass);
    expect(document.querySelector('[data-image-parse-example-grid]')).toHaveClass(
      'grid',
      'grid-cols-1',
      'sm:grid-cols-2',
      'lg:grid-cols-4',
    );
  });

  it('信息抽取允许单个图片或 PDF 文件上传', () => {
    const { container } = render(
      <ImageParseWorkspace
        onNewDocument={vi.fn()}
        onPick={vi.fn()}
        uploadRules={imageParseUploadRules('kie')}
      />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(false);
    expect(input.accept).toContain('application/pdf');
  });

  it('信息抽取展示两张可选择案例，不伪装成用户抽取记录', () => {
    const onKieExample = vi.fn();
    render(
      <ImageParseWorkspace
        onNewDocument={vi.fn()}
        onKieExample={onKieExample}
        uploadRules={imageParseUploadRules('kie')}
      />,
    );
    expect(screen.getByRole('img', { name: 'imageParseKieSampleTaxiTitle' })).toHaveAttribute(
      'src',
      expect.stringContaining('kie-taxi-receipt.png'),
    );
    expect(screen.getByRole('img', { name: 'imageParseKieSampleRestaurantTitle' })).toHaveAttribute(
      'src',
      expect.stringContaining('kie-restaurant-receipt.png'),
    );
    expect(screen.getByText('imageParseKieSampleTitle')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'imageParseKieSampleTaxiTitle' }));
    expect(onKieExample).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: 'taxi-receipt' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'imageParseKieSampleRestaurantTitle' }));
    expect(onKieExample).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'restaurant-receipt' }),
    );
  });

  it('关闭区域上传时信息抽取也不显示文件选择器', () => {
    const { container } = render(
      <ImageParseWorkspace
        onNewDocument={vi.fn()}
        allowAreaUpload={false}
        uploadRules={imageParseUploadRules('kie')}
      />,
    );
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it('忙碌或缺少恢复入口时禁用全部案例，不回退交互演示', () => {
    const { rerender } = render(
      <ImageParseWorkspace onNewDocument={vi.fn()} onExample={vi.fn()} disabled />,
    );
    for (const { label } of IMAGE_PARSE_WORKSPACE_EXAMPLES)
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
    rerender(<ImageParseWorkspace onNewDocument={vi.fn()} />);
    for (const { label } of IMAGE_PARSE_WORKSPACE_EXAMPLES)
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
  });
});
