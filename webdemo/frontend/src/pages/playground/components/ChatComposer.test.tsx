import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@map/ui';
import '@/i18n';
import { ChatComposer } from './ChatComposer';

const toast = vi.fn();

vi.mock('@map/ui', async () => {
  const actual = await vi.importActual<typeof import('@map/ui')>('@map/ui');
  return {
    ...actual,
    useToast: () => ({ toast }),
  };
});

function renderComposer(extra: Partial<ComponentProps<typeof ChatComposer>> = {}) {
  const props: ComponentProps<typeof ChatComposer> = {
    thinkingDepth: 'off',
    onThinkingDepthChange: vi.fn(),
    showReasoning: true,
    webSearchAvailable: false,
    webSearch: false,
    onWebSearchChange: vi.fn(),
    loading: false,
    onSend: vi.fn(),
    onStop: vi.fn(),
    value: '你好',
    onValueChange: vi.fn(),
    ...extra,
  };
  render(
    <TooltipProvider>
      <ChatComposer {...props} />
    </TooltipProvider>,
  );
  return props;
}

describe('ChatComposer', () => {
  beforeEach(() => {
    toast.mockReset();
  });

  it('不在用户侧展示运行时基础上下文', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Asia/Shanghai' }),
    } as Intl.DateTimeFormat);

    renderComposer();

    expect(screen.queryByText('Asia/Shanghai')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('基础上下文：Asia/Shanghai')).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('当前模型开启联网能力时展示联网按钮', () => {
    renderComposer({ webSearchAvailable: true });

    expect(screen.getByRole('switch', { name: '联网搜索' })).toBeInTheDocument();
  });

  it('联网开启时开关用弱底强调，且输入框提示切换为联网文案', () => {
    renderComposer({ webSearchAvailable: true, webSearch: true });

    const toggle = screen.getByRole('switch', { name: '联网搜索' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    // 联网与思考是同级能力开关，开启态统一走弱底；实底只留给发送按钮
    expect(toggle).toHaveClass('bg-primary/10', 'text-primary');
    expect(toggle).not.toHaveClass('text-primary-foreground');
    expect(
      screen.getByPlaceholderText('联网搜索已开启，输入问题会先搜网页再作答'),
    ).toBeInTheDocument();
  });

  it('联网与思考开关的样式完全一致', () => {
    renderComposer({ webSearchAvailable: true, webSearch: true, thinkingDepth: 'on' });

    const webSearchToggle = screen.getByRole('switch', { name: '联网搜索' });
    const reasoningToggle = screen.getByRole('switch', { name: '思考深度' });
    expect(webSearchToggle.className).toBe(reasoningToggle.className);
  });

  it('联网关闭时开关保持弱化，输入框提示回到默认文案', () => {
    renderComposer({ webSearchAvailable: true, webSearch: false });

    const toggle = screen.getByRole('switch', { name: '联网搜索' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).not.toHaveClass('bg-primary/10');
    expect(screen.getByPlaceholderText('请输入问题，帮你深度解答')).toBeInTheDocument();
  });

  it('当前模型不支持联网时不展示联网按钮', () => {
    renderComposer({ webSearchAvailable: false });

    expect(screen.queryByRole('switch', { name: '联网搜索' })).not.toBeInTheDocument();
  });

  it('发送条件不满足时点击发送给出友好提示', () => {
    const props = renderComposer({
      disabled: true,
      disabledReason: '暂无可用 API Key，请先创建或启用 API Key 后再发送',
    });

    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(props.onSend).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      title: '暂无可用 API Key，请先创建或启用 API Key 后再发送',
      variant: 'error',
    });
  });

  it('文本模型隐藏附件上传入口', () => {
    renderComposer({ attachmentCapabilities: { input_text: true } });

    expect(screen.queryByRole('button', { name: '上传附件' })).not.toBeInTheDocument();
  });

  it('视觉模型的文件选择器只接受图片', () => {
    renderComposer({ attachmentCapabilities: { input_text: true, input_image: true } });

    expect(document.querySelector<HTMLInputElement>('input[type="file"]')?.accept).toBe(
      'image/jpeg,image/png,image/webp,image/gif',
    );
  });

  it('上传提示展示当前模型支持的附件类型', async () => {
    renderComposer({ attachmentCapabilities: { input_image: true, input_audio: true } });

    fireEvent.pointerMove(screen.getByRole('button', { name: '上传附件' }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('支持上传：图片、音频');
  });
});
