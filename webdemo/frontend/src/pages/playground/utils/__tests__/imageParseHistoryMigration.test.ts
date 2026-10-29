import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadImageParseHistoryPage } from '../imageParseHistoryMigration';

const mocks = vi.hoisted(() => ({
  cloudList: vi.fn(),
  cloudSave: vi.fn(),
  localList: vi.fn(),
  localRemove: vi.fn(),
}));
vi.mock('@/api/map/imageParseHistory', () => ({
  listImageParseHistory: mocks.cloudList,
  saveImageParseHistory: mocks.cloudSave,
}));
vi.mock('../imageParseHistory', () => ({
  imageParseHistoryStorage: { list: mocks.localList, remove: mocks.localRemove },
}));
const snapshot = { attachment: { id: 'file' } };
const entry = { id: 'legacy-record', createdAt: 1, snapshot };
let scenario = 0;
const scope = () => ({ userId: `migration-${scenario++}`, projectId: 'project' });

describe('旧浏览器历史迁移', () => {
  beforeEach(() => {
    mocks.cloudList.mockReset().mockResolvedValue({ list: [], hasMore: false });
    mocks.cloudSave.mockReset().mockResolvedValue({ id: 'cloud-record' });
    mocks.localList.mockReset().mockResolvedValue([entry]);
    mocks.localRemove.mockReset().mockResolvedValue(undefined);
  });
  it('服务端确认保存后才移除同一账号/项目的旧记录，再刷新摘要', async () => {
    const owner = scope();
    await loadImageParseHistoryPage(owner, 0);
    expect(mocks.cloudSave).toHaveBeenCalledWith(owner, snapshot, undefined, true);
    expect(mocks.localRemove).toHaveBeenCalledWith(owner, entry.id);
    expect(mocks.cloudSave.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.localRemove.mock.invocationCallOrder[0],
    );
    expect(mocks.cloudList).toHaveBeenCalledTimes(2);
  });
  it('云端保存失败时保留原记录，仍返回可用云端列表并提示未完成迁移', async () => {
    mocks.cloudSave.mockRejectedValue(new Error('offline'));
    expect(await loadImageParseHistoryPage(scope(), 0)).toMatchObject({
      migrationPending: true,
      list: [],
    });
    expect(mocks.localRemove).not.toHaveBeenCalled();
  });
  it('浏览器禁用 IndexedDB 不阻止云端历史，不使用临时存档替代真实保存', async () => {
    mocks.localList.mockRejectedValue(new DOMException('Unavailable', 'SecurityError'));
    expect(await loadImageParseHistoryPage(scope(), 0)).toEqual({ list: [], hasMore: false });
    expect(mocks.cloudSave).not.toHaveBeenCalled();
  });
  it('云端读取失败或加载后续页时不启动浏览器迁移', async () => {
    mocks.cloudList.mockRejectedValueOnce(new Error('offline'));
    await expect(loadImageParseHistoryPage(scope(), 0)).rejects.toThrow('offline');
    await loadImageParseHistoryPage(scope(), 20);
    expect(mocks.localList).not.toHaveBeenCalled();
  });
  it('迁移后的云端摘要仍按当前入口任务过滤', async () => {
    const owner = scope();
    await loadImageParseHistoryPage(owner, 0, undefined, 'kie');
    expect(mocks.cloudList).toHaveBeenNthCalledWith(1, owner, 0, undefined, 'kie');
    expect(mocks.cloudList).toHaveBeenNthCalledWith(2, owner, 0, undefined, 'kie');
  });
  it('同一账号迁移成功后刷新不再额外迁移或重复拉取摘要', async () => {
    const owner = scope();
    await loadImageParseHistoryPage(owner, 0);
    await loadImageParseHistoryPage(owner, 0);
    expect(mocks.localList).toHaveBeenCalledOnce();
    expect(mocks.cloudSave).toHaveBeenCalledOnce();
    expect(mocks.cloudList).toHaveBeenCalledTimes(3);
  });
  it('旧记录超限或已删除时只保留失败项，继续迁移后续有效记录', async () => {
    const failed = { ...entry, id: 'large-old-document', createdAt: 0 };
    mocks.localList.mockResolvedValue([entry, failed]);
    mocks.cloudSave.mockRejectedValueOnce(new Error('imageParseHistoryTooLarge'));
    mocks.cloudList.mockResolvedValueOnce({ list: [], hasMore: false }).mockResolvedValue({
      list: [{ id: 'cloud-record' }],
      hasMore: false,
    });
    const page = await loadImageParseHistoryPage(scope(), 0);
    expect(page).toMatchObject({ migrationPending: true, list: [{ id: 'cloud-record' }] });
    expect(mocks.cloudSave).toHaveBeenCalledTimes(2);
    expect(mocks.localRemove).toHaveBeenCalledExactlyOnceWith(expect.any(Object), entry.id);
  });
});
