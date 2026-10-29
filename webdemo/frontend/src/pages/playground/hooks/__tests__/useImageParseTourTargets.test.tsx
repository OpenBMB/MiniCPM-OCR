import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@map/store';
import { Button, TooltipProvider } from '@map/ui';

import { useImageParseTour } from '../useImageParseTour';
import { ImageParseDisplaySettings } from '../../components/experiences/ImageParseDisplaySettings';
import { ImageParseRecognitionSettings } from '../../components/experiences/ImageParseRecognitionSettings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/** 使用真实 driver.js 验证选择平台示例后的目标挂载与自动前进，不调用 OCR。 */
function TourWorkspace({
  existing = false,
  settingsReady = true,
}: {
  existing?: boolean;
  settingsReady?: boolean;
}) {
  const [hasDocument, setHasDocument] = useState(existing);
  const { replay } = useImageParseTour({
    userId: 'tour-target-user',
    enabled: true,
    hasDocument,
    resultReady: hasDocument && settingsReady,
  });
  return (
    <TooltipProvider>
      <Button onClick={replay}>replay</Button>
      {hasDocument ? (
        <>
          {settingsReady ? (
            <ImageParseRecognitionSettings
              upright
              onUprightChange={vi.fn()}
              recognizeSeal
              onRecognizeSealChange={vi.fn()}
            />
          ) : (
            <span>loading recognition settings</span>
          )}
          <ImageParseDisplaySettings showBlocks hasBlocks onToggleBlocks={vi.fn()} />
          <div data-pane="markdown">
            <div data-edit-block="0">result</div>
          </div>
          <Button data-tour="image-parse-download">download</Button>
        </>
      ) : (
        <Button data-tour="image-parse-examples" onClick={() => setHasDocument(true)}>
          platform examples
        </Button>
      )}
    </TooltipProvider>
  );
}

async function expectStep(title: string, selector?: string) {
  await waitFor(() =>
    expect(document.querySelector('.driver-popover-title')).toHaveTextContent(title),
  );
  if (selector) {
    await waitFor(() =>
      expect(document.querySelector(selector)).toHaveClass('driver-active-element'),
    );
  }
}

async function next() {
  await act(async () => fireEvent.click(document.querySelector('.driver-popover-next-btn')!));
}

async function previous() {
  await act(async () => fireEvent.click(document.querySelector('.driver-popover-prev-btn')!));
}

