import { describe, expect, it } from 'vitest';
import {
  sanitizeImageParseSnapshot,
  newestImageParseHistory,
  imageParseHistoryStorage,
} from './imageParseHistory';

const snapshot = {
  attachment: {
    id: 'doc',
    kind: 'image' as const,
    name: 'scan.png',
    mime: 'image/png',
    size: 12,
    dataUrl: 'data:image/png;base64,AAA',
    url: 'https://remote/private?token=secret',
    proxyUrl: '/api/private',
    publicUrl: 'https://signed',
    fileId: '../invalid',
    objectKey: 'private',
    jwt: 'jwt-secret',
    apiKey: 'key-secret',
  },
  mode: 'scored' as const,
  markdown: '# Cached',
  layout: [],
};
const source = {
  requestId: 'a'.repeat(32),
  model: 'minicpm-ocr-tts' as const,
  pageIndex: 0,
  createdAt: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 86400,
  token: 'signed-ocr-scope-token',
  inputImageSha256: 'a'.repeat(64),
};

describe('local OCR history', () => {
  it('持久化仅保存本地附件字段，不保存签链、文件权限标识或凭据', () => {
    const safe = sanitizeImageParseSnapshot(snapshot);
    expect(safe?.attachment).toEqual({
      id: 'doc',
      kind: 'image',
      name: 'scan.png',
      mime: 'image/png',
      size: 12,
      dataUrl: 'data:image/png;base64,AAA',
    });
    expect(JSON.stringify(safe)).not.toContain('secret');
  });

  it('拒绝远程附件、示例附件和损坏的缓存', () => {
    expect(
      sanitizeImageParseSnapshot({
        ...snapshot,
        attachment: {
          ...snapshot.attachment,
          dataUrl: 'https://remote/private',
        },
      }),
    ).toBeNull();
    expect(
      sanitizeImageParseSnapshot({
        ...snapshot,
        attachment: {
          ...snapshot.attachment,
          id: 'image-parse-sample',
        },
      }),
    ).toBeNull();
    expect(sanitizeImageParseSnapshot({ markdown: 4 })).toBeNull();
  });

  it('PDF 保留已完成页和当前页，只允许本地裁图', () => {
    const safe = sanitizeImageParseSnapshot({
      ...snapshot,
      attachment: {
        ...snapshot.attachment,
        kind: 'file',
        mime: 'application/pdf',
        name: 'scan.pdf',
        dataUrl: 'data:application/pdf;base64,AAA',
      },
      pdf: {
        page: 2,
        pages: 2,
        results: {
          1: {
            result: { markdown: '# First', blocks: [] },
            crops: ['data:image/png;base64,AAA', 'https://remote/image'],
          },
          2: { result: { markdown: '# Second', blocks: [] }, apiKey: 'secret' },
        },
      },
    });
    expect(safe?.pdf?.page).toBe(2);
    expect(safe?.pdf?.results[1].crops).toEqual(['data:image/png;base64,AAA', '']);
    expect(JSON.stringify(safe)).not.toContain('remote');
    expect(JSON.stringify(safe)).not.toContain('secret');
  });

  it('支持最多 500 页的 PDF 快照并拒绝超限页数', () => {
    const pdfSnapshot = (pages: number) => ({
      ...snapshot,
      attachment: {
        ...snapshot.attachment,
        kind: 'file',
        mime: 'application/pdf',
        name: 'scan.pdf',
        dataUrl: 'data:application/pdf;base64,AAA',
      },
      pdf: {
        page: pages,
        pages,
        results: { [pages]: { result: { markdown: '# Last', blocks: [] } } },
      },
    });

    expect(sanitizeImageParseSnapshot(pdfSnapshot(500))?.pdf?.pages).toBe(500);
    expect(sanitizeImageParseSnapshot(pdfSnapshot(501))).toBeNull();
  });

  it('云端模式保存 fileId 时去掉 base64，本地模式仍保留本地原件', () => {
    const value = {
      ...snapshot,
      attachment: {
        ...snapshot.attachment,
        fileId: 'file_123',
      },
    };
    const cloud = sanitizeImageParseSnapshot(value, { storage: 'cloud' });
    expect(cloud?.attachment.dataUrl).toBe('');
    expect(cloud?.attachment.fileId).toBe('file_123');
    const local = sanitizeImageParseSnapshot(value);
    expect(local?.attachment.dataUrl).toBe(snapshot.attachment.dataUrl);
    expect(local?.attachment.fileId).toBe('file_123');
  });

  it('运行时短时 PDF 链接只用于恢复，默认和云端保存都不会持久化远程链接', () => {
    const runtime = {
      ...snapshot,
      attachment: {
        ...snapshot.attachment,
        kind: 'file' as const,
        mime: 'application/pdf',
        name: 'scan.pdf',
        dataUrl: 'https://files.example/signed.pdf',
        fileId: 'file_pdf',
      },
      pdf: {
        page: 1,
        pages: 1,
        results: { 1: { result: { markdown: '# Saved', blocks: [] } } },
      },
    };
    const restored = sanitizeImageParseSnapshot(runtime, { allowHydratedFileURL: true });
    expect(restored?.attachment.dataUrl).toBe('https://files.example/signed.pdf');
    expect(restored?.attachment.fileId).toBe('file_pdf');
    expect(sanitizeImageParseSnapshot(runtime)).toBeNull();
    expect(sanitizeImageParseSnapshot(runtime, { storage: 'cloud' })?.attachment.dataUrl).toBe('');
  });

  it('旧 PDF 缓存恢复编号标题的定位范围，不改变正文或重复编号的映射', () => {
    const markdown = '## 1. Computational Tool\n\n01A\n\n## 2. Computational Tool\n\n01A';
    const headings = ['1. Computational Tool', '2. Computational Tool'];
    const layout = headings.flatMap((text, index) => {
      const start = markdown.indexOf('01A', markdown.indexOf(text));
      return [
        {
          id: `ocr-${index * 2}`,
          kind: 'heading',
          status: 'ok',
          text,
          markdown: '',
          x: 0.1,
          y: 0.1 + index * 0.2,
          w: 0.3,
          h: 0.02,
          confidence: 0.99,
        },
        {
          id: `ocr-${index * 2 + 1}`,
          kind: 'text',
          status: 'ok',
          text: '01A',
          markdown: '01A',
          markdownStart: start,
          markdownEnd: start + 3,
          x: 0.8,
          y: 0.1 + index * 0.2,
          w: 0.05,
          h: 0.02,
          confidence: 0.99,
        },
      ];
    });
    const safe = sanitizeImageParseSnapshot({
      ...snapshot,
      attachment: {
        ...snapshot.attachment,
        kind: 'file',
        mime: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,AAA',
      },
      pdf: { page: 1, pages: 1, results: { 1: { result: { markdown, blocks: layout } } } },
    });
    expect(safe?.markdown).toBe(markdown);
    expect(
      safe?.layout.filter((block) => block.kind === 'heading').map((block) => block.markdown),
    ).toEqual(headings.map((text) => `## ${text}`));
    expect(safe?.layout[1]).toEqual(layout[1]);
    expect(safe?.layout[3]).toEqual(layout[3]);
    expect(layout[0].markdown).toBe('');
  });

  it('修复旧缓存映射不能补写已保存正文中不存在的标题', () => {
    const safe = sanitizeImageParseSnapshot({
      ...snapshot,
      layout: [
        {
          kind: 'heading',
          status: 'ok',
          text: '1. 不存在的标题',
          markdown: '',
          x: 0.1,
          y: 0.1,
          w: 0.3,
          h: 0.02,
          confidence: 0.99,
        },
      ],
    });
    expect(safe?.markdown).toBe(snapshot.markdown);
    expect(safe?.layout[0].markdown).toBe('');
  });

  it('最新任务优先且只保留 20 条，不修改输入', () => {
    const entries = Array.from({ length: 25 }, (_, index) => ({
      id: String(index),
      createdAt: index,
      snapshot,
    }));
    expect(newestImageParseHistory(entries).map((entry) => entry.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => String(24 - index)),
    );
    expect(entries[0].id).toBe('0');
  });

  it('浏览器存储不可用时拒绝持久化，不调用网络', async () => {
    await expect(imageParseHistoryStorage.list({ userId: 'u', projectId: 'p' })).rejects.toThrow();
  });

  it('should retain only whitelisted source fields and leave the input untouched', () => {
    const untrusted = {
      ...source,
      jwt: 'caller-jwt-secret',
      apiKey: 'caller-key-secret',
      authorization: 'caller-auth-secret',
      nested: { source },
    };
    const safe = sanitizeImageParseSnapshot({
      ...snapshot,
      source: untrusted,
      apiKey: 'snapshot-key-secret',
    });
    expect(safe?.source).toEqual(source);
    expect(JSON.stringify(safe)).not.toContain('secret');
    expect(untrusted.apiKey).toBe('caller-key-secret');
  });

  it('should keep expired source with its original server timestamps for viewable history', () => {
    const expired = { ...source, createdAt: 1, expiresAt: 86401 };
    const safe = sanitizeImageParseSnapshot({
      ...snapshot,
      source: expired,
      createdAt: Date.now(),
    });
    expect(safe?.source).toEqual(expired);
    expect(safe?.markdown).toBe(snapshot.markdown);
  });

  it.each([undefined, null, {}, { ...source, token: '' }])(
    'should keep legacy or invalid-source history viewable without inventing source for %o',
    (value) => {
      const safe = sanitizeImageParseSnapshot({
        ...snapshot,
        source: value,
        createdAt: Date.now(),
      });
      expect(safe).not.toBeNull();
      expect(safe?.source).toBeUndefined();
      expect(safe?.markdown).toBe(snapshot.markdown);
      expect(safe).not.toHaveProperty('source');
    },
  );

  it('should preserve source bound to any catalog model id', () => {
    const catalogSource = { ...source, model: 'selected-ocr-model' };
    const safe = sanitizeImageParseSnapshot({ ...snapshot, source: catalogSource });
    expect(safe?.source).toEqual(catalogSource);
  });

  it('should preserve valid and expired source per PDF page while dropping caller credentials', () => {
    const first = { ...source, createdAt: 1, expiresAt: 86401 };
    const second = { ...source, requestId: 'b'.repeat(32), pageIndex: 1 };
    const safe = sanitizeImageParseSnapshot({
      ...snapshot,
      source: { ...source, requestId: 'c'.repeat(32) },
      attachment: {
        ...snapshot.attachment,
        kind: 'file',
        mime: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,AAA',
      },
      pdf: {
        page: 2,
        pages: 4,
        results: {
          1: { result: { markdown: '# One', blocks: [], source: { ...first, apiKey: 'secret' } } },
          2: { result: { markdown: '# Two', blocks: [], source: second, jwt: 'secret' } },
          3: { result: { markdown: '# Legacy', blocks: [] } },
          4: { result: { markdown: '# Invalid source', blocks: [], source: { token: 'secret' } } },
        },
      },
    });
    expect(safe?.pdf?.results[1].result?.source).toEqual(first);
    expect(safe?.pdf?.results[2].result?.source).toEqual(second);
    expect(safe?.pdf?.results[3].result).toEqual({ markdown: '# Legacy', blocks: [] });
    expect(safe?.pdf?.results[4].result).toEqual({ markdown: '# Invalid source', blocks: [] });
    expect(safe?.markdown).toBe('# Two');
    expect(safe).not.toHaveProperty('source');
    expect(JSON.stringify(safe)).not.toContain('secret');
  });
});
