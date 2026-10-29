import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageParseUploadSurface } from './ImageParseUploadSurface';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { label?: string }) =>
      options?.label ? `${key}: ${options.label}` : key,
  }),
}));

describe('ImageParseUploadSurface', () => {
  it('保留虚线上传框与框外限制说明', () => {
    const onOpen = vi.fn();
    render(<ImageParseUploadSurface onOpen={onOpen} />);
    const upload = screen.getByRole('button', { name: 'imageParseUploadAction' });
    expect(upload).toHaveClass('border-dashed', 'bg-card');
    expect(upload).toContainElement(screen.getByText('imageParseUploadHint'));
    expect(upload).not.toContainElement(screen.getByText('imageParseLimitSize'));
    expect(screen.queryByText('imageParseLimitPages')).not.toBeInTheDocument();
    expect(screen.getByText('imageParseLimitSize')).toBeVisible();
    expect(screen.getByText('imageParseLimitPaste')).toBeVisible();
    expect(screen.queryByText('imageParseLimitAuto')).not.toBeInTheDocument();
    expect(screen.queryByText('documentOcrNotice')).not.toBeInTheDocument();
    fireEvent.click(upload);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('图片和 PDF 共用一个多选选择器', () => {
    const onFiles = vi.fn();
    const { container } = render(<ImageParseUploadSurface onOpen={vi.fn()} onFiles={onFiles} />);
    const inputs = container.querySelectorAll('input[type="file"]');
    expect(inputs).toHaveLength(1);
    const input = inputs[0] as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain('application/pdf');
    expect(input.accept).toContain('image/png');
    const image = new File(['png'], 'page.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [image] } });
    expect(onFiles).toHaveBeenCalledOnce();
    expect(onFiles.mock.calls[0]![0][0]).toBe(image);
    expect(input.value).toBe('');
  });

  it('预览模式只展示预览说明，不宣称自动识别', () => {
    render(<ImageParseUploadSurface onOpen={vi.fn()} previewOnly />);
    expect(screen.getByText('imageParseLimitPreview')).toBeVisible();
    expect(screen.queryByText('imageParseLimitAuto')).not.toBeInTheDocument();
    expect(screen.queryByText('documentOcrNotice')).not.toBeInTheDocument();
  });

  it('上传区不再展示旋转与印章识别开关', () => {
    render(<ImageParseUploadSurface onOpen={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText('imageParseUpright')).not.toBeInTheDocument();
    expect(screen.queryByText('imageParseRecognizeSeal')).not.toBeInTheDocument();
    expect(screen.queryByText('imageParseLimitPages')).not.toBeInTheDocument();
  });

  it('禁用后不能打开选择器', () => {
    const onOpen = vi.fn();
    render(<ImageParseUploadSurface onOpen={onOpen} disabled />);
    const upload = screen.getByRole('button', { name: 'imageParseUploadAction' });
    expect(upload).toBeDisabled();
    fireEvent.click(upload);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('单图任务不展示 PDF 页数和多图限制', () => {
    render(
      <ImageParseUploadSurface
        onOpen={vi.fn()}
        multiple={false}
        accept="image/png,image/jpeg"
        hintKey="imageParseUploadHintPipelineImages"
      />,
    );
    expect(screen.queryByText('imageParseLimitPages')).not.toBeInTheDocument();
    expect(screen.queryByText('imageParseLimitSize')).not.toBeInTheDocument();
    expect(screen.getByText('imageParseLimitSingleImage')).toBeVisible();
  });

  it('拖放事件由调用方处理，拖入时沿用高亮样式', () => {
    const onDragOver = vi.fn();
    const onDragLeave = vi.fn();
    const onDrop = vi.fn();
    render(
      <ImageParseUploadSurface
        onOpen={vi.fn()}
        dragging
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      />,
    );
    const upload = screen.getByRole('button', { name: 'imageParseUploadAction' });
    expect(upload).toHaveClass('border-primary');
    fireEvent.dragOver(upload);
    fireEvent.dragLeave(upload);
    fireEvent.drop(upload);
    expect(onDragOver).toHaveBeenCalledOnce();
    expect(onDragLeave).toHaveBeenCalledOnce();
    expect(onDrop).toHaveBeenCalledOnce();
  });
});
