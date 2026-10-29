import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@map/store';
import { TooltipProvider } from '@map/ui';

import { ImageParseToolbar } from './ImageParseToolbar';
import { IMAGE_PARSE_SAMPLE_BLOCKS } from '../../utils/__tests__/imageParseSampleFixtures';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const parse = {
  snapshot: null,
  restore: vi.fn(),
  resultKey: 'document',
  documentKey: 'document',
  resultKeyForPage: () => 'document',
  attachment: {
    id: 'document',
    kind: 'image',
    name: 'scan.png',
    mime: 'image/png',
    size: 12,
    dataUrl: '/scan.png',
  },
  setAttachment: vi.fn(),
  markdown: '',
  mode: 'high-precision',
  fields: [],
  upright: true,
  setUpright: vi.fn(),
  recognizeSeal: true,
  setMode: vi.fn(),
  setFields: vi.fn(),
  setRecognizeSeal: vi.fn(),
  recognizeChart: true,
  setRecognizeChart: vi.fn(),
  loading: false,
  finished: false,
  error: undefined,
  progress: null,
  layout: [],
  crops: [],
  pdf: undefined,
  blockedReason: undefined,
  parse: vi.fn(),
  stop: vi.fn(),
  appendDocument: vi.fn(),
  clear: vi.fn(),
  canParse: false,
} satisfies ComponentProps<typeof ImageParseToolbar>['parse'];

