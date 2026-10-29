import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProFormField } from './pro-form';

describe('ProFormField', () => {
  it('在标签外展示辅助操作并保持字段关联', () => {
    render(
      <ProFormField
        label="参数配置"
        name="parameter_config"
        labelAction={<button type="button">参数说明</button>}
      >
        <textarea id="parameter_config" />
      </ProFormField>,
    );

    expect(screen.getByLabelText('参数配置')).toHaveAttribute('id', 'parameter_config');
    expect(screen.getByRole('button', { name: '参数说明' }).closest('label')).toBeNull();
  });
});
