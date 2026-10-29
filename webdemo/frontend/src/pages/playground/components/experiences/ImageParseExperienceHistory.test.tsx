import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@map/ui';

import type { usePlaygroundModel } from '../../hooks/usePlaygroundModel';
import type { PlaygroundSidebarHistory } from '../PlaygroundHistoryList';
import { readCurrentImageParseId, writeCurrentImageParseId } from '../../utils/imageParseCurrent';
import { ImageParseExperience } from './ImageParseExperience';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  restore: vi.fn(),
  toast: vi.fn(),
  replay: vi.fn(),
  tour: vi.fn(),
  uploadStart: undefined as (() => void) | undefined,
  uploadCancel: vi.fn(),
  exampleLoad: vi.fn(),
  exampleCancel: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@map/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@map/ui')>()),
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock('../../utils/imageParseHistoryMigration', () => ({
  loadImageParseHistoryPage: mocks.list,
}));
vi.mock('@/api/map/imageParseHistory', () => ({
  getImageParseHistory: mocks.get,
  saveImageParseHistory: vi.fn(),
  deleteImageParseHistory: vi.fn(),
}));
vi.mock('../../hooks/useImageParseExperienceTour', () => ({
  useImageParseExperienceTour: (
    options: Parameters<
      typeof import('../../hooks/useImageParseExperienceTour').useImageParseExperienceTour
    >[0],
  ) => {
    mocks.tour(options);
    return { replay: mocks.replay };
  },
}));
vi.mock('../../hooks/useDocumentUpload', () => ({
  useDocumentUpload: (_ready: unknown, _scope: string, onStart: () => void) => {
    mocks.uploadStart = onStart;
    return { pending: false, error: undefined, upload: vi.fn(), cancel: mocks.uploadCancel };
  },
}));
vi.mock('../../hooks/useImageParseExamples', () => ({
  useImageParseExamples: () => ({
    load: mocks.exampleLoad,
    cancel: mocks.exampleCancel,
    pending: false,
    pageKey: undefined,
    images: undefined,
  }),
}));
vi.mock('../../hooks/useImageParse', () => ({
  useImageParse: () => ({
    resultKey: 'history-test',
    snapshot: null,
    restore: mocks.restore,
    attachment: undefined,
    setAttachment: vi.fn(),
    markdown: '',
    loading: false,
    mode: 'high-precision',
    setMode: vi.fn(),
    parse: vi.fn(),
    stop: vi.fn(),
    appendDocument: vi.fn(),
    canParse: false,
    progress: null,
    layout: [],
  }),
}));
const scope = JSON.stringify(['user', 'project']);
const entry = {
  id: 'history-document',
  createdAt: 1,
  snapshot: {
    attachment: {
      id: 'document',
      kind: 'image' as const,
      name: 'scan.png',
      mime: 'image/png',
      size: 12,
      dataUrl: 'data:image/png;base64,AAA',
    },
    mode: 'high-precision' as const,
    markdown: '# Cached',
    layout: [],
  },
};
const model = {
  userId: 'user',
  defaultProjectId: 'project',
  imageParseModels: [],
  getSecret: () => 'plain-secret',
  modelsLoading: false,
  keysLoading: false,
  hasKeys: false,
  trialRemaining: {},
} as unknown as ReturnType<typeof usePlaygroundModel>;

