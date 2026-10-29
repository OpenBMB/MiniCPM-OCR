import { useEffect } from 'react';

import type { Attachment } from '../types';

/** 管理 Blob URL 生命周期，替换或卸载附件时释放大文件内存。 */
export function useAttachmentPreview(attachment?: Attachment) {
  const source = attachment?.dataUrl;
  useEffect(() => {
    if (!source?.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(source);
  }, [source]);
}
