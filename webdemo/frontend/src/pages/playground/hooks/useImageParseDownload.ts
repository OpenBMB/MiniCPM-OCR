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
 * Download of the current OCR result: keep the snapshot from the click, forbid concurrent generation, and restore the entry on failure.
 * @param input draft, layout info, file name, and workspace disabled state
 * @returns download state and the format-selection callback
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
