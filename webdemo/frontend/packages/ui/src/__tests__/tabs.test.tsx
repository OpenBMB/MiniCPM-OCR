import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';

function Fixture() {
  return (
    <Tabs defaultValue="preview">
      <TabsList>
        <TabsTrigger value="preview">预览</TabsTrigger>
        <TabsTrigger value="source">原文</TabsTrigger>
      </TabsList>
      <TabsContent value="preview">预览内容</TabsContent>
      <TabsContent value="source">原文内容</TabsContent>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('should render a single sliding indicator hidden from screen readers', async () => {
    render(<Fixture />);
    const indicator = document.querySelector('[data-map-tabs-indicator]');
    expect(document.querySelectorAll('[data-map-tabs-indicator]')).toHaveLength(1);
    expect(indicator).toHaveAttribute('aria-hidden', 'true');
    // The first frame settles in place before the transition starts, so the transition class waits until the next frame.
    await waitFor(() => {
      expect(indicator?.className).toContain('transition-[transform,width,height]');
    });
    expect(indicator?.className).toContain('motion-reduce:transition-none');
  });

  it('should keep selected styling off the trigger so the indicator can slide', () => {
    render(<Fixture />);
    const trigger = screen.getByRole('tab', { name: '预览' });
    expect(trigger.className).toContain('data-[state=active]:text-foreground');
    expect(trigger.className).not.toContain('data-[state=active]:bg-card');
  });

  it('should switch panels on trigger click', async () => {
    render(<Fixture />);
    await userEvent.click(screen.getByRole('tab', { name: '原文' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('原文内容');
  });
});
