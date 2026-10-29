import { describe, expect, it } from 'vitest';

import type { useImageParse } from '../../hooks/useImageParse';
import { imageParseTaskView } from '../imageParseTaskView';

type ParseState = ReturnType<typeof useImageParse>;
const image = {
  id: 'image',
  kind: 'image' as const,
  name: 'invoice.png',
  mime: 'image/png',
  size: 1,
  dataUrl: '/invoice.png',
};
function state(overrides: Partial<ParseState> = {}): ParseState {
  return {
    attachment: image,
    mode: 'standard',
    markdown: '',
    layout: [],
    loading: false,
    finished: false,
    fields: [],
    ...overrides,
  } as ParseState;
}

describe('OCR 任务操作阶段', () => {
  it('无原件、待执行、配置、处理中与失败状态互斥', () => {
    expect(imageParseTaskView(state({ attachment: undefined }), false, false).phase).toBe('empty');
    expect(imageParseTaskView(state(), false, false).phase).toBe('ready');
    expect(imageParseTaskView(state({ mode: 'kie' }), false, false).phase).toBe('setup');
    const running = imageParseTaskView(state({ mode: 'kie', loading: true }), false, false);
    expect(running.phase).toBe('running');
    expect(running.showKieSetup).toBe(false);
    const failed = imageParseTaskView(state({ mode: 'kie', error: 'failed' }), false, false);
    expect(failed.phase).toBe('error');
    expect(failed.showParseAction).toBe(false);
    expect(failed.showKieSetup).toBe(false);
  });

  it('成功但正文为空仍展示完成结果，不重新进入待执行或配置', () => {
    const empty = imageParseTaskView(state({ finished: true }), false, false);
    expect(empty.phase).toBe('result');
    expect(empty.awaitingStart).toBe(false);
    expect(empty.showParseAction).toBe(true);
    const missing = imageParseTaskView(state({ mode: 'kie', finished: true }), false, false);
    expect(missing.phase).toBe('result');
    expect(missing.hasKieResult).toBe(true);
    expect(missing.showKieSetup).toBe(false);
  });

  it('字段全部缺失是有效结果，主动编辑才重新打开配置', () => {
    const parse = state({ mode: 'kie', markdown: '{}', fields: ['发票号码'] });
    expect(imageParseTaskView(parse, false, false).phase).toBe('result');
    const editing = imageParseTaskView(parse, true, false);
    expect(editing.phase).toBe('setup');
    expect(editing.hasKieResult).toBe(true);
    expect(editing.showParseAction).toBe(false);
  });

  it('PDF 切换字段任务时保留原件，并进入字段配置', () => {
    const pdf = { ...image, kind: 'file' as const, name: 'doc.pdf', mime: 'application/pdf' };
    const view = imageParseTaskView(state({ attachment: pdf, mode: 'kie' }), false, false);
    expect(view.phase).toBe('setup');
    expect(view.showKieSetup).toBe(true);
    expect(view.showParseAction).toBe(false);
  });

  it('上传阶段不暴露旧结果的重新识别入口', () => {
    expect(imageParseTaskView(state({ finished: true }), false, true).showParseAction).toBe(false);
  });
});
