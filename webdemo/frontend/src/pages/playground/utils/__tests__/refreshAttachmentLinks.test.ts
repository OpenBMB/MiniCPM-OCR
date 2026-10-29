import { describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '../../types';
import { refreshAttachmentLinks } from '../refreshAttachmentLinks';

const link = vi.hoisted(() => vi.fn());
vi.mock('@/api/map/fileUploads', () => ({ linkPlaygroundFile: link }));

describe('refreshAttachmentLinks', () => {
  it('重新签发历史附件并在同次请求复用同一文件的链接', async () => {
    link.mockReset().mockResolvedValue('https://egress.example/new');
    const attachment = {
      id: 'a',
      kind: 'image' as const,
      name: 'x.png',
      mime: 'image/png',
      size: 1,
      dataUrl: 'data:image/png;base64,A',
      fileId: 'f_test',
      publicUrl: 'https://egress.example/expired',
    };
    const history: ChatMessage[] = [
      { id: '1', role: 'user', content: '', attachments: [attachment] },
      { id: '2', role: 'user', content: '', attachments: [attachment] },
    ];
    const refreshed = await refreshAttachmentLinks(history);
    expect(link).toHaveBeenCalledTimes(1);
    expect(refreshed[0]?.attachments?.[0]?.publicUrl).toBe('https://egress.example/new');
    expect(refreshed[1]?.attachments?.[0]?.publicUrl).toBe('https://egress.example/new');
    expect(history[0]?.attachments?.[0]?.publicUrl).toBe('https://egress.example/expired');
  });

  it('签发失败时拒绝模型请求，不回退过期链接', async () => {
    link.mockReset().mockRejectedValue(new Error('expired'));
    await expect(
      refreshAttachmentLinks([
        {
          id: '1',
          role: 'user',
          content: '',
          attachments: [
            {
              id: 'a',
              kind: 'file',
              name: 'x.pdf',
              mime: 'application/pdf',
              size: 1,
              dataUrl: 'data:application/pdf;base64,A',
              fileId: 'f_test',
              publicUrl: 'https://egress.example/expired',
            },
          ],
        },
      ]),
    ).rejects.toThrow('expired');
  });

  it('跳过清除上下文之前和已排除的附件', async () => {
    link.mockReset();
    const attachment = {
      id: 'a',
      kind: 'file' as const,
      name: 'a.pdf',
      mime: 'application/pdf',
      size: 1,
      dataUrl: 'data:application/pdf;base64,A',
      fileId: 'f_expired',
    };
    const history: ChatMessage[] = [
      { id: '1', role: 'user', content: '', attachments: [attachment] },
      { id: '2', role: 'system', content: 'clear', divider: true },
      { id: '3', role: 'user', content: '', attachments: [attachment], contextExcluded: true },
      { id: '4', role: 'user', content: 'new question' },
    ];
    expect(await refreshAttachmentLinks(history)).toEqual(history);
    expect(link).not.toHaveBeenCalled();
  });
});
