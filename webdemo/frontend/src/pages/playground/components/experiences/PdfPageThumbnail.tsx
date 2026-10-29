import type { PDFDocumentProxy } from 'pdfjs-dist';
import { FileImage } from 'lucide-react';
import { cn } from '@map/ui';

import { usePdfThumbnail } from '../../hooks/usePdfThumbnail';

/** Low-resolution PDF preview; draw only visible items, and do not share a canvas with the body. */
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
