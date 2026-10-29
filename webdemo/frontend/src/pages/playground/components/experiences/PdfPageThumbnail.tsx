import type { PDFDocumentProxy } from 'pdfjs-dist';
import { FileImage } from 'lucide-react';
import { cn } from '@map/ui';

import { usePdfThumbnail } from '../../hooks/usePdfThumbnail';

/** PDF 低分辨率预览；仅可见项绘制，不与正文共用 canvas。 */
export function PdfPageThumbnail({
  document,
  pageNumber,
}: {
  document?: PDFDocumentProxy;
  pageNumber: number;
}) {
  const { canvasRef, ready } = usePdfThumbnail(document, pageNumber);
  return (
    <span className="relative flex size-full items-center justify-center">
      {!ready ? <FileImage className="size-5 text-muted-foreground/40" aria-hidden="true" /> : null}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-page-thumbnail={pageNumber}
        data-ready={ready}
        className={cn('absolute max-h-full max-w-full object-contain', !ready && 'invisible')}
      />
    </span>
  );
}
