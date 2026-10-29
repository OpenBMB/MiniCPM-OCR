import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useImageParseExampleReparse } from '../useImageParseExampleReparse';
import type { Attachment } from '../../types';

const toast = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@map/ui', () => ({
  useToast: () => ({ toast }),
}));

const attachment: Attachment = {
  id: 'example:physics',
  kind: 'image',
  name: '手写物理笔记.png',
  mime: 'image/png',
  size: 3,
  dataUrl: 'data:image/png;base64,AQID',
};

describe('共享案例自动重新识别', () => {
  it('案例选择完成后自动转换为上传，同一选择不因重复渲染重复执行', async () => {
    const upload = vi.fn(async () => undefined);
    const model = {
      imageParseModel: { id: 'minicpm-ocr-aio' },
      defaultProjectId: 'project-1',
    };
    const { rerender } = renderHook(
      ({ revision }) =>
        useImageParseExampleReparse(attachment, model, upload, {
          selectionRevision: revision,
          autoRun: true,
        }),
      { initialProps: { revision: 1 } },
    );

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    rerender({ revision: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(upload).toHaveBeenCalledTimes(1);

    rerender({ revision: 2 });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  });
});
