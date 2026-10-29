import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@map/ui';

import type { Attachment } from '../types';
import { isImageParseSharedExample } from '../utils/imageParseExamples';
import { imageParseAttachmentFile } from '../utils/imageParseFileReference';

interface ImageParseExampleReparseModel {
  imageParseModel?: { id: string };
  defaultProjectId?: string;
}

interface ImageParseExampleReparseOptions {
  /** Selection generation after a shared example restores successfully; each generation runs automatically only once. */
  selectionRevision?: number;
  /** Turn automatic execution off while an example load or recognition occupies the workspace. */
  autoRun?: boolean;
}

/**
 * Turn a shared example into a personal upload task; it may run automatically after selection, and after a successful upload the existing automatic recognition and history-save path takes over.
 * @param attachment current shared example
 * @param model model permission and default project
 * @param upload upload entry for a personal task
 * @param autoRunOptions selection generation and the automatic-execution switch
 * @returns whether it can be run again, and the rerun callback
 */
export function useImageParseExampleReparse(
  attachment: Attachment | undefined,
  model: ImageParseExampleReparseModel,
  upload: (file: File) => Promise<unknown>,
  { selectionRevision, autoRun = false }: ImageParseExampleReparseOptions = {},
) {
  const { t } = useTranslation('playground');
  const { toast } = useToast();
  const reparseController = useRef<AbortController | null>(null);
  const lastAutoSelectionRevision = useRef<number | undefined>(undefined);
  const sharedExample = Boolean(attachment && isImageParseSharedExample(attachment.id));
  const canReparseExample =
    sharedExample && Boolean(model.imageParseModel?.id && model.defaultProjectId);
  const reparseExample = useCallback(async () => {
    if (!attachment || !canReparseExample) return;
    reparseController.current?.abort();
    const controller = new AbortController();
    reparseController.current = controller;
    try {
      const file = await imageParseAttachmentFile(attachment, controller.signal);
      await upload(file);
    } catch {
      toast({ title: t('documentUploadFailed'), variant: 'error' });
    } finally {
      if (reparseController.current === controller) reparseController.current = null;
    }
  }, [attachment, canReparseExample, t, toast, upload]);

  useEffect(() => () => reparseController.current?.abort(), []);

  useEffect(() => {
    if (
      !selectionRevision ||
      !autoRun ||
      !canReparseExample ||
      lastAutoSelectionRevision.current === selectionRevision
    ) {
      return;
    }
    lastAutoSelectionRevision.current = selectionRevision;
    void reparseExample();
  }, [autoRun, canReparseExample, reparseExample, selectionRevision]);

  return { canReparseExample, reparseExample };
}
