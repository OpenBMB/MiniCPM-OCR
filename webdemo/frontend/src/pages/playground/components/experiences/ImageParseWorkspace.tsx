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

/** 空态保留直接上传和顶栏新建两种入口。 */
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
 * 单区上传空态及真实内置样例，不承担上传或解析状态。
 * @param props 样例、新建文档及文件选择回调
 * @returns 紧凑文档工作台
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
