import type { useImageParseRegeneration } from '../../hooks/useImageParseRegeneration';
import type { ImageParseDownloadFormat } from '../../utils/imageParseExport';
import { ImageParseDownloadMenu } from './ImageParseDownloadMenu';

interface ImageParseResultActionsProps {
  loading: boolean;
  regeneration?: ReturnType<typeof useImageParseRegeneration>;
  downloading?: boolean;
  onDownload?: (format: ImageParseDownloadFormat) => void;
}

/**
 * Result export actions: download only, with no view-switch entry. One-click copy of the body cannot guarantee a format (Markdown source pasted anywhere is not a document). Result text goes through download, and region copy lives on the nearby actions of the selected block.
 */
export function ImageParseResultActions({
  loading,
  regeneration,
  downloading = false,
  onDownload,
}: ImageParseResultActionsProps) {
  return (
    <div className="flex shrink-0 items-center">
      {onDownload ? (
        <ImageParseDownloadMenu
          disabled={loading || downloading || Boolean(regeneration?.busy)}
          downloading={downloading}
          onDownload={onDownload}
        />
      ) : null}
    </div>
  );
}
