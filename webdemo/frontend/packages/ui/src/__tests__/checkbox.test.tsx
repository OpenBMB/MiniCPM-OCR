import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Checkbox } from '../components/ui/checkbox';

describe('Checkbox', () => {
  it('should render a semantic checkbox with system styling', () => {
    render(<Checkbox aria-label="Dry Run" defaultChecked />);

    const checkbox = screen.getByRole('checkbox', { name: 'Dry Run' });
    expect(checkbox).toBeChecked();
    expect(checkbox.className).toContain('appearance-none');
    expect(checkbox.className).toContain('checked:bg-primary');
    expect(checkbox.className).toContain('focus-visible:ring-primary/30');
  });

  it('should support disabled state styling', () => {
    render(<Checkbox aria-label="No notification" disabled />);

    const checkbox = screen.getByRole('checkbox', { name: 'No notification' });
    expect(checkbox).toBeDisabled();
    expect(checkbox.className).toContain('disabled:opacity-50');
  });
});
