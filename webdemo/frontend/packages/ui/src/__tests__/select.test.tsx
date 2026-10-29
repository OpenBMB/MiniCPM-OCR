import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../index';

describe('Select', () => {
  it('should keep native scrollbars consistent with the shared thin scrollbar style', () => {
    render(
      <Select defaultValue="model-a">
        <SelectTrigger aria-label="模型">
          <SelectValue />
        </SelectTrigger>
        <SelectContent scrollMode="native">
          <SelectItem value="model-a">模型 A</SelectItem>
          <SelectItem value="model-b">模型 B</SelectItem>
        </SelectContent>
      </Select>,
    );

    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));

    const selectStyle = Array.from(document.head.querySelectorAll('style')).find((style) =>
      style.textContent?.includes('.map-select-native-scroll'),
    );

    expect(selectStyle?.textContent).toContain('scrollbar-width: thin');
    expect(selectStyle?.textContent).toContain('width: 6px');
  });
});
