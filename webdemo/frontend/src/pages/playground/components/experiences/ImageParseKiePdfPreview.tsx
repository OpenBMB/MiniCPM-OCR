import { useTranslation } from 'react-i18next';
import { Button, Empty } from '@map/ui';

import type { useImageParse } from '../../hooks/useImageParse';
import type { ImageParseDraft } from '../../hooks/useImageParseDraft';
import { imageParseKieValues } from '../../utils/imageParseKie';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { ImageParseKieSummary } from './ImageParseKieSummary';
import { ImageParsePdfPendingPage } from './ImageParsePdfResultPage';

interface ImageParseKiePdfPreviewProps {
  parse: ReturnType<typeof useImageParse>;
  draft: ImageParseDraft;
}

/**
 * KIE PDF results are shown for the current page, so multi-page JSON is not laid out continuously in the same column. While extraction is in progress, reuse the document-parse page waiting state, and show the current page's fields after it finishes.
 * @param parse Current recognition state
 * @param draft Editable draft for the current page
 */
export function ImageParseKiePdfPreview({ parse, draft }: ImageParseKiePdfPreviewProps) {
  const { t } = useTranslation('playground');
  const pdf = parse.pdf!;
  const page = pdf.page;
  const result = pdf.results[page];
  const pending = !result?.result && !result?.error;
  const values = imageParseKieValues(draft.value);

  function renderPage() {
    if (pdf.loading || pending) {
      return (
        <ImageParsePdfPendingPage
          page={page}
          completed={pdf.completed}
          total={pdf.pages}
          current
          loading={pdf.loading}
          onRetry={pdf.retryPage}
        />
      );
    }
    if (result?.error) {
      return (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 py-4 text-sm text-destructive"
        >
          <span>{t(result.error)}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={pdf.loading}
            onClick={() => pdf.retryPage(page)}
          >
            {t('documentPdfRetryPage')}
          </Button>
        </div>
      );
    }
    if (!draft.value.trim()) {
      return (
        <Empty
          className="py-10"
          title={t('imageParseNoTextTitle')}
          description={t('imageParseNoTextHint')}
        />
      );
    }
    return (
      <>
        <ImageParseKieSummary content={draft.value} fields={parse.fields} />
        {values ? null : <MarkdownRenderer content={draft.value} variant="document" />}
      </>
    );
  }

  return (
    <div data-ocr-kie-pdf-result="" data-ocr-result-page={page} className="min-w-0">
      {renderPage()}
    </div>
  );
}
