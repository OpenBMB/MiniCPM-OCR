import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@map/ui';
import { ImageParseRecognitionSettings } from './ImageParseRecognitionSettings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderSettings(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe('全文识别设置', () => {
  afterEach(cleanup);
  it('印章、图表与旋转自适应支持受控切换', async () => {
    const sealChange = vi.fn();
    const uprightChange = vi.fn();
    function Settings() {
      const [seal, setSeal] = useState(true);
      const [upright, setUpright] = useState(true);
      const [chart, setChart] = useState(true);
      return (
        <ImageParseRecognitionSettings
          upright={upright}
          onUprightChange={(value) => {
            setUpright(value);
            uprightChange(value);
          }}
          recognizeSeal={seal}
          onRecognizeSealChange={(value) => {
            setSeal(value);
            sealChange(value);
          }}
          recognizeChart={chart}
          onRecognizeChartChange={(value) => setChart(value)}
        />
      );
    }
    renderSettings(<Settings />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'imageParseRecognitionSettings' }));
    const seal = screen.getByRole('switch', { name: 'imageParseRecognizeSeal' });
    expect(seal).toHaveAttribute('aria-checked', 'true');
    const chart = screen.getByRole('switch', { name: 'imageParseRecognizeChart' });
    const upright = screen.getByRole('switch', { name: 'imageParseUpright' });
    expect(seal.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chart.compareDocumentPosition(upright) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(seal);
    expect(sealChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(seal).toHaveAttribute('aria-checked', 'false');
    expect(upright).toHaveAttribute('aria-checked', 'true');
    await user.click(upright);
    expect(uprightChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(upright).toHaveAttribute('aria-checked', 'false');
    expect(chart).toHaveAttribute('aria-checked', 'true');
    await user.click(chart);
    expect(chart).toHaveAttribute('aria-checked', 'false');
    const sealInfo = screen.getByRole('button', {
      name: /imageParseRecognizeSealHint/,
    });
    expect(sealInfo).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /imageParseRecognizeChartHint/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /imageParseUprightHint/ })).toBeInTheDocument();
    await user.hover(sealInfo);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('imageParseRecognizeSealHint');
    fireEvent.pointerDown(
      document.querySelector('[data-tour="image-parse-recognition-settings"]')!,
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('支持键盘打开和切换', async () => {
    const change = vi.fn();
    renderSettings(
      <ImageParseRecognitionSettings
        upright
        onUprightChange={vi.fn()}
        recognizeSeal
        onRecognizeSealChange={change}
      />,
    );
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(change).toHaveBeenCalledWith(false);
  });

  it('暴露新手引导目标', () => {
    renderSettings(
      <ImageParseRecognitionSettings
        upright
        onUprightChange={vi.fn()}
        recognizeSeal
        onRecognizeSealChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'imageParseRecognitionSettings' })).toHaveAttribute(
      'data-tour',
      'image-parse-recognition-settings',
    );
  });

  it('请求期间禁用设置入口', async () => {
    renderSettings(
      <ImageParseRecognitionSettings
        upright
        onUprightChange={vi.fn()}
        recognizeSeal
        onRecognizeSealChange={vi.fn()}
        disabled
      />,
    );
    const trigger = screen.getByRole('button', { name: 'imageParseRecognitionSettings' });
    expect(trigger).toBeDisabled();
    await userEvent.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
