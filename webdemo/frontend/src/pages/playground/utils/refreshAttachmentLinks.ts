import { linkPlaygroundFile } from '@/api/map/fileUploads';

import type { ChatMessage } from '../types';

/** Each model request refreshes the short-lived link of a file-upload file; history messages and regenerate share this flow. */
export async function refreshAttachmentLinks(messages: ChatMessage[]): Promise<ChatMessage[]> {
  const signed = new Map<string, Promise<string>>();
  let lastDivider = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.divider) {
      lastDivider = index;
      break;
    }
  }
  return Promise.all(
    messages.map(async (message, index) => {
      if (
        index <= lastDivider ||
        message.contextExcluded ||
        message.interrupted ||
        message.role === 'system' ||
        !message.attachments?.some((attachment) => attachment.fileId)
      )
        return message;
      const attachments = await Promise.all(
        message.attachments.map(async (attachment) => {
          if (!attachment.fileId) return attachment;
          let url = signed.get(attachment.fileId);
          if (!url) {
            url = linkPlaygroundFile(attachment.fileId);
            signed.set(attachment.fileId, url);
          }
          return { ...attachment, publicUrl: await url };
        }),
      );
      return { ...message, attachments };
    }),
  );
}
