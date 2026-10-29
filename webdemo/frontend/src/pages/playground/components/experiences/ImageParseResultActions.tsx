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
 * 结果导出操作：只负责下载，不包含视图切换入口。
 * 一键复制正文的格式无法保证（Markdown 源码粘到哪里都不是文档），
 * 结果文本统一走下载，区域复制放在选中块的就近操作处。
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
