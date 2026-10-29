import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { setApplicationLocale } from '@/i18n';
import { VOICES, type DuplexSettings } from '../../hooks/useDuplexSettings';
import type { usePlaygroundModel } from '../../hooks/usePlaygroundModel';
import { createSessionMetrics } from '../../utils/realtimeSessionMetrics';
import { DuplexSidePanel } from './DuplexSidePanel';

type PlaygroundModel = ReturnType<typeof usePlaygroundModel>;

const SETTINGS: DuplexSettings = {
  audioSource: 'mic',
  voice: 'female_warm',
  scene: 'audio_chinese_call',
  language: 'zh',
  languageMode: 'manual',
  system: 'system prompt',
  outputAudio: true,
  lengthPenalty: 1.05,
  maxTokens: 1024,
  maxKvTokens: 8192,
  temperature: 0.7,
  ttsEnabled: true,
  visionHD: false,
  playbackDelay: 200,
  responseLengthPreset: 'balanced',
  subtitleHeightPercent: 20,
  subtitleBottomOpacity: 80,
  subtitleTopOpacity: 30,
  micDeviceId: '',
  speakerDeviceId: '',
};

function createModel(): PlaygroundModel {
  return {
    userLoading: false,
    models: [],
    modelsLoading: false,
    modelId: '',
    selectModel: vi.fn(),
    ttsModels: [],
    selectTtsModel: vi.fn(),
    realtimeModels: [],
    selectRealtimeModel: vi.fn(),
    imageParseModels: [],
    selectImageParseModel: vi.fn(),
    keysLoading: false,
    hasKeys: false,
    keyId: '',
    secretReady: false,
    secretLoading: false,
    secretError: false,
    trialRemaining: {
      language: 0,
      tts: 0,
      realtime: 0,
      'image-parse': 0,
    },
    trialLoading: false,
    trialError: false,
    trialAvailable: false,
    getSecret: vi.fn(),
    refreshTrial: vi.fn(),
  };
}

function renderPanel(onAudioSource = vi.fn()) {
  return render(
    <MemoryRouter>
      <DuplexSidePanel
        model={createModel()}
        sources={[
          { value: 'mic', label: 'audioDuplex' },
          { value: 'both', label: 'videoDuplex' },
        ]}
        voices={VOICES}
        settings={SETTINGS}
        patch={vi.fn()}
        onVoiceChange={vi.fn()}
        selectLanguage={vi.fn()}
        onAudioSource={onAudioSource}
        mics={[]}
        speakers={[]}
        onRefreshDevices={vi.fn()}
        onReset={vi.fn()}
        status="idle"
        rounds={0}
        locked={false}
        metrics={createSessionMetrics('test-session')}
      />
    </MemoryRouter>,
  );
}

describe('DuplexSidePanel 模式选择', () => {
  afterEach(async () => {
    await setApplicationLocale('zh-CN');
  });

  it('只保留音频和视频双工的唯一模式入口', () => {
    renderPanel();

    expect(screen.getAllByRole('button', { name: '音频双工' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '视频双工' })).toHaveLength(1);
    expect(screen.queryByText('设置')).not.toBeInTheDocument();
    expect(screen.queryByText('中文通话（音频双工）')).not.toBeInTheDocument();
  });

  it('点击视频双工只通过模式入口触发联动', () => {
    const onAudioSource = vi.fn();
    renderPanel(onAudioSource);

    fireEvent.click(screen.getByRole('button', { name: '视频双工' }));

    expect(onAudioSource).toHaveBeenCalledWith('both');
  });

  it('固定 Tab 顶栏并让每个内容面板独立滚动', () => {
    const { container } = renderPanel();

    const aside = container.querySelector('aside');
    const tabs = screen.getByRole('tablist').parentElement;
    const panels = Array.from(container.querySelectorAll<HTMLElement>('[role="tabpanel"]'));

    expect(aside).toHaveClass('overflow-hidden');
    expect(aside).not.toHaveClass('overflow-y-auto');
    expect(tabs).toHaveClass('flex', 'min-h-0', 'flex-1', 'flex-col', 'overflow-hidden');
    expect(panels).toHaveLength(3);
    panels.forEach((panel) => {
      expect(panel).toHaveClass(
        'min-h-0',
        'flex-1',
        'overflow-y-auto',
        'overlay-scroll',
        'data-[state=inactive]:hidden',
      );
    });
  });

  it('切换 Tab 时保留内容面板并激活轻量进入动效', () => {
    const { container } = renderPanel();
    const callPanel = container.querySelector<HTMLElement>(
      '[role="tabpanel"][data-state="active"]',
    );

    fireEvent.mouseDown(screen.getByRole('tab', { name: '高级' }), {
      button: 0,
      ctrlKey: false,
    });

    const panels = Array.from(container.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
    const advancedPanel = container.querySelector<HTMLElement>(
      '[role="tabpanel"][data-state="active"]',
    );

    expect(panels).toHaveLength(3);
    expect(callPanel).toHaveAttribute('data-state', 'inactive');
    expect(advancedPanel).toHaveAccessibleName('高级');
    expect(advancedPanel).toHaveClass(
      'data-[state=active]:animate-[map-tab-content-in_160ms_ease-out]',
    );
  });

  it('高级参数的数字输入共享输入列和单位列', () => {
    const { container } = renderPanel();

    fireEvent.mouseDown(screen.getByRole('tab', { name: '高级' }), {
      button: 0,
      ctrlKey: false,
    });

    const maxKvInput = screen.getByRole('spinbutton', { name: /最大 KV/ });
    const lengthPenaltyInput = screen.getByRole('spinbutton', { name: /长度惩罚/ });
    const maxKvRow = maxKvInput.closest('label');
    const lengthPenaltyRow = lengthPenaltyInput.closest('label');
    const numberFieldGroup = container.querySelector('[data-number-field-group]');

    expect(numberFieldGroup).toHaveClass(
      'grid-cols-[minmax(0,1fr)_5rem_auto]',
      'gap-x-2',
      'gap-y-3',
    );
    expect(maxKvRow).toHaveClass('col-span-3', 'grid-cols-subgrid');
    expect(lengthPenaltyRow).toHaveClass('col-span-3', 'grid-cols-subgrid');
  });

  it('回复长度数值使用无背景无边框的纯文本样式', () => {
    renderPanel();

    const value = screen.getByText('1.05');

    expect(value).toHaveClass('font-mono', 'tabular-nums', 'text-foreground');
    expect(value).not.toHaveClass('rounded-md', 'border', 'bg-muted/40', 'px-2', 'py-1');
  });

  it('底部操作和指标区使用轻量无底板样式', () => {
    renderPanel();

    const resetButton = screen.getByRole('button', { name: '恢复默认配置' });
    const metricsSummary = screen.getByText('指标').closest('summary');
    const metricsPanel = metricsSummary?.closest('details');

    expect(resetButton).toHaveClass('self-start', 'text-muted-foreground');
    expect(resetButton).not.toHaveClass('border', 'bg-background');
    expect(resetButton.querySelector('svg')).toBeInTheDocument();
    expect(metricsPanel).toHaveClass('border-t', 'border-border/60', 'pt-3');
    expect(metricsPanel).not.toHaveClass('rounded-xl', 'bg-muted/40', 'p-3');
    expect(metricsSummary).toHaveClass('flex', 'items-center', 'text-muted-foreground');
    expect(metricsSummary?.querySelector('svg')).toBeInTheDocument();
  });
});
