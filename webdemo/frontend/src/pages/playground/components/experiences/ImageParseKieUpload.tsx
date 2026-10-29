import { useTranslation } from 'react-i18next';
import { useToast } from '@map/ui';

import { documentAccept, type ImageParseUploadRules } from '../../utils/documentUpload';
import {
  IMAGE_PARSE_KIE_EXAMPLES,
  type ImageParseKieExample,
  type ImageParseKieExampleType,
} from '../../utils/imageParseKieExamples';
import { applyPreparedDocument } from '../../utils/imageGroupPdf';
import { ImageParseExampleGrid } from './ImageParseExampleGrid';
import { ImageParseUploadSurface } from './ImageParseUploadSurface';

interface ImageParseKieUploadProps {
  onPick?: (file: File) => void;
  onNewDocument: () => void;
  onExample?: (example: ImageParseKieExample) => void;
  disabled?: boolean;
  uploadRules: ImageParseUploadRules;
}

/**
 * 信息抽取上传入口，布局与文档解析空态一致，并允许选择真实票据案例。
 * @param props 文件、案例选择回调与任务禁用状态
 * @returns 上传区域和可选择的内置案例
 */
export function ImageParseKieUpload({
  onPick,
  onNewDocument,
  onExample,
  disabled,
  uploadRules,
}: ImageParseKieUploadProps) {
  const { t } = useTranslation('playground');
  const { toast } = useToast();

  function selectExample(type: ImageParseKieExampleType) {
    const example = IMAGE_PARSE_KIE_EXAMPLES.find((item) => item.type === type);
    if (example) onExample?.(example);
  }

  return (
    <div className="min-h-0 flex-none bg-muted/30 lg:flex-1 lg:overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-5 py-10 sm:px-8 sm:py-14">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            {t('imageParseUploadImageTitle')}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t('imageParseUploadImageDescription')}
          </p>
        </div>
        <section
          role="region"
          aria-label={t('imageParseOriginal')}
          data-pane="origin"
          data-state="empty"
          className="min-w-0"
        >
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
              multiple={false}
              hintKey={uploadRules.hintKey}
            />
          </div>
        </section>
        <section
          aria-label={t('imageParseKieSampleTitle')}
          data-tour="image-parse-kie-examples"
          className="w-full shrink-0"
        >
          <ImageParseExampleGrid
            titleKey="imageParseKieSampleTitle"
            examples={IMAGE_PARSE_KIE_EXAMPLES}
            disabled={disabled || !onExample}
            onExample={selectExample}
          />
        </section>
      </div>
    </div>
  );
}
