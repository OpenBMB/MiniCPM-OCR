import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@map/ui';

import {
  createImageParseExport,
  imageParseExportFileName,
  saveImageParseExport,
  type ImageParseDownloadFormat,
  type ImageParseExportInput,
} from '../utils/imageParseExport';

interface ImageParseDownloadInput extends ImageParseExportInput {
  name?: string;
  page?: number;
  disabled: boolean;
}

/**
 * 当前 OCR 结果下载：保留点击时的快照，禁止并发生成，失败时恢复入口。
 * @param input 草稿、版面信息、文件名与工作台禁用状态
 * @returns 下载状态与格式选择回调
 */
export function useImageParseDownload(input: ImageParseDownloadInput) {
  const { t } = useTranslation('playground');
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const pending = useRef(false);

  async function download(format: ImageParseDownloadFormat) {
    if (input.disabled || pending.current || !input.markdown.trim()) return;
    pending.current = true;
    setDownloading(true);
    try {
      const blob = await createImageParseExport(format, input);
      saveImageParseExport(blob, imageParseExportFileName(input.name, format, input.page));
    } catch {
      toast({ title: t('imageParseDownloadFailed'), variant: 'error' });
    } finally {
      pending.current = false;
      setDownloading(false);
    }
  }

  return { downloading, download };
}
