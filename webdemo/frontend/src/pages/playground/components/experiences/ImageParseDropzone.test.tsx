/**
 * Image-parse upload-area unit tests: empty-state guidance, drag/paste an image in, and view controls plus replace/remove after an image is selected.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@map/ui';
import type { Attachment } from '../../types';
import { ImageParseDropzone } from './ImageParseDropzone';

const toast = vi.hoisted(() => vi.fn());
const pdfProps = vi.hoisted(() => vi.fn());
vi.mock('@map/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@map/ui')>()),
  useToast: () => ({ toast }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./PdfDocumentStage', () => ({
  default: (props: Record<string, unknown>) => {
    pdfProps(props);
    return <p role="status">PDF preview</p>;
  },
}));

function imageAttachment(): Attachment {
  return {
    id: 'att_1',
    kind: 'image',
    name: 'page.png',
    mime: 'image/png',
    size: 2048,
    dataUrl: 'data:image/png;base64,AAA',
  };
}

describe('ImageParseDropzone', () => {
  it('两页 PNG 使用图片预览和页码按钮，切页重置缩放而不加载 PDF', () => {
    const onPageChange = vi.fn();
    const props = {
      attachment: imageAttachment(),
      onPick: vi.fn(),
      onClear: vi.fn(),
      onPreview: vi.fn(),
      page: 1,
      imagePages: 2,
      imagePage: 1,
      onImagePageChange: onPageChange,
    };
    const { rerender } = render(<ImageParseDropzone {...props} />);
    expect(screen.getByRole('button', { name: 'documentPreviousPage' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'imageParseZoomIn' }));
    expect(screen.getByText('125%')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'documentNextPage' }));
    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(2);

    rerender(
      <ImageParseDropzone
        {...props}
        imagePage={2}
        attachment={{
          ...imageAttachment(),
          name: 'taxi.png',
          dataUrl: 'data:image/png;base64,AQID',
        }}
      />,
    );
    expect(screen.getByText('100%')).toBeVisible();
    expect(screen.getByRole('img', { name: 'taxi.png' })).toHaveAttribute(
      'src',
      'data:image/png;base64,AQID',
    );
    expect(screen.getByRole('button', { name: 'documentNextPage' })).toBeDisabled();
    expect(screen.queryByText('PDF preview')).not.toBeInTheDocument();
  });

  it('PDF 预览器按需加载时也展示统一文档骨架', async () => {
    const { container } = render(
      <ImageParseDropzone
        attachment={{
          ...imageAttachment(),
          kind: 'file',
          mime: 'application/pdf',
          name: 'page.pdf',
        }}
        onPick={vi.fn()}
        onClear={vi.fn()}
        onPreview={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('documentPdfLoading');
    expect(container.querySelector('[data-pdf-loading-page]')).not.toBeNull();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('PDF preview'));
    expect(container.querySelector('[data-pdf-loading-page]')).toBeNull();
  });

  it('shows the empty upload hint before an image is chosen', () => {
    render(<ImageParseDropzone onPick={vi.fn()} onClear={vi.fn()} onPreview={vi.fn()} />);
    expect(screen.getByText('imageParseUploadTitle')).toBeInTheDocument();
    expect(screen.getByText('imageParseUploadLead')).toBeInTheDocument();
    expect(screen.getByText('imageParseLimitSize')).toBeInTheDocument();
    expect(screen.queryByText('imageParseLimitPages')).not.toBeInTheDocument();
    expect(screen.getByText('imageParseLimitPaste')).toBeInTheDocument();
  });

  it('accepts a dropped image file', () => {
    const onPick = vi.fn();
    render(<ImageParseDropzone onPick={onPick} onClear={vi.fn()} onPreview={vi.fn()} />);
    const file = new File(['png'], 'exam.png', { type: 'image/png' });
    fireEvent.drop(screen.getByRole('button', { name: 'imageParseUploadAction' }), {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(onPick).toHaveBeenCalledWith(file);
  });

  it('一个选择器允许多选图片，PDF 混选仍被拒绝', () => {
    const onPick = vi.fn();
    const { container } = render(
      <ImageParseDropzone onPick={onPick} onClear={vi.fn()} onPreview={vi.fn()} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain('application/pdf');
    expect(input.accept).toContain('image/png');
    const pdf = new File(['%PDF'], 'document.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(onPick).toHaveBeenCalledWith(pdf);
    onPick.mockClear();
    fireEvent.drop(screen.getByRole('button', { name: 'imageParseUploadAction' }), {
      dataTransfer: { types: ['Files'], files: [pdf, pdf] },
    });
    expect(onPick).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ title: 'documentOnePdf', variant: 'error' });
  });

  it('does not start uploads from drop or paste while disabled', () => {
    const onPick = vi.fn();
    render(<ImageParseDropzone disabled onPick={onPick} onClear={vi.fn()} onPreview={vi.fn()} />);
    const file = new File(['png'], 'paste.png', { type: 'image/png' });
    fireEvent.paste(window, { clipboardData: { files: [file] } });
    fireEvent.drop(screen.getByRole('button', { name: 'imageParseUploadAction' }), {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('accepts a pasted image without focusing the dropzone', () => {
    const onPick = vi.fn();
    render(<ImageParseDropzone onPick={onPick} onClear={vi.fn()} onPreview={vi.fn()} />);
    const file = new File(['png'], 'paste.png', { type: 'image/png' });
    fireEvent.paste(window, { clipboardData: { files: [file] } });
    expect(onPick).toHaveBeenCalledWith(file);
  });

  it('lets the user preview a selected image while file changes stay in the top controls', () => {
    const onClear = vi.fn();
    const onPreview = vi.fn();
    const onPick = vi.fn();
    render(
      <ImageParseDropzone
        attachment={imageAttachment()}
        onPick={onPick}
        onClear={onClear}
        onPreview={onPreview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'imagePreview' }));
    expect(onPreview).toHaveBeenCalledWith('data:image/png;base64,AAA');

    expect(screen.queryByRole('button', { name: 'imageParseRemove' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'imageParseReplace' })).toBeNull(); // The bottom-bar replace button has been removed
  });

  it('exposes the view controls next to the image', () => {
    render(
      <ImageParseDropzone
        attachment={imageAttachment()}
        onPick={vi.fn()}
        onClear={vi.fn()}
        onPreview={vi.fn()}
      />,
    );

    // Zoom and rotation are the main actions while checking, so they must stay visible rather than appear only on hover.
    for (const name of [
      'imageParseZoomOut',
      'imageParseZoomIn',
      'imageParseRotateLeft',
      'imageParseRotateRight',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'imageParseFitWidth' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'imageParseZoomReset' })).toBeNull();
  });

  it('zooms in and out through the toolbar', () => {
    render(
      <ImageParseDropzone
        attachment={imageAttachment()}
        onPick={vi.fn()}
        onClear={vi.fn()}
        onPreview={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'imageParseZoomIn' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'imageParseZoomReset' })).toBeNull();

    // After zooming to 25%, the same step size can still return to 100%.
    for (let step = 0; step < 5; step += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'imageParseZoomOut' }));
    }
    expect(screen.getByText('25%')).toBeInTheDocument();
    for (let step = 0; step < 3; step += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'imageParseZoomIn' }));
    }
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('按需加载 PDF 时保留滚动和色块定位回调', async () => {
    const onScrollProgress = vi.fn();
    const onSelectBlock = vi.fn();
    render(
      <ImageParseDropzone
        attachment={{
          ...imageAttachment(),
          kind: 'file',
          mime: 'application/pdf',
          name: 'page.pdf',
        }}
        onPick={vi.fn()}
        onClear={vi.fn()}
        onPreview={vi.fn()}
        scrollProgress={0.6}
        onScrollProgress={onScrollProgress}
        onSelectBlock={onSelectBlock}
      />,
    );
    await waitFor(() =>
      expect(pdfProps).toHaveBeenCalledWith(
        expect.objectContaining({
          scrollProgress: 0.6,
          onScrollProgress,
          onSelectBlock,
        }),
      ),
    );
  });

  it('图片原文栏不展示显示设置和评分说明', () => {
    const onToggleBlocks = vi.fn();
    const stageProps = {
      attachment: imageAttachment(),
      onPick: vi.fn(),
      onClear: vi.fn(),
      onPreview: vi.fn(),
      blocks: [
        {
          id: 'low',
          kind: 'text' as const,
          x: 0.1,
          y: 0.2,
          w: 0.5,
          h: 0.1,
          confidence: 0.3,
          text: 'text',
          markdown: 'text',
        },
      ],
      onToggleBlocks,
    };
    const { rerender } = render(<ImageParseDropzone {...stageProps} showBlocks />, {
      wrapper: TooltipProvider,
    });
    expect(screen.queryByRole('button', { name: 'imageParseDisplaySettings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'imageParseScoreHelp' })).toBeNull();
    rerender(<ImageParseDropzone {...stageProps} showBlocks={false} />);
    expect(screen.queryByRole('button', { name: 'imageParseDisplaySettings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'imageParseScoreHelp' })).toBeNull();
    expect(onToggleBlocks).not.toHaveBeenCalled();
  });

  it('选中图片低分色块仍可定位，不提供原图重生成入口', () => {
    const onSelectBlock = vi.fn();
    render(
      <ImageParseDropzone
        attachment={imageAttachment()}
        onPick={vi.fn()}
        onClear={vi.fn()}
        onPreview={vi.fn()}
        showBlocks
        selectedBlockId="low"
        onSelectBlock={onSelectBlock}
        blocks={[
          {
            id: 'low',
            kind: 'text',
            x: 0.1,
            y: 0.2,
            w: 0.5,
            h: 0.1,
            confidence: 0.3,
            text: 'text',
            markdown: 'text',
          },
        ]}
      />,
    );
    expect(screen.queryByRole('button', { name: 'imageParseRegenerateBlock' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'imageParseBlockNumber' }));
    expect(onSelectBlock).toHaveBeenCalledWith('low');
  });
});
