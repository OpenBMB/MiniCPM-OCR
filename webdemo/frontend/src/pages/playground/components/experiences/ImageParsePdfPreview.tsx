import { useRef } from 'react';

import type { useImageParse } from '../../hooks/useImageParse';
import type { ImageParseDraft } from '../../hooks/useImageParseDraft';
import type { useImageParseRegeneration } from '../../hooks/useImageParseRegeneration';
import { useImageParsePdfPreview } from '../../hooks/useImageParsePdfPreview';
import { ImageParsePdfResultPage } from './ImageParsePdfResultPage';

interface ImageParsePdfPreviewProps {
  parse: ReturnType<typeof useImageParse>;
  draft: ImageParseDraft;
  tab: string;
  linked: boolean;
  selectedId?: string;
  hoveredId?: string;
  focusRequest?: number;
  onFocus?: (top: number) => void;
  onCopyRegion?: (id: string) => void;
  regeneration?: ReturnType<typeof useImageParseRegeneration>;
  recognizeSeal: boolean;
  recognizeChart: boolean;
}

/** Continuous full-page PDF preview; pages not yet returned keep a waiting anchor, and off-screen results mount only through the virtual list. */
export function ImageParsePdfPreview({
  parse,
  draft,
  tab,
  linked,
  selectedId,
  hoveredId,
  focusRequest,
  onFocus,
  onCopyRegion,
  regeneration,
  recognizeSeal,
  recognizeChart,
}: ImageParsePdfPreviewProps) {
  const root = useRef<HTMLDivElement>(null);
  const pdf = parse.pdf!;
  const preview = useImageParsePdfPreview(
    pdf,
    parse.resultKeyForPage,
    root,
    tab === 'preview',
    linked,
    focusRequest,
    onFocus,
  );
  return (
    <div ref={root} data-ocr-continuous-pdf="" data-virtualized={preview.virtualized}>
      {preview.virtualized ? (
        <div className="relative w-full" style={{ height: preview.totalSize }}>
          {preview.items.map((item) => {
            const page = preview.pages[item.index]!;
            const mounted = preview.mounted(page);
            return (
              <section
                key={parse.resultKeyForPage(page)}
                data-ocr-result-page={page}
                data-index={item.index}
                ref={mounted ? preview.measure : undefined}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  minHeight: item.size,
                  transform: `translateY(${item.start}px)`,
                }}
                className="flow-root pb-10"
              >
                {mounted ? (
                  <ImageParsePdfResultPage
                    page={page}
                    resultKey={parse.resultKeyForPage(page)}
                    result={pdf.results[page]}
                    completed={pdf.completed}
                    total={pdf.pages}
                    draft={draft}
                    current={page === pdf.page}
                    loading={pdf.loading}
                    tab={tab}
                    linked={linked}
                    selectedId={selectedId}
                    hoveredId={hoveredId}
                    focusRequest={focusRequest}
                    onFocus={onFocus}
                    onCopyRegion={onCopyRegion}
                    regeneration={regeneration}
                    recognizeSeal={recognizeSeal}
                    recognizeChart={recognizeChart}
                    onRetry={pdf.retryPage}
                    onEditingChange={preview.onEditingChange}
                  />
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        preview.pages.map((page, index) => {
          return (
            <section
              key={parse.resultKeyForPage(page)}
              data-ocr-result-page={page}
              data-index={index}
              className="flow-root pb-10"
            >
              <ImageParsePdfResultPage
                page={page}
                resultKey={parse.resultKeyForPage(page)}
                result={pdf.results[page]}
                completed={pdf.completed}
                total={pdf.pages}
                draft={draft}
                current={page === pdf.page}
                loading={pdf.loading}
                tab={tab}
                linked={linked}
                selectedId={selectedId}
                hoveredId={hoveredId}
                focusRequest={focusRequest}
                onFocus={onFocus}
                onCopyRegion={onCopyRegion}
                regeneration={regeneration}
                recognizeSeal={recognizeSeal}
                recognizeChart={recognizeChart}
                onRetry={pdf.retryPage}
                onEditingChange={preview.onEditingChange}
              />
            </section>
          );
        })
      )}
    </div>
  );
}
