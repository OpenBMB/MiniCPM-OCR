import { describe, expect, it } from 'vitest';
import type { AttachmentKind } from '../../types';
import {
  attachmentAcceptForCapabilities,
  supportedAttachmentKinds,
} from '../attachmentCapabilities';

describe('attachmentCapabilities', () => {
  it('只返回模型明确支持的附件模态', () => {
    const capabilities = {
      input_text: true,
      input_image: true,
      input_video: false,
      input_audio: false,
      input_file: false,
    };

    expect(supportedAttachmentKinds(capabilities)).toEqual<AttachmentKind[]>(['image']);
  });

  it('文本模型没有附件能力时不生成上传 accept', () => {
    expect(attachmentAcceptForCapabilities({ input_text: true })).toBe('');
  });

  it('文件能力只允许文档类型', () => {
    const accept = attachmentAcceptForCapabilities({ input_file: true });

    expect(accept).toContain('application/pdf');
    expect(accept).toContain('.docx');
    expect(accept).not.toContain('image/png');
  });
});
