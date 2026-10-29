import { describe, expect, it } from 'vitest';

import { sanitizeImageParseSnapshot } from '../imageParseHistorySnapshot';

const snapshot = {
  attachment: {
    id: 'document',
    kind: 'image',
    name: 'scan.png',
    mime: 'image/png',
    size: 1,
    dataUrl: 'https://files.example/signed.png',
    fileId: 'file_123',
  },
  mode: 'standard',
  markdown: '# Saved',
  layout: [],
};

describe('历史原图的运行时签链边界', () => {
  it('仅恢复时接受带稳定 fileId 的位图签链', () => {
    expect(sanitizeImageParseSnapshot(snapshot, { allowHydratedFileURL: true })).toMatchObject(
      snapshot,
    );
    expect(sanitizeImageParseSnapshot(snapshot)).toBeNull();
    expect(
      sanitizeImageParseSnapshot(snapshot, { storage: 'local', allowHydratedFileURL: true }),
    ).toBeNull();
  });

  it('云端保存始终去掉短时签链，即使误启用恢复选项', () => {
    expect(
      sanitizeImageParseSnapshot(snapshot, { storage: 'cloud', allowHydratedFileURL: true })
        ?.attachment,
    ).toEqual({ ...snapshot.attachment, dataUrl: '' });
  });

  it.each([
    { fileId: undefined },
    { mime: 'image/svg+xml' },
    { mime: 'text/html' },
    { dataUrl: 'javascript:alert(1)' },
    { dataUrl: 'blob:untrusted' },
  ])('拒绝非法或没有稳定引用的原图 %j', (change) => {
    expect(
      sanitizeImageParseSnapshot(
        { ...snapshot, attachment: { ...snapshot.attachment, ...change } },
        { allowHydratedFileURL: true },
      ),
    ).toBeNull();
  });
});
