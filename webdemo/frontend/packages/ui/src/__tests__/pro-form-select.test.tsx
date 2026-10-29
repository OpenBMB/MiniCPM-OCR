import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ProForm,
  ProFormField,
  ProFormActions,
  Input,
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
  Button,
} from '../index';

describe('ProForm + Select', () => {
  it('应能正常渲染含 Select 的双列表单', () => {
    expect(() =>
      render(
        <ProForm columns={2}>
          <ProFormField label="模型名称" name="model" required>
            <Input placeholder="GPT-4o" />
          </ProFormField>
          <ProFormField label="模型类型" name="type">
            <Select defaultValue="chat">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chat">Chat</SelectItem>
                <SelectItem value="completion">Completion</SelectItem>
              </SelectContent>
            </Select>
          </ProFormField>
          <ProFormActions>
            <Button variant="outline">取消</Button>
            <Button>保存</Button>
          </ProFormActions>
        </ProForm>,
      ),
    ).not.toThrow();
  });
});