describe('文档解析顶栏', () => {
  it('文件标题与侧栏文档解析入口统一使用扫描文字图标', () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <ImageParseToolbar
            fileName={parse.attachment.name}
            parse={parse}
            uploading={false}
            onNewDocument={vi.fn()}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    const toolbar = screen.getByRole('banner');
    expect(toolbar.querySelector('.lucide-scan-text')).toHaveClass('size-4');
    expect(toolbar.querySelector('.lucide-scan-text')).toHaveAttribute('aria-hidden', 'true');
    expect(toolbar.querySelector('.lucide-file-scan')).toBeNull();
    expect(screen.getByRole('button', { name: /language\.switchTo(English|Chinese)/ })).toHaveTextContent(
      /^(EN|中文)$/,
    );
    expect(screen.getByText('scan.png')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'imageParseNewDocument' })).toHaveAttribute(
      'data-tour',
      'image-parse-upload',
    );
  });

  it('文件标题栏不再展示评分说明入口，有评分时也不占用标题空间', () => {
    function toolbar(layout: typeof parse.layout | typeof IMAGE_PARSE_SAMPLE_BLOCKS) {
      return (
        <MemoryRouter>
          <TooltipProvider>
            <ImageParseToolbar
              fileName={parse.attachment.name}
              parse={{ ...parse, layout }}
              uploading={false}
              onNewDocument={vi.fn()}
            />
          </TooltipProvider>
        </MemoryRouter>
      );
    }
    const { rerender } = render(toolbar(IMAGE_PARSE_SAMPLE_BLOCKS));
    expect(screen.queryByRole('button', { name: 'imageParseScoreHelp' })).toBeNull();
    expect(screen.getByRole('banner').querySelector('.lucide-info')).toBeNull();
    rerender(toolbar([]));
    expect(screen.queryByRole('button', { name: 'imageParseScoreHelp' })).toBeNull();
    rerender(toolbar(IMAGE_PARSE_SAMPLE_BLOCKS.map((block) => ({ ...block, confidence: null }))));
    expect(screen.queryByRole('button', { name: 'imageParseScoreHelp' })).toBeNull();
  });

  it('顶栏同时提供追加页面与新建识别，追加页交给当前识别链路', () => {
    const onAppendPages = vi.fn();
    render(
      <MemoryRouter>
        <TooltipProvider>
          <ImageParseToolbar
            fileName={parse.attachment.name}
            parse={parse}
            uploading={false}
            onNewDocument={vi.fn()}
            onAppendPages={onAppendPages}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    const append = screen.getByRole('button', { name: 'imageParseAddPages' });
    expect(append).toHaveTextContent('imageParseAddPages');
    expect(append.querySelector('.lucide-file-plus-2')).toBeInTheDocument();
    expect(append).not.toHaveClass('border', 'bg-background');

    const input = screen.getByLabelText('imageParseAddPages', { selector: 'input' });
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('multiple');
    expect(input.getAttribute('accept')).toContain('application/pdf');
    expect(input.getAttribute('accept')).toContain('image/png');
    const file = new File(['png'], 'extra.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onAppendPages).toHaveBeenCalledWith([file]);

    const create = screen.getByRole('button', { name: 'imageParseNewDocument' });
    expect(create).toHaveClass('h-8');
    expect(create).not.toHaveClass('border', 'bg-background', 'bg-primary');
    expect(create).toHaveTextContent('imageParseNewDocument');
    expect(create.querySelector('.lucide-square-pen')).toBeInTheDocument();
  });

  it('新建识别回到上传工作台，不直接打开文件选择器', async () => {
    const onNewDocument = vi.fn();
    render(
      <MemoryRouter>
        <TooltipProvider>
          <ImageParseToolbar parse={parse} uploading={false} onNewDocument={onNewDocument} />
        </TooltipProvider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'imageParseNewDocument' }));
    expect(onNewDocument).toHaveBeenCalledOnce();
    expect(screen.getByRole('banner').querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('识别进行中仍可新建识别，但暂停追加并保留独立停止操作', async () => {
    const onNewDocument = vi.fn();
    render(
      <MemoryRouter>
        <TooltipProvider>
          <ImageParseToolbar
            parse={{ ...parse, loading: true }}
            uploading={false}
            onNewDocument={onNewDocument}
            onAppendPages={vi.fn()}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    const upload = screen.getByRole('button', { name: 'imageParseNewDocument' });
    expect(upload).toBeEnabled();
    expect(screen.getByRole('button', { name: 'imageParseAddPages' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'imageParseStop' }));
    expect(parse.stop).toHaveBeenCalledOnce();
    expect(onNewDocument).not.toHaveBeenCalled();
    await userEvent.click(upload);
    expect(onNewDocument).toHaveBeenCalledOnce();
  });

  it('识别完成但没有文字时使用重新识别文案', () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <ImageParseToolbar
            parse={{ ...parse, finished: true, canParse: true }}
            uploading={false}
            onNewDocument={vi.fn()}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'imageParseReparse' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'imageParseReparse' })).not.toHaveClass(
      'border',
      'bg-background',
      'bg-primary',
    );
    expect(screen.queryByRole('button', { name: 'imageParseStart' })).not.toBeInTheDocument();
  });

  it('追加中同时禁用追加与新建入口', () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <ImageParseToolbar
            parse={parse}
            uploading
            appending
            onNewDocument={vi.fn()}
            onAppendPages={vi.fn()}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'imageParseNewDocument' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'imageParseAddingPages' })).toBeDisabled();
  });

  it('字段提取等单图任务不显示追加页面入口', () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <ImageParseToolbar
            parse={{ ...parse, mode: 'kie', fields: ['发票号码'] }}
            uploading={false}
            onNewDocument={vi.fn()}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'imageParseAddPages' })).toBeNull();
    expect(screen.getByRole('button', { name: 'imageParseNewDocument' })).toBeInTheDocument();
  });

  it.each(['upload', 'fields', 'extracting', 'result'])(
    '信息抽取在 %s 阶段不显示步骤进度条',
    (phase) => {
      render(
        <MemoryRouter>
          <TooltipProvider>
            <ImageParseToolbar
              parse={{
                ...parse,
                mode: 'kie',
                fields: ['发票号码'],
                attachment: phase === 'upload' ? undefined : parse.attachment,
                loading: phase === 'extracting',
                finished: phase === 'result',
              }}
              uploading={false}
              onNewDocument={vi.fn()}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
      expect(screen.getByRole('banner')).toBeInTheDocument();
      expect(
        screen.queryByRole('navigation', { name: 'imageParseKieWorkflow' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('imageParseKieStepUpload')).not.toBeInTheDocument();
      expect(screen.queryByText('imageParseKieStepFields')).not.toBeInTheDocument();
      expect(screen.queryByText('imageParseKieStepResult')).not.toBeInTheDocument();
      expect(screen.queryByText('imageParseKieStepExtracting')).not.toBeInTheDocument();
    },
  );

  it('信息抽取未配置字段时禁用抽取入口并说明原因', () => {
    const { rerender } = render(
      <MemoryRouter>
        <TooltipProvider>
          <ImageParseToolbar
            fileName={parse.attachment.name}
            parse={{ ...parse, canParse: true, mode: 'kie', fields: [] }}
            uploading={false}
            onNewDocument={vi.fn()}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    const extract = screen.getByRole('button', { name: 'imageParseStartKie' });
    expect(extract).toBeDisabled();
    expect(extract).toHaveAttribute('title', 'imageParseKieFieldsRequired');

    rerender(
      <MemoryRouter>
        <TooltipProvider>
          <ImageParseToolbar
            fileName={parse.attachment.name}
            parse={{ ...parse, canParse: true, mode: 'kie', fields: ['发票号码'] }}
            uploading={false}
            onNewDocument={vi.fn()}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'imageParseStartKie' })).toBeEnabled();
  });

  it.each([false, true])('空态或已有文档均不常驻引导入口：有文档=%s', (hasImage) => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <ImageParseToolbar
            parse={{ ...parse, attachment: hasImage ? parse.attachment : undefined }}
            uploading={false}
            onNewDocument={vi.fn()}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'imageParseTourReplay' })).not.toBeInTheDocument();
    expect(parse.parse).not.toHaveBeenCalled();
  });

  it('文档解析和信息抽取分别跳转对应 API 文档', () => {
    useAppStore.setState({ locale: 'zh-CN' });
    const { rerender } = render(
      <MemoryRouter>
        <TooltipProvider>
          <ImageParseToolbar parse={parse} uploading={false} onNewDocument={vi.fn()} />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'API 文档' })).toHaveAttribute(
      'href',
      'https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/webdemo_deploy_zh.md',
    );

    rerender(
      <MemoryRouter>
        <TooltipProvider>
          <ImageParseToolbar
            parse={{ ...parse, mode: 'kie' }}
            uploading={false}
            onNewDocument={vi.fn()}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'API 文档' })).toHaveAttribute(
      'href',
      '/docs/api/kie',
    );
  });

  it('上传页和已有文档顶栏都不展示独立识别设置', () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <ImageParseToolbar
            parse={{ ...parse, attachment: undefined }}
            uploading={false}
            onNewDocument={vi.fn()}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole('button', { name: 'imageParseRecognitionSettings' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'imageParseSettings' })).toBeNull();
  });
});