describe('文档解析引导真实目标回归', () => {
  beforeEach(() => {
    useAppStore.setState({
      playground: { ...useAppStore.getState().playground, seenTours: [] },
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(100, 100, 160, 40),
    );
    vi.stubGlobal('scrollTo', vi.fn());
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('空态选择平台示例后自动进入结果区，后续步骤可前进和返回', async () => {
    render(<TourWorkspace />);
    await expectStep('imageParseTourExampleTitle', '[data-tour="image-parse-examples"]');
    expect(document.querySelector('.driver-popover-next-btn')).toBeVisible();
    expect(document.querySelector('.driver-popover-next-btn')).toHaveTextContent(
      'imageParseTourNext',
    );
    expect(document.querySelector('.driver-popover-close-btn')).toBeVisible();

    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'platform examples' })),
    );
    await expectStep(
      'imageParseTourRecognitionSettingsTitle',
      '[data-tour="image-parse-recognition-settings"]',
    );
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /imageParseRecognizeSeal/ })).toBeVisible(),
    );
    expect(screen.getByRole('switch', { name: /imageParseRecognizeChart/ })).toBeVisible();
    expect(screen.getByRole('switch', { name: /imageParseUpright/ })).toBeVisible();
    expect(document.body).toHaveClass('map-tour-settings-showcase');
    expect(screen.getByRole('button', { name: 'imageParseTourNext' })).toBeVisible();
    // 示例步骤的目标已卸载，回退按钮应禁用，避免落到无目标的居中遮罩。
    await waitFor(() => expect(document.querySelector('.driver-popover-prev-btn')).toBeDisabled());
    fireEvent.click(document.querySelector('.driver-popover-prev-btn')!);
    await expectStep(
      'imageParseTourRecognitionSettingsTitle',
      '[data-tour="image-parse-recognition-settings"]',
    );
    expect(document.querySelector('.driver-popover-progress-text')).toHaveTextContent('2 / 5');
    await next();
    await expectStep('imageParseTourOriginTitle', '[data-tour="image-parse-confidence-toggle"]');
    expect(document.body).toHaveClass('map-tour-settings-showcase');
    await waitFor(() =>
      expect(
        screen.getByRole('menuitemcheckbox', { name: 'imageParseShowConfidence' }),
      ).toBeVisible(),
    );
    expect(screen.getByRole('button', { name: 'imageParseTourNext' })).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('switch', { name: /imageParseRecognizeSeal/ })).toBeNull(),
    );
    await next();
    await expectStep('imageParseTourEditTitle', '[data-edit-block]');
    expect(document.body).not.toHaveClass('map-tour-settings-showcase');
    await waitFor(() =>
      expect(
        screen.queryByRole('menuitemcheckbox', { name: 'imageParseShowConfidence' }),
      ).toBeNull(),
    );
    await next();
    await expectStep('imageParseTourExportTitle', '[data-pane="markdown"]');
    expect(document.querySelector('[data-tour="image-parse-download"]')).toBeInTheDocument();
    await previous();
    await expectStep('imageParseTourEditTitle');
    await next();
    await expectStep('imageParseTourExportTitle');
    expect(document.querySelector('.driver-popover-progress-text')).toHaveTextContent('5 / 5');
    expect(document.querySelector('.driver-popover-next-btn')).toHaveTextContent(
      'imageParseTourDone',
    );
  }, 15_000);

  it('已有文档重播时跳过示例步骤，从识别设置开始', async () => {
    render(<TourWorkspace existing />);
    await expectStep(
      'imageParseTourRecognitionSettingsTitle',
      '[data-tour="image-parse-recognition-settings"]',
    );
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /imageParseRecognizeSeal/ })).toBeVisible(),
    );
    expect(screen.getByRole('switch', { name: /imageParseRecognizeChart/ })).toBeVisible();
    expect(screen.getByRole('switch', { name: /imageParseUpright/ })).toBeVisible();
    expect(document.querySelector('.driver-popover-progress-text')).toHaveTextContent('1 / 4');

    await next();
    await expectStep('imageParseTourOriginTitle', '[data-tour="image-parse-confidence-toggle"]');
    expect(document.querySelector('.driver-popover-progress-text')).toHaveTextContent('2 / 4');

    fireEvent.click(document.querySelector('.driver-popover-close-btn')!);
    await waitFor(() => expect(document.querySelector('.driver-popover')).toBeNull());
    fireEvent.click(screen.getByText('replay'));
    await expectStep('imageParseTourRecognitionSettingsTitle');
  });

  it('识别设置晚于文档挂载时，等到目标出现后再高亮', async () => {
    const { rerender } = render(<TourWorkspace settingsReady={false} />);
    await expectStep('imageParseTourExampleTitle');

    fireEvent.click(screen.getByRole('button', { name: 'platform examples' }));
    expect(
      document.querySelector('[data-tour="image-parse-recognition-settings"]'),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.driver-overlay')).toBeNull());

    rerender(<TourWorkspace settingsReady />);
    await expectStep(
      'imageParseTourRecognitionSettingsTitle',
      '[data-tour="image-parse-recognition-settings"]',
    );
  });

  it('目标移动或尺寸变化时，同步重新定位遮罩和提示框', async () => {
    let targetRect = new DOMRect(100, 100, 160, 40);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.matches('[data-tour="image-parse-confidence-toggle"]')
        ? targetRect
        : new DOMRect(100, 100, 160, 40);
    });
    render(<TourWorkspace />);
    await expectStep('imageParseTourExampleTitle');
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'platform examples' })),
    );
    await expectStep(
      'imageParseTourRecognitionSettingsTitle',
      '[data-tour="image-parse-recognition-settings"]',
    );
    await next();
    await expectStep('imageParseTourOriginTitle', '[data-tour="image-parse-confidence-toggle"]');
    const overlay = () => document.querySelector('.driver-overlay path')!.getAttribute('d');
    const popover = document.querySelector<HTMLElement>('.driver-popover')!;
    await waitFor(() => expect(overlay()).toContain('M102,96 h156'));
    // 等 driver 的 400ms 切步动画与一次性 refresh 结束，避免它掩盖后续布局偏移。
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 500)));
    const initialPosition = popover.style.cssText;

    targetRect = new DOMRect(60, 180, 160, 40);
    await waitFor(() => expect(overlay()).toContain('M62,176 h156'));
    await waitFor(() => expect(popover.style.cssText).not.toBe(initialPosition));

    targetRect = new DOMRect(60, 180, 200, 44);
    await waitFor(() => expect(overlay()).toContain('M62,176 h196'));
    expect(document.querySelector('.driver-popover-progress-text')).toHaveTextContent('3 / 5');
  });
});