function workspace(
  onHistoryChange: (history: PlaygroundSidebarHistory | undefined) => void,
  startFresh = false,
  currentModel = model,
) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TooltipProvider>
          <ImageParseExperience
            model={currentModel}
            startFresh={startFresh}
            onHistoryChange={onHistoryChange}
          />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('文档解析入口与当前历史恢复', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.list.mockReset().mockResolvedValue({
      list: [{ id: entry.id, createdAt: 1, attachmentId: 'document', name: 'scan.png' }],
      hasMore: false,
    });
    mocks.get.mockReset().mockResolvedValue(entry);
    mocks.restore.mockReset().mockReturnValue(true);
    mocks.toast.mockReset();
    mocks.replay.mockReset();
    mocks.tour.mockReset();
    mocks.uploadCancel.mockReset();
    mocks.exampleLoad.mockReset();
    mocks.exampleCancel.mockReset();
    writeCurrentImageParseId(scope, entry.snapshot.attachment.id);
  });

  it('直接进入或刷新页面仍恢复当前文档', async () => {
    render(workspace(vi.fn()));
    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith(entry.snapshot));
    expect(mocks.restore).toHaveBeenCalledOnce();
    expect(readCurrentImageParseId(scope)).toBe(entry.snapshot.attachment.id);
  });

  it('主动点击入口不恢复旧文档，但保留手动打开历史的能力', async () => {
    const onHistoryChange = vi.fn<(history: PlaygroundSidebarHistory | undefined) => void>();
    render(workspace(onHistoryChange, true));
    await waitFor(() =>
      expect(onHistoryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sessions: expect.arrayContaining([{ id: entry.id, title: 'scan.png' }]),
          loading: false,
        }),
      ),
    );
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(readCurrentImageParseId(scope)).toBeNull();
    const history = onHistoryChange.mock.calls[onHistoryChange.mock.calls.length - 1]?.[0];
    expect(history?.activeSessionId).toBeUndefined();
    await act(async () => history?.onSelectSession(entry.id));
    expect(mocks.restore).toHaveBeenCalledWith(entry.snapshot);
  });

  it('点击入口时项目尚未加载，范围就绪后也不恢复旧文档', async () => {
    const onHistoryChange = vi.fn<(history: PlaygroundSidebarHistory | undefined) => void>();
    const { rerender } = render(
      workspace(onHistoryChange, true, { ...model, defaultProjectId: undefined }),
    );
    expect(mocks.list).not.toHaveBeenCalled();
    rerender(workspace(onHistoryChange, true));
    await waitFor(() =>
      expect(onHistoryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sessions: expect.arrayContaining([{ id: entry.id, title: 'scan.png' }]),
          loading: false,
        }),
      ),
    );
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(readCurrentImageParseId(scope)).toBeNull();
  });

  it('工作台右上角不常驻引导入口，也不会误触发历史恢复', async () => {
    render(workspace(vi.fn(), true));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: 'imageParseTourReplay' })).not.toBeInTheDocument();
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it('新用户进入先等身份和历史初始化，云端读取失败也不阻止首次引导', async () => {
    const { rerender } = render(
      workspace(vi.fn(), true, { ...model, userId: undefined, defaultProjectId: undefined }),
    );
    expect(mocks.tour).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: undefined, projectId: undefined }),
    );
    mocks.list.mockRejectedValue(new Error('Cloud unavailable'));
    rerender(workspace(vi.fn(), true));
    expect(mocks.tour).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 'user', projectId: 'project', ready: false }),
    );
    await waitFor(() =>
      expect(mocks.tour).toHaveBeenLastCalledWith(
        expect.objectContaining({ userId: 'user', projectId: 'project', ready: true }),
      ),
    );
  });
  it('空工作台点击历史后开始上传，晚到的历史不能取消新上传', async () => {
    let finish!: (value: typeof entry) => void;
    mocks.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onHistoryChange = vi.fn<(history: PlaygroundSidebarHistory | undefined) => void>();
    render(workspace(onHistoryChange, true));
    await waitFor(() =>
      expect(onHistoryChange).toHaveBeenLastCalledWith(expect.objectContaining({ loading: false })),
    );
    const history = onHistoryChange.mock.lastCall?.[0];
    const pending = history?.onSelectSession(entry.id);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledOnce());
    act(() => mocks.uploadStart?.());
    await act(async () => {
      finish(entry);
      await pending;
    });
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.uploadCancel).not.toHaveBeenCalled();
  });

  it('点击空态真实案例时立即取消自动恢复，不等素材下载结束', async () => {
    let finish!: (value: typeof entry) => void;
    mocks.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(workspace(vi.fn()));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'imageParseCasePhysics' }));
    expect(mocks.exampleLoad).toHaveBeenCalledExactlyOnceWith('physics');
    await act(async () => {
      finish(entry);
    });
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(readCurrentImageParseId(scope)).toBeNull();
  });
});
