import { FileImage } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Empty, useToast } from '@map/ui';

import { documentAccept, type ImageParseUploadRules } from '../../utils/documentUpload';
import type { ImageParseKieExample } from '../../utils/imageParseKieExamples';
import { applyPreparedDocument } from '../../utils/imageGroupPdf';
import {
  IMAGE_PARSE_WORKSPACE_EXAMPLES,
  type ImageParseExampleType,
} from '../../utils/imageParseExamples';
import { ImageParseExampleGrid } from './ImageParseExampleGrid';
import { ImageParseUploadSurface } from './ImageParseUploadSurface';
import { ImageParseKieUpload } from './ImageParseKieUpload';

/** The empty state keeps both direct upload and the top-bar new entry. */
export interface ImageParseWorkspaceProps {
  onNewDocument: () => void;
  onExample?: (type: ImageParseExampleType) => void;
  onKieExample?: (example: ImageParseKieExample) => void;
  onPick?: (file: File) => void;
  disabled?: boolean;
  allowAreaUpload?: boolean;
  uploadRules?: ImageParseUploadRules;
}

/**
 * Single-area upload empty state and real built-in samples. It does not own upload or parse state.
 * @param props Samples, new-document, and file-selection callbacks
 * @returns Compact document workspace
 */
export function ImageParseWorkspace({
  onNewDocument,
  onExample,
  onKieExample,
  onPick,
  disabled = false,
  allowAreaUpload = true,
  uploadRules,
}: ImageParseWorkspaceProps) {
  const { t } = useTranslation('playground');
  const { toast } = useToast();
  if (uploadRules?.singleImage && !uploadRules.imagesOnly && allowAreaUpload) {
    return (
      <ImageParseKieUpload
        onNewDocument={onNewDocument}
        onPick={onPick}
        onExample={onKieExample}
        disabled={disabled}
        uploadRules={uploadRules}
      />
    );
  }
  return (
    <div className="min-h-0 flex-none bg-muted/30 lg:flex-1 lg:overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-5 py-10 sm:px-8 sm:py-14">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            {t(
              uploadRules?.imagesOnly
                ? 'imageParseUploadImageTitle'
                : 'imageParseUploadDocumentTitle',
            )}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t(
              uploadRules?.imagesOnly
                ? 'imageParseUploadImageDescription'
                : 'imageParseUploadDocumentDescription',
            )}
          </p>
        </div>
        <section
          role="region"
          aria-label={t('imageParseOriginal')}
          data-pane="origin"
          data-state="empty"
          className="min-w-0"
        >
          {allowAreaUpload ? (
            <div className="w-full">
              <ImageParseUploadSurface
                disabled={disabled}
                onOpen={onNewDocument}
                onFiles={
                  onPick
                    ? (files) =>
                        applyPreparedDocument(
                          files,
                          onPick,
                          (error) => toast({ title: t(error), variant: 'error' }),
                          uploadRules,
                        )
                    : undefined
                }
                accept={documentAccept(uploadRules)}
                multiple={!uploadRules?.singleImage}
                hintKey={uploadRules?.hintKey}
              />
            </div>
          ) : (
            <Empty
              icon={<FileImage className="size-8 text-muted-foreground/50" aria-hidden="true" />}
              title={t('imageParseWorkspaceOriginalEmpty')}
              className="max-w-full [&_p]:break-words"
            />
          )}
        </section>
        {!uploadRules?.imagesOnly ? (
          <section
            aria-label={t('imageParseWorkspaceExamples')}
            data-tour="image-parse-examples"
            className="w-full shrink-0"
          >
            <ImageParseExampleGrid
              examples={
                uploadRules?.imagesOnly
                  ? IMAGE_PARSE_WORKSPACE_EXAMPLES.filter((example) => example.format !== 'PDF')
                  : IMAGE_PARSE_WORKSPACE_EXAMPLES
              }
              disabled={disabled || !onExample}
              onExample={onExample}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}
