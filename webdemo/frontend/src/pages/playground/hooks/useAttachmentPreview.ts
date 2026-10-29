import { useEffect } from 'react';

import type { Attachment } from '../types';

/** Manage Blob URL lifetime, and release large-file memory when an attachment is replaced or unmounted. */
export function useAttachmentPreview(attachment?: Attachment) {
  const source = attachment?.dataUrl;
  useEffect(() => {
    if (!source?.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(source);
  }, [source]);
}
