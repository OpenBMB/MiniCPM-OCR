import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAttachmentPreview } from '../useAttachmentPreview';

describe('原件预览资源生命周期', () => {
  it('恢复同一原件的任务结果不释放 Blob，只在更换地址或卸载时释放', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const attachment = {
      id: 'pdf',
      kind: 'file' as const,
      name: 'a.pdf',
      mime: 'application/pdf',
      size: 12,
      dataUrl: 'blob:local-pdf',
    };
    const { rerender, unmount } = renderHook(({ file }) => useAttachmentPreview(file), {
      initialProps: { file: attachment },
    });
    rerender({ file: { ...attachment } });
    expect(revoke).not.toHaveBeenCalled();
    rerender({ file: { ...attachment, dataUrl: 'blob:replacement' } });
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:local-pdf');
    unmount();
    expect(revoke).toHaveBeenLastCalledWith('blob:replacement');
    revoke.mockRestore();
  });
});
