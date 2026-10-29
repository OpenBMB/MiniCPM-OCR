import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@map/ui';

import { setApplicationLocale } from '@/i18n';

import { PlaygroundTopBar } from './PlaygroundTopBar';

describe('PlaygroundTopBar', () => {
  it('使用实色卡片背景与内容区保持清晰分层', async () => {
    await setApplicationLocale('en-US');
    render(
      <MemoryRouter>
        <TooltipProvider>
          <PlaygroundTopBar
            models={[]}
            modelsLoading={false}
            modelId=""
            onSelectModel={vi.fn()}
            onOpenSettings={vi.fn()}
            onClear={vi.fn()}
            canClear={false}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );

    const header = screen.getByRole('banner');
    expect(header).toHaveClass('bg-card');
    expect(header).not.toHaveClass('bg-background/65', 'backdrop-blur-sm');
    expect(screen.getByRole('button', { name: 'Switch to Chinese' })).toHaveTextContent('中文');
  });
});
