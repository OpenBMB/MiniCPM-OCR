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
  /** 共享案例成功恢复后的选择代次；同一代次只自动执行一次。 */
  selectionRevision?: number;
  /** 案例加载或识别占用工作台时关闭自动执行。 */
  autoRun?: boolean;
}

/**
 * 把共享示例转换为个人上传任务；选择完成后可自动执行，上传成功后由既有自动识别和历史保存链路接管。
 * @param attachment 当前共享示例
 * @param model 模型权限与默认项目
 * @param upload 个人任务上传入口
 * @param autoRunOptions 选择代次与自动执行开关
 * @returns 是否可重跑及重跑回调
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
