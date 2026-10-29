import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@map/ui';

import type { DocumentFileRules } from '../utils/documentUpload';
import { applyPreparedDocument } from '../utils/imageGroupPdf';

/**
 * 接管工作台空白区域的整页拖放，复用上传前的 PDF/图片预处理。
 * @param onFile 已通过拖放校验的单文件处理入口
 * @param rules 当前识别档位的格式与数量边界
 * @returns 拖拽高亮状态与可直接展开到容器的拖放事件
 */
export function useImageParsePageDrop(
  onFile: (file: File) => void,
  rules?: DocumentFileRules,
) {
  const { t } = useTranslation('playground');
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);
  return {
    dragging,
    containerProps: {
      onDragOver(event: DragEvent<HTMLDivElement>) {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      },
      onDragLeave(event: DragEvent<HTMLDivElement>) {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragging(false);
      },
      onDrop(event: DragEvent<HTMLDivElement>) {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        setDragging(false);
        applyPreparedDocument(
          event.dataTransfer.files,
          onFile,
          (error) => toast({ title: t(error), variant: 'error' }),
          rules,
        );
      },
    },
  };
}
