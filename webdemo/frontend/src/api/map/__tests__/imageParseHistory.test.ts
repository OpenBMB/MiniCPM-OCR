import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteImageParseHistory,
  getImageParseHistory,
  listImageParseHistory,
  saveImageParseHistory,
  IMAGE_PARSE_HISTORY_MAX_BODY_BYTES,
} from '../imageParseHistory';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  subject: vi.fn(),
  link: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('../request', () => ({
  mapRequest: mocks.request,
  getTokenSubject: mocks.subject,
}));
vi.mock('../fileUploads', () => ({
  linkPlaygroundFile: mocks.link,
}));
const scope = { userId: 'alice', projectId: 'project' };
const snapshot = {
  attachment: {
    id: 'document',
    kind: 'image' as const,
    name: 'scan.png',
    mime: 'image/png',
    size: 1,
    dataUrl: 'data:image/png;base64,YQ==',
  },
  mode: 'scored' as const,
  markdown: '# Saved',
  layout: [],
};

describe('云端 OCR 历史 API', () => {
  beforeEach(() => {
    mocks.subject.mockReset().mockReturnValue('alice');
    mocks.request.mockReset().mockResolvedValue({ id: 'history', createdAt: 1, snapshot });
    mocks.link.mockReset();
    mocks.fetch.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('列表分页带当前项目，但不发送 owner 或完整文档', async () => {
    mocks.request.mockResolvedValueOnce({ list: [], hasMore: false });
    await listImageParseHistory(scope, 20);
    expect(mocks.request).toHaveBeenCalledWith(
      '/image-parse/history?project_id=project&offset=20',
      { signal: undefined },
    );
  });
  it('列表按任务隔离历史，KIE 请求不混入全文识别记录', async () => {
    mocks.request.mockResolvedValueOnce({
      list: [{ id: 'kie', attachmentId: 'document', name: 'invoice.png', createdAt: 1 }],
      hasMore: false,
    });
    await listImageParseHistory(scope, 20, undefined, 'kie');
    expect(mocks.request).toHaveBeenCalledWith(
      '/image-parse/history?project_id=project&task=kie&offset=20',
      { signal: undefined },
    );
  });
  it('列表响应缺少分页字段时拒绝，不把 undefined 传给组件', async () => {
    mocks.request.mockResolvedValueOnce({});
    await expect(listImageParseHistory(scope)).rejects.toThrow('imageParseHistoryInvalid');
  });
  it('按附件定位时同样校验分页响应，异常数据不进入读取流程', async () => {
    mocks.request.mockResolvedValueOnce({});
    await expect(getImageParseHistory(scope, 'document', undefined, true)).rejects.toThrow(
      'imageParseHistoryInvalid',
    );
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('账号切换后拒绝旧范围的列表、写入和删除，不发送新账号凭据', async () => {
    mocks.subject.mockReturnValue('bob');
    expect(() => listImageParseHistory(scope)).toThrow('imageParseHistoryScopeRequired');
    expect(() => saveImageParseHistory(scope, snapshot)).toThrow('imageParseHistoryScopeRequired');
    await expect(deleteImageParseHistory(scope, 'history')).rejects.toThrow(
      'imageParseHistoryScopeRequired',
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('文件服务记录云端只保存稳定 fileId，不保存原始 base64', async () => {
    const value = {
      ...snapshot,
      attachment: {
        ...snapshot.attachment,
        fileId: 'file_123',
        url: 'signed',
        publicUrl: 'signed',
      },
    };
    await saveImageParseHistory(scope, value);
    const body = JSON.parse(mocks.request.mock.lastCall?.[1].body);
    expect(body.snapshot.attachment).toEqual({
      ...snapshot.attachment,
      dataUrl: '',
      fileId: 'file_123',
    });
  });

  it('打开图片 fileId 历史只等待签链，不等待原图下载或转 base64', async () => {
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.link.mockResolvedValueOnce('https://files.example/signed');
    mocks.fetch.mockRejectedValue(new Error('image download must not block history'));
    mocks.request.mockResolvedValueOnce({
      id: 'history',
      createdAt: 1,
      snapshot: {
        ...snapshot,
        attachment: { ...snapshot.attachment, dataUrl: '', fileId: 'file_123' },
      },
    });

    await expect(getImageParseHistory(scope, 'history')).resolves.toEqual({
      id: 'history',
      createdAt: 1,
      snapshot: {
        ...snapshot,
        attachment: {
          ...snapshot.attachment,
          dataUrl: 'https://files.example/signed',
          fileId: 'file_123',
        },
      },
    });
    expect(mocks.link).toHaveBeenCalledWith('file_123', undefined);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('打开 PDF fileId 记录时重新签链并直接预览短时链接，不再生成大 base64', async () => {
    const pdfSnapshot = {
      attachment: {
        id: 'document',
        kind: 'file' as const,
        name: 'scan.pdf',
        mime: 'application/pdf',
        size: 1,
        dataUrl: '',
        fileId: 'file_pdf',
      },
      mode: 'scored' as const,
      markdown: '# Saved',
      layout: [],
      pdf: {
        page: 1,
        pages: 1,
        results: { 1: { result: { markdown: '# Saved', blocks: [] } } },
      },
    };
    mocks.link.mockResolvedValueOnce('https://files.example/signed.pdf');
    mocks.request.mockResolvedValueOnce({
      id: 'history',
      createdAt: 1,
      snapshot: pdfSnapshot,
    });

    await expect(getImageParseHistory(scope, 'history')).resolves.toEqual({
      id: 'history',
      createdAt: 1,
      snapshot: {
        ...pdfSnapshot,
        attachment: { ...pdfSnapshot.attachment, dataUrl: 'https://files.example/signed.pdf' },
      },
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('签链失败或返回非 HTTP 链接时不恢复历史', async () => {
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.request.mockResolvedValueOnce({
      id: 'history',
      createdAt: 1,
      snapshot: {
        ...snapshot,
        attachment: { ...snapshot.attachment, dataUrl: '', fileId: 'file_123' },
      },
    });
    mocks.link.mockRejectedValueOnce(new Error('forbidden'));
    await expect(getImageParseHistory(scope, 'history')).rejects.toThrow(
      'imageParseHistoryInvalid',
    );

    mocks.request.mockResolvedValueOnce({
      id: 'history',
      createdAt: 1,
      snapshot: {
        ...snapshot,
        attachment: { ...snapshot.attachment, dataUrl: '', fileId: 'file_123' },
      },
    });
    mocks.link.mockResolvedValueOnce('javascript:alert(1)');
    await expect(getImageParseHistory(scope, 'history')).rejects.toThrow(
      'imageParseHistoryInvalid',
    );
  });

  it('保存只发送白名单快照，恢复用 PUT，迁移标记禁止覆盖已有云端版本', async () => {
    const value = {
      ...snapshot,
      secret: 'private',
      attachment: { ...snapshot.attachment, url: 'signed' },
    };
    await saveImageParseHistory(scope, value);
    expect(mocks.request).toHaveBeenLastCalledWith('/image-parse/history?project_id=project', {
      method: 'POST',
      body: JSON.stringify({ snapshot }),
    });
    await saveImageParseHistory(scope, value, 'history');
    expect(mocks.request).toHaveBeenLastCalledWith(
      '/image-parse/history/history?project_id=project',
      { method: 'PUT', body: JSON.stringify({ snapshot }) },
    );
    await saveImageParseHistory(scope, value, undefined, true);
    expect(mocks.request.mock.lastCall?.[1].body).toBe(
      JSON.stringify({ snapshot, importOnly: true }),
    );
  });
  it('打开时校验记录身份与快照，不向组件返回网络中的额外字段', async () => {
    expect(await getImageParseHistory(scope, 'history')).toEqual({
      id: 'history',
      createdAt: 1,
      snapshot,
    });
    mocks.request.mockResolvedValue({ id: 'other', createdAt: 1, snapshot });
    await expect(getImageParseHistory(scope, 'history')).rejects.toThrow(
      'imageParseHistoryInvalid',
    );
    mocks.request.mockResolvedValue({
      id: 'history',
      createdAt: 1,
      snapshot: { ...snapshot, attachment: {} },
    });
    await expect(getImageParseHistory(scope, 'history')).rejects.toThrow(
      'imageParseHistoryInvalid',
    );
  });
  it('云端历史请求体上限为 128 MiB', () => {
    expect(IMAGE_PARSE_HISTORY_MAX_BODY_BYTES).toBe(128 * 1024 * 1024);
  });

  it('超出存档大小上限时不发出网络请求', () => {
    vi.stubGlobal(
      'Blob',
      class {
        size = IMAGE_PARSE_HISTORY_MAX_BODY_BYTES + 1;
      },
    );
    expect(() => saveImageParseHistory(scope, snapshot)).toThrow('imageParseHistoryTooLarge');
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('PDF 存档只保存原件和各页结果，不重复传输派生裁剪图', async () => {
    await saveImageParseHistory(scope, {
      ...snapshot,
      attachment: {
        ...snapshot.attachment,
        kind: 'file',
        name: 'scan.pdf',
        mime: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,YQ==',
      },
      pdf: {
        page: 1,
        pages: 1,
        results: {
          1: {
            result: { markdown: '# Saved', blocks: [] },
            crops: ['data:image/png;base64,YQ=='],
          },
        },
      },
    });
    const body = JSON.parse(mocks.request.mock.lastCall?.[1].body);
    expect(body.snapshot.pdf.results['1']).toEqual({
      result: { markdown: '# Saved', blocks: [] },
    });
    expect(body.snapshot.attachment.dataUrl).toBe('data:application/pdf;base64,YQ==');
  });
  it('云端 PDF 保存 fileId 时同样不保存原始 base64', async () => {
    await saveImageParseHistory(scope, {
      ...snapshot,
      attachment: {
        ...snapshot.attachment,
        kind: 'file',
        name: 'scan.pdf',
        mime: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,YQ==',
        fileId: 'file_pdf',
      },
      pdf: {
        page: 1,
        pages: 1,
        results: { 1: { result: { markdown: '# Saved', blocks: [] } } },
      },
    });
    const body = JSON.parse(mocks.request.mock.lastCall?.[1].body);
    expect(body.snapshot.attachment).toEqual({
      id: 'document',
      kind: 'file',
      name: 'scan.pdf',
      mime: 'application/pdf',
      size: 1,
      dataUrl: '',
      fileId: 'file_pdf',
    });
  });

  it('刷新时可定位首屏摘要以外的个人当前文档，再按云端 ID 读取快照', async () => {
    mocks.request.mockResolvedValueOnce({
      list: [{ id: 'history', attachmentId: 'document', name: 'scan.png', createdAt: 1 }],
      hasMore: false,
    });
    expect(await getImageParseHistory(scope, 'document', undefined, true)).toEqual({
      id: 'history',
      createdAt: 1,
      snapshot,
    });
    expect(mocks.request).toHaveBeenNthCalledWith(
      1,
      '/image-parse/history?project_id=project&attachment_id=document',
      { signal: undefined },
    );
    expect(mocks.request).toHaveBeenNthCalledWith(
      2,
      '/image-parse/history/history?project_id=project',
      { signal: undefined },
    );
  });
  it('按附件定位当前文档时也带任务，避免同附件的全文记录抢占 KIE 恢复', async () => {
    mocks.request.mockResolvedValueOnce({
      list: [{ id: 'kie', attachmentId: 'document', name: 'invoice.png', createdAt: 1 }],
      hasMore: false,
    });
    mocks.request.mockResolvedValueOnce({
      id: 'kie',
      createdAt: 1,
      snapshot: { ...snapshot, mode: 'kie', fields: ['店名'] },
    });
    await expect(
      getImageParseHistory(scope, 'document', undefined, true, 'kie'),
    ).resolves.toMatchObject({ id: 'kie' });
    expect(mocks.request).toHaveBeenNthCalledWith(
      1,
      '/image-parse/history?project_id=project&task=kie&attachment_id=document',
      { signal: undefined },
    );
  });
});
