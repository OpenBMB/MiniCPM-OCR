/**
 * Image-parse experience page unit tests: the empty state does not show the result column; after an image is selected, the comparison result, stop, and download stay fixed. Also covers three new behaviors: staged progress while parsing, restore after editing on the original page, and the region-copy entry no longer living in the top bar.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@map/ui';
import type { Attachment } from '../../types';
import type { ImageParseProgressSnapshot } from '../../utils/imageParseSimulation';
import type { ImageParseLayoutBlock } from '../../utils/imageParseSample';

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  stop: vi.fn(),
  appendDocument: vi.fn(),
  setAttachment: vi.fn(),
  setMode: vi.fn(),
  setFields: vi.fn(),
  setRecognizeSeal: vi.fn(),
  readFileAsAttachment: vi.fn(),
  readPreviewAttachment: vi.fn(),
  copyText: vi.fn<(text: string) => Promise<boolean>>(async () => true),
  toast: vi.fn(),
  exampleLoad: vi.fn(),
  exampleSelectionRevision: 0,
  state: {
    markdown: '',
    loading: false,
    error: undefined as string | undefined,
    attachment: undefined as Attachment | undefined,
    canParse: false,
    mode: 'standard' as
      | 'standard'
      | 'scored'
      | 'high-precision'
      | 'standard-pipeline'
      | 'seal'
      | 'kie',
    fields: [] as string[],
    progress: null as ImageParseProgressSnapshot | null,
    layout: [] as readonly ImageParseLayoutBlock[],
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@map/ui', async () => {
  const actual = await vi.importActual<typeof import('@map/ui')>('@map/ui');
  return {
    ...actual,
    useToast: () => ({ toast: mocks.toast }),
  };
});

vi.mock('../../utils/copyText', () => ({
  copyText: (text: string) => mocks.copyText(text),
}));

// The first-run guide brings driver.js and timers. Page unit tests verify it separately, so it is replaced entirely here.
vi.mock('../../hooks/useImageParseExperienceTour', () => ({
  useImageParseExperienceTour: () => ({ replay: vi.fn() }),
}));
vi.mock('../../hooks/useImageParsePipelineCapabilities', () => ({
  useImageParsePipelineCapabilities: () => ({
    enabled: false,
    modes: [],
    seal: false,
    kie: false,
    upright: true,
  }),
}));
vi.mock('../../hooks/useImageParseExamples', () => ({
  useImageParseExamples: () => ({
    load: mocks.exampleLoad,
    cancel: vi.fn(),
    pending: false,
    selectionRevision: mocks.exampleSelectionRevision,
    pageKey: undefined,
    images: undefined,
  }),
}));

vi.mock('../../utils/attachments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/attachments')>();
  return {
    ...actual,
    readFileAsAttachment: (...args: unknown[]) => mocks.readFileAsAttachment(...args),
    readPreviewAttachment: (...args: unknown[]) => mocks.readPreviewAttachment(...args),
  };
});

vi.mock('../../utils/appendDocumentPages', () => ({
  buildAppendedPdf: vi.fn(async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    previousPages: 1,
    totalPages: 2,
  })),
  bytesToDataUrl: vi.fn(async () => 'data:application/pdf;base64,AAEC'),
}));
vi.mock('../../utils/imageParseUpload', () => ({
  uploadImageParseDocument: (file: File, options: unknown, signal: AbortSignal) =>
    mocks.readFileAsAttachment(file, signal, options),
}));

vi.mock('../../hooks/useImageParse', () => ({
  useImageParse: () => ({
    resultKey: 'test-image:1',
    snapshot: mocks.state.attachment
      ? {
          attachment: mocks.state.attachment,
          mode: mocks.state.mode,
          markdown: mocks.state.markdown,
          layout: mocks.state.layout,
        }
      : null,
    restore: vi.fn(),
    attachment: mocks.state.attachment,
    setAttachment: mocks.setAttachment,
    markdown: mocks.state.markdown,
    loading: mocks.state.loading,
    error: mocks.state.error,
    mode: mocks.state.mode,
    fields: mocks.state.fields,
    recognizeSeal: true,
    setRecognizeSeal: mocks.setRecognizeSeal,
    setFields: mocks.setFields,
    setMode: mocks.setMode,
    parse: mocks.parse,
    stop: mocks.stop,
    appendDocument: mocks.appendDocument,
    canParse: mocks.state.canParse,
    progress: mocks.state.progress,
    layout: mocks.state.layout,
  }),
}));

vi.mock('../KeyStatusBar', () => ({
  KeyStatusBar: () => <div>key-status</div>,
}));

vi.mock('@map/store', () => {
  const state = {
    locale: 'zh-CN',
    playground: {
      imageParseHideHeaderFooter: false,
      imageParseShowOrder: false,
    },
    setPlaygroundPrefs: () => undefined,
  };
  return { useAppStore: (selector: (value: typeof state) => unknown) => selector(state) };
});

import { ImageParseExperience } from './ImageParseExperience';

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
  HTMLElement.prototype.scrollIntoView = () => undefined;
  HTMLElement.prototype.scrollTo = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  // jsdom does not hit-test coordinates; keyboard input follows the currently focused element.
  document.elementFromPoint = () => document.activeElement;
});

function imageAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'att_1',
    kind: 'image',
    name: 'page.png',
    mime: 'image/png',
    size: 12,
    dataUrl: 'data:image/png;base64,AAA',
    ...overrides,
  };
}

function modelStub(overrides: Record<string, unknown> = {}) {
  return {
    imageParseModels: [{ id: 'ocr-md', display_name: 'OCR' }],
    imageParseModel: { id: 'ocr-md', display_name: 'OCR' },
    getSecret: () => 'plain-secret',
    selectImageParseModel: vi.fn(),
    modelsLoading: false,
    keysLoading: false,
    hasKeys: true,
    secretLoading: false,
    secretError: false,
    ...overrides,
  } as never;
}

function renderExperience(model = modelStub(), task: 'standard' | 'kie' = 'standard') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TooltipProvider>
          <ImageParseExperience model={model} task={task} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ImageParseExperience', () => {
  beforeEach(() => {
    mocks.parse.mockReset();
    mocks.stop.mockReset();
    mocks.appendDocument.mockReset();
    mocks.setAttachment.mockReset();
    mocks.setMode.mockReset();
    mocks.readFileAsAttachment.mockReset();
    mocks.readPreviewAttachment.mockReset();
    mocks.readFileAsAttachment.mockResolvedValue({
      ok: true,
      attachment: imageAttachment({ fileId: 'file-test' }),
    });
    mocks.copyText.mockReset();
    mocks.copyText.mockResolvedValue(true);
    mocks.toast.mockReset();
    mocks.exampleSelectionRevision = 0;
    mocks.state.markdown = '';
    mocks.state.loading = false;
    mocks.state.error = undefined;
    mocks.state.attachment = undefined;
    mocks.state.canParse = false;
    mocks.state.mode = 'standard';
    mocks.state.fields = [];
    mocks.state.progress = null;
    mocks.state.layout = [];
  });

  it('待复核能力隐藏，点击原图识别块仍可切回 Markdown 预览', async () => {
    mocks.state.mode = 'high-precision';
    mocks.state.attachment = imageAttachment();
    mocks.state.markdown = '低分文字';
    mocks.state.layout = [
      {
        id: 'low',
        kind: 'text',
        x: 0.2,
        y: 0.3,
        w: 0.4,
        h: 0.1,
        text: '低分文字',
        markdown: '低分文字',
        confidence: 0.4,
      },
    ];
    renderExperience();
    const user = userEvent.setup();
    const navigation = document.querySelector<HTMLElement>('[data-result-navigation]');
    const commands = document.querySelector<HTMLElement>('[data-result-commands]');
    expect(navigation).toContainElement(screen.getByRole('tablist'));
    expect(navigation).toContainElement(commands);
    expect(commands).toContainElement(screen.getByRole('button', { name: 'imageParseDownload' }));
    expect(navigation).toContainElement(screen.getByRole('button', { name: 'imageParseDownload' }));
    expect(screen.queryByRole('button', { name: 'copy' })).toBeNull();
    expect(screen.queryByRole('button', { name: /imageParseQualityShowMarkdown/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /imageParseQualityOverview/ }),
    ).not.toBeInTheDocument();
    const toolbar = screen.getByRole('banner');
    expect(within(toolbar).queryByText('imageParseHighPrecisionHint')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /imageParseReview/ })).toBeNull();
    const imageBlock = document.querySelector<HTMLElement>(
      '[data-pane="origin"] [data-origin-block-id]',
    )!;
    expect(imageBlock).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('tab', { name: 'imageParseSource' }));
    await user.click(imageBlock);
    expect(screen.getByRole('tab', { name: 'imageParsePreview' })).toHaveAttribute(
      'data-state',
      'active',
    );
    expect(document.querySelector('[data-review-block-id]')).toBeNull();
  });

  it('未上传文档时只显示上传区，顶部不显示新建识别', () => {
    renderExperience();

    expect(screen.getByText('imageParseUploadTitle')).toBeInTheDocument();
    expect(screen.queryByText('imageParseEmpty')).not.toBeInTheDocument();
    expect(document.querySelector('[data-pane="origin"]')).toHaveAttribute('data-state', 'empty');
    expect(document.querySelector('[data-pane="markdown"]')).not.toBeInTheDocument();
    expect(screen.getByLabelText('imageParseUploadAction', { selector: 'input' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'imageParseUploadAction' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'imageParseNewDocument' })).not.toBeInTheDocument();
  });

  it('已有文档时新建识别清空当前工作台并回到上传页', async () => {
    mocks.state.attachment = imageAttachment();
    renderExperience();
    const action = within(screen.getByRole('banner')).getByRole('button', {
      name: 'imageParseNewDocument',
    });
    expect(action).toBeEnabled();
    await userEvent.click(action);
    expect(mocks.setAttachment).toHaveBeenCalledWith(undefined);
    expect(screen.getByLabelText('imageParseAddPages', { selector: 'input' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('普通文档可以把新页面追加到当前文档并保留已有结果', async () => {
    mocks.state.attachment = imageAttachment();
    mocks.state.markdown = '第一页正文';
    mocks.state.layout = [
      {
        id: 'page-1',
        kind: 'text',
        x: 0.1,
        y: 0.1,
        w: 0.5,
        h: 0.1,
        text: '第一页正文',
        markdown: '第一页正文',
        confidence: 0.9,
      },
    ];
    renderExperience();
    const input = screen.getByLabelText('imageParseAddPages', { selector: 'input' });
    fireEvent.change(input, {
      target: { files: [new File(['png'], 'extra.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(mocks.appendDocument).toHaveBeenCalledOnce());
    const [attachment, snapshot] = mocks.appendDocument.mock.calls[0]!;
    expect(attachment).toMatchObject({
      kind: 'file',
      mime: 'application/pdf',
      name: 'page.pdf',
    });
    expect(snapshot).toMatchObject({ page: 2, pages: 2 });
    expect(snapshot.results[1].result.markdown).toBe('第一页正文');
  });

  it('追加时 PDF 和图片混选沿用上传错误，不改动当前文档', () => {
    mocks.state.attachment = imageAttachment();
    renderExperience();
    const input = screen.getByLabelText('imageParseAddPages', { selector: 'input' });
    fireEvent.change(input, {
      target: {
        files: [
          new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' }),
          new File(['png'], 'extra.png', { type: 'image/png' }),
        ],
      },
    });
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'documentOnePdf', variant: 'error' });
    expect(mocks.appendDocument).not.toHaveBeenCalled();
  });

  it('真实结果没有块分数时不显示待复核入口', () => {
    mocks.state.mode = 'high-precision';
    mocks.state.attachment = imageAttachment();
    mocks.state.markdown = '实际模型文字';
    renderExperience();
    expect(screen.queryByRole('tab', { name: /imageParseReview/ })).toBeNull();
    expect(screen.queryByText('imageParseQualityEmpty')).toBeNull();
    expect(document.querySelector('[data-review-block-id]')).toBeNull();
  });

  it('普通入口使用质量打分后显示原图识别框，不显示待复核标签', () => {
    mocks.state.mode = 'scored';
    mocks.state.attachment = imageAttachment();
    mocks.state.markdown = '待核对文字';
    mocks.state.layout = [
      {
        id: 'scored-text',
        kind: 'text',
        x: 0.1,
        y: 0.2,
        w: 0.4,
        h: 0.1,
        text: '待核对文字',
        markdown: '待核对文字',
        confidence: 0.4,
      },
    ];
    renderExperience();
    expect(
      screen.queryByRole('button', { name: 'imageParseModeStandard' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /imageParseReview/ })).toBeNull();
    expect(document.querySelector('[data-pane="origin"] [data-origin-block-id]')).not.toBeNull();
    expect(document.querySelector('[data-review-block-id="scored-text"]')).toBeNull();
  });

  it('标准模式有区块坐标时打开结果就显示原图识别框，无需切换到待复核', () => {
    mocks.state.attachment = imageAttachment({ id: 'image-parse-sample' });
    mocks.state.markdown = '示例正文';
    mocks.state.layout = [
      {
        id: 'sample-text',
        kind: 'text',
        x: 0.1,
        y: 0.2,
        w: 0.4,
        h: 0.1,
        text: '示例正文',
        markdown: '示例正文',
        confidence: null,
      },
    ];
    renderExperience();

    expect(screen.getByRole('tab', { name: 'imageParsePreview' })).toHaveAttribute(
      'data-state',
      'active',
    );
    expect(
      document.querySelector('[data-pane="origin"] button[data-origin-block-id="sample-text"]'),
    ).toBeInTheDocument();
  });

  it('offers local demo cases without a recognition mode switch or real attachment', async () => {
    renderExperience();
    expect(screen.getByText('imageParseUploadTitle')).toBeInTheDocument();
    expect(screen.getByText('imageParseUploadLead')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'imageParseWorkspaceExamples' }),
    ).toBeInTheDocument();
    const sample = screen.getByRole('button', { name: 'imageParseCasePhysics' });
    expect(screen.queryByRole('button', { name: 'imageParseModeScored' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'imageParseModeHighPrecision' }),
    ).not.toBeInTheDocument();
    await userEvent.click(sample);
    expect(mocks.exampleLoad).toHaveBeenCalledWith('physics');
    expect(mocks.setAttachment).not.toHaveBeenCalled();
    expect(screen.queryByText('imageParseEmpty')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'imageParseDownload' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'imageParseView' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'imageParseShowConfidence' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'imageParseModel' })).not.toBeInTheDocument();
  });

  it('平台案例恢复后自动转为个人上传，不要求手动点击识别', async () => {
    mocks.state.attachment = imageAttachment({
      id: 'example:physics',
      name: '手写物理笔记.png',
      dataUrl: 'data:image/png;base64,QQ==',
    });
    mocks.exampleSelectionRevision = 1;
    mocks.readFileAsAttachment.mockResolvedValueOnce({
      ok: true,
      attachment: imageAttachment({
        id: 'personal-upload',
        name: '手写物理笔记.png',
        fileId: 'file-personal',
      }),
    });
    renderExperience(modelStub({ userId: 'user-1', defaultProjectId: 'project-1' }));

    await waitFor(() =>
      expect(mocks.setAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'personal-upload',
          fileId: 'file-personal',
        }),
      ),
    );
    expect(mocks.readFileAsAttachment).toHaveBeenCalledOnce();
    const file = mocks.readFileAsAttachment.mock.calls[0]?.[0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('手写物理笔记.png');
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('上传页不展示文档识别设置，也不提供独立印章任务', () => {
    renderExperience();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'imageParseTaskDocument' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'imageParseTaskKie' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'imageParseRecognitionSettings' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Seal/ })).not.toBeInTheDocument();
  });

  it('uses direct workspace upload without a traditional model or an extra dialog', async () => {
    mocks.readPreviewAttachment.mockResolvedValue({
      ok: true,
      attachment: imageAttachment(),
    });
    renderExperience(
      modelStub({
        imageParseModels: [],
        imageParseModel: undefined,
      }),
    );
    expect(screen.queryByRole('combobox', { name: 'imageParseModel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const input = screen.getByLabelText('imageParseUploadAction', { selector: 'input' });
    fireEvent.change(input, {
      target: { files: [new File(['abc'], 'page.png', { type: 'image/png' })] },
    });
    await waitFor(() =>
      expect(mocks.setAttachment).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'page.png' }),
      ),
    );
    expect(mocks.readFileAsAttachment).toHaveBeenCalledOnce();
    expect(mocks.readPreviewAttachment).not.toHaveBeenCalled();
  });

  it('shows a comparison pane after an image is attached', () => {
    mocks.state.attachment = imageAttachment();
    mocks.state.canParse = true;
    renderExperience();
    expect(screen.getByText('imageParseReadyTitle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'imageParseStart' })).toBeEnabled();
    expect(document.querySelector('[data-pane="origin"]')).toHaveAttribute('data-state', 'split');
    expect(document.querySelector('[data-pane="markdown"]')).toHaveAttribute('data-state', 'split');
  });

  it('keeps the traditional model selector hidden', () => {
    mocks.state.attachment = imageAttachment();
    renderExperience(modelStub({ imageParseModels: [{ id: 'legacy', display_name: 'Legacy' }] }));
    expect(screen.queryByRole('combobox', { name: 'imageParseModel' })).not.toBeInTheDocument();
  });

  it('keeps both panes visible without a workspace view switch', async () => {
    mocks.state.attachment = imageAttachment();
    mocks.state.markdown = '| A | B |';
    renderExperience();
    expect(screen.queryByRole('group', { name: 'imageParseView' })).not.toBeInTheDocument();
    for (const name of ['imageParseViewOrigin', 'imageParseViewBoth', 'imageParseViewMarkdown']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(document.querySelector('[data-pane="origin"]')).toHaveAttribute('data-state', 'split');
    expect(document.querySelector('[data-pane="markdown"]')).toHaveAttribute('data-state', 'split');
    expect(document.querySelector('[data-pane="origin"]')?.className).not.toMatch(/opacity-/);
    expect(document.querySelector('[data-pane="markdown"]')?.className).not.toMatch(/opacity-/);
    // Both tabs stay mounted, so look for the result text only in the currently active panel
    const activePanel = document.querySelector<HTMLElement>(
      '[role="tabpanel"][data-state="active"]',
    );
    expect(activePanel).not.toBeNull();
    if (activePanel) {
      expect(within(activePanel).getByText('| A | B |')).toBeInTheDocument();
    }
  });

  it('lets the user regenerate after markdown arrives', () => {
    mocks.state.attachment = imageAttachment();
    mocks.state.markdown = '| A | B |';
    mocks.state.canParse = true;
    renderExperience();
    fireEvent.click(screen.getByRole('button', { name: 'imageParseReparse' }));
    expect(mocks.parse).toHaveBeenCalledTimes(1);
  });

  it('共享示例重新识别先还原为真实文件上传，再切换为个人附件', async () => {
    mocks.state.attachment = imageAttachment({
      id: 'example:physics',
      name: '手写课堂笔记.png',
      dataUrl: 'data:image/png;base64,QQ==',
    });
    mocks.state.markdown = '预采集结果';
    mocks.readFileAsAttachment.mockResolvedValueOnce({
      ok: true,
      attachment: imageAttachment({
        id: 'personal-upload',
        name: '手写课堂笔记.png',
        fileId: 'file-personal',
      }),
    });
    renderExperience(modelStub({ userId: 'user-1', defaultProjectId: 'project-1' }));

    const reparse = screen.getByRole('button', { name: 'imageParseReparse' });
    expect(reparse).toBeEnabled();
    await userEvent.click(reparse);

    expect(mocks.readFileAsAttachment).toHaveBeenCalledOnce();
    const file = mocks.readFileAsAttachment.mock.calls[0]?.[0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('手写课堂笔记.png');
    expect(file.type).toBe('image/png');
    await waitFor(() =>
      expect(mocks.setAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'personal-upload',
          fileId: 'file-personal',
        }),
      ),
    );
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('stops an in-flight parse without waiting for markdown', () => {
    mocks.state.attachment = imageAttachment();
    mocks.state.loading = true;
    renderExperience();
    fireEvent.click(screen.getByRole('button', { name: 'imageParseStop' }));
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps showing an error after a failed parse', () => {
    mocks.state.attachment = imageAttachment();
    mocks.state.error = 'imageParseNeedImage';
    renderExperience();
    expect(screen.getByRole('alert')).toHaveTextContent('imageParseNeedImage');
    expect(screen.getAllByRole('button', { name: 'imageParseRetry' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'imageParseReparse' })).not.toBeInTheDocument();
  });

  it('offers download but no one-click copy after a successful parse', async () => {
    mocks.state.attachment = imageAttachment();
    mocks.state.markdown = '| A | B |';
    renderExperience();

    expect(screen.getByRole('button', { name: 'imageParseDownload' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'copy' })).toBeNull();
  });

  it('shows an indeterminate progress panel while the service is processing', () => {
    mocks.state.attachment = imageAttachment();
    mocks.state.loading = true;
    renderExperience();
    expect(screen.getByRole('status')).toHaveTextContent('imageParseParsing');
    expect(
      screen.getByRole('progressbar', { name: 'imageParseProgressLabel' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('imageParseParsing').length).toBeGreaterThan(0);
    expect(screen.queryByText('imageParseStageLayout')).not.toBeInTheDocument();
    expect(screen.queryByText('imageParseStageStructure')).not.toBeInTheDocument();
    expect(screen.queryByText('imageParseStageRender')).not.toBeInTheDocument();
    expect(screen.queryByText('imageParseStageOcr')).not.toBeInTheDocument();
  });

  it('字段提取开始后显示处理状态而非禁用的字段表单', () => {
    mocks.state.attachment = imageAttachment();
    mocks.state.mode = 'kie';
    mocks.state.fields = ['发票号码'];
    mocks.state.loading = true;
    renderExperience();
    expect(
      screen.getByRole('progressbar', { name: 'imageParseProgressLabel' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'imageParseStartKie' })).not.toBeInTheDocument();
  });

  it('字段提取失败显示错误和重试，仍可重新编辑字段', () => {
    mocks.state.attachment = imageAttachment();
    mocks.state.mode = 'kie';
    mocks.state.fields = ['发票号码'];
    mocks.state.error = 'imageParseRequestFailed';
    mocks.state.canParse = true;
    renderExperience();
    expect(screen.getByRole('alert')).toHaveTextContent('imageParseRequestFailed');
    expect(screen.getByRole('button', { name: 'imageParseRetry' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'imageParseKieModifyFields' })).toBeEnabled();
  });

  it('关键信息抽取默认案例可选择并按案例预填字段', async () => {
    mocks.state.mode = 'kie';
    const fetchMock = vi.fn(
      async () => new Response(new Blob(['png']), { status: 200, statusText: 'OK' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderExperience(modelStub(), 'kie');
      expect(
        screen.queryByRole('button', { name: 'imageParseTourReplay' }),
      ).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'imageParseKieSampleTaxiTitle' }));
      await waitFor(() => expect(mocks.readFileAsAttachment).toHaveBeenCalled());
      const file = mocks.readFileAsAttachment.mock.calls[0]?.[0] as File;
      expect(file.name).toBe('出租车发票.png');
      expect(file.type).toBe('image/png');
      await waitFor(() =>
        expect(mocks.setFields).toHaveBeenCalledWith([
          'imageParseKieFieldInvoiceCode',
          'imageParseKieFieldInvoiceNumber',
          'imageParseKieFieldDate',
          'imageParseKieFieldAmount',
        ]),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('关键信息抽取入口恢复成普通模式时仍切回字段配置', async () => {
    mocks.state.attachment = imageAttachment({
      kind: 'file',
      name: '合同.pdf',
      mime: 'application/pdf',
      dataUrl: 'blob:contract-pdf',
    });
    mocks.state.mode = 'standard';
    mocks.state.canParse = true;
    mocks.setMode.mockImplementation((mode) => {
      mocks.state.mode = mode;
    });

    const view = renderExperience(modelStub(), 'kie');
    await waitFor(() => expect(mocks.setMode).toHaveBeenCalledWith('kie'));
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <TooltipProvider>
            <ImageParseExperience model={modelStub()} task="kie" />
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'imageParseKieAddField' }));
    expect(screen.getByLabelText('imageParseKieFieldInputLabel')).toBeInTheDocument();
  });

  it('keeps the edited draft and restores it with the reset action', async () => {
    mocks.state.attachment = imageAttachment();
    mocks.state.markdown = '原始文本';
    renderExperience();

    await userEvent.click(screen.getByRole('tab', { name: 'imageParseSource' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'imageParseSource' }), {
      target: { value: '改过的文本' },
    });

    expect(screen.getByText('imageParseEdited')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'imageParseSource' })).toHaveValue('改过的文本');

    await userEvent.click(screen.getByRole('button', { name: /imageParseResetDraft/ }));
    expect(screen.queryByText('imageParseEdited')).not.toBeInTheDocument();
  });

  it('keeps the inline edit from the preview in the saved draft', async () => {
    mocks.state.attachment = imageAttachment();
    mocks.state.markdown = '原始文本';
    renderExperience();

    fireEvent.doubleClick(within(screen.getByRole('article')).getByText('原始文本'));
    const editor = await screen.findByRole('textbox', { name: 'imageParseInlineEditor' });
    await userEvent.clear(editor);
    await userEvent.type(editor, '预览中改过的文本');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'imageParseEditorUndo' })).toBeEnabled(),
    );
    // Clicking outside the edited block blurs and saves, and the draft updates with it.
    fireEvent.pointerDown(screen.getByRole('article'));

    expect(screen.getByText('imageParseEdited')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'imageParseSource' }));
    expect(screen.getByRole('textbox', { name: 'imageParseSource' })).toHaveValue(
      '预览中改过的文本',
    );
  });

  it('does not show a global table-copy button in the result toolbar', () => {
    mocks.state.attachment = imageAttachment();
    mocks.state.markdown = '| 项目 | 金额 |\n| --- | --- |\n| 差旅 | 1,200 |';
    renderExperience();

    expect(screen.queryByRole('button', { name: /imageParseCopyTable/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /imageParseCopyRegion/ })).toBeNull();
  });

  it('shows a drop overlay when replacing the current image', () => {
    mocks.state.attachment = imageAttachment();
    const { container } = renderExperience();
    fireEvent.dragOver(container.firstChild as HTMLElement, {
      dataTransfer: { types: ['Files'] },
    });
    expect(screen.getByText('imageParseDropReplace')).toBeInTheDocument();
  });

  it('cancels an older replacement upload so the latest image wins', async () => {
    mocks.state.attachment = imageAttachment();
    let resolveLatest: ((value: { ok: true; attachment: Attachment }) => void) | undefined;
    let firstSignal: AbortSignal | undefined;
    mocks.readFileAsAttachment
      .mockImplementationOnce((_file: File, signal: AbortSignal) => {
        firstSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        });
      })
      .mockImplementationOnce(
        () =>
          new Promise<{ ok: true; attachment: Attachment }>((resolve) => {
            resolveLatest = resolve;
          }),
      );

    const { container } = renderExperience();
    const root = container.firstChild as HTMLElement;
    const first = new File(['a'], 'a.png', { type: 'image/png' });
    const latest = new File(['b'], 'b.png', { type: 'image/png' });

    fireEvent.drop(root, { dataTransfer: { types: ['Files'], files: [first] } });
    fireEvent.drop(root, { dataTransfer: { types: ['Files'], files: [latest] } });
    expect(firstSignal?.aborted).toBe(true);

    await act(async () => {
      resolveLatest?.({
        ok: true,
        attachment: imageAttachment({ id: 'att_latest', name: 'b.png' }),
      });
    });

    expect(mocks.setAttachment).toHaveBeenCalledTimes(3);
    expect(mocks.setAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'att_latest', name: 'b.png' }),
    );
  });

  it('does not offer invented layout JSON for actual model text', () => {
    mocks.state.attachment = imageAttachment();
    mocks.state.markdown = '# 结果';
    renderExperience();
    expect(screen.queryByRole('tab', { name: 'imageParseJson' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('imageParseJsonLabel')).not.toBeInTheDocument();
  });

  it('原图标签不显示比例值，点击从源码切回 Markdown', async () => {
    mocks.state.mode = 'high-precision';
    mocks.state.attachment = imageAttachment();
    mocks.state.markdown = '识别内容';
    mocks.state.layout = [
      {
        id: 'block-1',
        kind: 'text',
        x: 0.2,
        y: 0.3,
        w: 0.4,
        h: 0.1,
        text: '识别内容',
        markdown: '识别内容',
        confidence: 0.9,
      },
      {
        id: 'block-2',
        kind: 'text',
        x: 0.2,
        y: 0.5,
        w: 0.4,
        h: 0.1,
        text: '未提供',
        markdown: '',
        confidence: null,
      },
    ];
    renderExperience();
    expect(screen.queryByRole('tab', { name: /imageParseReview/ })).toBeNull();
    expect(screen.queryByRole('group', { name: 'imageParseBlocks' })).not.toBeInTheDocument();
    expect(screen.queryByText('imageParseConfidenceHint')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'imageParseSource' }));
    const block = document.querySelector<HTMLButtonElement>(
      '[data-pane="origin"] button[aria-label^="imageParseBlockNumber"]',
    );
    expect(block).not.toBeNull();
    if (!block) return;
    expect(block).not.toHaveTextContent('90%');
    expect(block).not.toHaveAttribute('title');
    await userEvent.click(block);
    expect(block).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('tab', { name: 'imageParsePreview' })).toHaveAttribute(
      'data-state',
      'active',
    );
    await userEvent.click(block);
    expect(block).toHaveAttribute('aria-pressed', 'true');
  });
});
