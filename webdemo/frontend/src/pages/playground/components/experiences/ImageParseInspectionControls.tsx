import { useTranslation } from 'react-i18next';
import { Button, cn } from '@map/ui';

import type { useImageParse } from '../../hooks/useImageParse';
import { WORKSPACE_CONTROL } from '../../utils/imageParseWorkspaceStyles';

interface ImageParseInspectionControlsProps {
  parse: ReturnType<typeof useImageParse>;
  uploading: boolean;
  showBlocks: boolean;
  onToggleBlocks: () => void;
  compact?: boolean;
}

/** 工作台识别框开关；只根据区块坐标提供原文定位。 */
export function ImageParseInspectionControls({
  parse,
  uploading,
  showBlocks,
  onToggleBlocks,
  compact = false,
}: ImageParseInspectionControlsProps) {
  const { t } = useTranslation('playground');
  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2',
        compact
          ? 'min-h-8 justify-end'
          : 'min-h-11 shrink-0 border-b border-border/60 bg-card px-3 py-1.5 sm:px-4',
      )}
    >
      {parse.attachment ? (
        <Button
          type="button"
          variant="ghost"
          disabled={uploading || !parse.layout.length}
          aria-pressed={showBlocks}
          onClick={onToggleBlocks}
          className={cn(WORKSPACE_CONTROL, 'text-muted-foreground hover:bg-muted/60')}
        >
          {t(showBlocks ? 'imageParseHideConfidence' : 'imageParseShowConfidence')}
        </Button>
      ) : null}
      {showBlocks && !parse.loading && Boolean(parse.markdown) && parse.layout.length === 0 ? (
        <p role="status" className="basis-full text-[11px] leading-5 text-muted-foreground">
          {t('imageParseNoConfidence')}
        </p>
      ) : null}
    </div>
  );
}
