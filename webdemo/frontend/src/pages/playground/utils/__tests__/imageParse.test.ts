/**
 * Contract unit tests for image parsing: system prompt and Chat Completions request assembly.
 */

import { describe, expect, it } from 'vitest';
import type { Attachment } from '../../types';
import { attachmentToPart } from '../attachments';
import { buildImageParseRequest, imageParseSystemPrompt } from '../imageParse';

function imageAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'att_1',
    kind: 'image',
    name: 'page.png',
    mime: 'image/png',
    size: 12,
    dataUrl: 'data:image/png;base64,AAA',
    ...overrides,
  };
}

describe('imageParseSystemPrompt', () => {
  it('asks for markdown only and covers completeness, formulas, tables, and reading order', () => {
    const prompt = imageParseSystemPrompt();
    expect(prompt).toContain('Markdown');
    expect(prompt).toMatch(/完整/);
    expect(prompt).toMatch(/正确/);
    expect(prompt).toMatch(/排版/);
    expect(prompt).toContain('$');
    expect(prompt).toContain('|');
    expect(prompt).toMatch(/栏|阅读顺序/);
    expect(prompt).toMatch(/手写|截图/);
    expect(prompt).not.toMatch(/JSON|bbox|bounding box/i);
  });
});

describe('buildImageParseRequest', () => {
  it('sends a system prompt plus one image_url user turn, without extra chat history', () => {
    const attachment = imageAttachment({
      publicUrl: 'https://platform.example/api/assets/public/token',
    });
    const request = buildImageParseRequest({
      model: 'ocr-md',
      attachment,
    });

    expect(request.model).toBe('ocr-md');
    expect(request.stream).toBe(true);
    expect(request.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(request.messages).toHaveLength(2);
    expect(request.messages[0]).toEqual({
      role: 'system',
      content: imageParseSystemPrompt(),
    });
    expect(request.messages[1]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: '请将图像转为 Markdown。' }, attachmentToPart(attachment)],
    });
  });

  it.each([undefined, 'blob:preview', 'data:image/png;base64,AAA', '/api/local'])('rejects local-only URL %s', (url) => {
    expect(() => buildImageParseRequest({ model: 'ocr', attachment: imageAttachment({ url }) })).toThrow(/上传/);
  });

  it('does not treat a non-image attachment as a valid parse input', () => {
    expect(() =>
      buildImageParseRequest({
        model: 'ocr-md',
        attachment: imageAttachment({ kind: 'file', mime: 'application/pdf', name: 'a.pdf' }),
      }),
    ).toThrow(/图像/);
  });
});
