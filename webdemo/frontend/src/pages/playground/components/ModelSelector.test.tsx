import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@map/ui';
import type { MapModel } from '@/api/map';
import { ModelSelector } from './ModelSelector';

const mobileState = vi.hoisted(() => ({ value: false }));

vi.mock('@/hooks/useResponsive', () => ({
  useBreakpoint: () => mobileState.value,
}));

const models: MapModel[] = [
  {
    id: 'model-a',
    display_name: '模型 A',
    context_window: 8192,
    max_output_tokens: 4096,
    capabilities: {},
  },
  {
    id: 'model-b',
    display_name: '模型 B',
    context_window: 16384,
    max_output_tokens: 4096,
    capabilities: {},
  },
];

describe('ModelSelector', () => {
  it('should size the trigger to its content instead of stretching across the top bar', () => {
    render(
      <TooltipProvider>
        <ModelSelector models={models} loading={false} value="model-a" onChange={vi.fn()} />
      </TooltipProvider>,
    );

    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveClass('w-auto', 'max-w-full', 'min-w-0');
    expect(trigger).not.toHaveClass('w-full');
    expect(trigger.parentElement).not.toHaveClass('flex-1');
  });

  it('should open upward on mobile so the composer remains visible', () => {
    render(
      <TooltipProvider>
        <ModelSelector models={models} loading={false} value="model-a" onChange={vi.fn()} />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole('combobox'));

    expect(screen.getByRole('listbox')).toHaveAttribute('data-side', 'top');
  });
});
