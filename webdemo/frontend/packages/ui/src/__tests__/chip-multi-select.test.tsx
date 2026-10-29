import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChipMultiSelect } from '../components/ui/chip-multi-select';

const options = [
  { value: 'm1', label: 'Model 1' },
  { value: 'm2', label: 'Model 2' },
];

describe('ChipMultiSelect', () => {
  it('should render selected chips with pressed state', () => {
    render(
      <ChipMultiSelect ariaLabel="Models" options={options} value={['m1']} onChange={() => {}} />,
    );

    expect(screen.getByRole('group', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Model 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Model 2' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('should emit the next selected values when toggled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ChipMultiSelect options={options} value={['m1']} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Model 2' }));
    expect(onChange).toHaveBeenCalledWith(['m1', 'm2']);

    await user.click(screen.getByRole('button', { name: 'Model 1' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('should render empty text when options are empty', () => {
    render(<ChipMultiSelect options={[]} value={[]} onChange={() => {}} emptyText="No options" />);

    expect(screen.getByText('No options')).toBeInTheDocument();
  });
});
