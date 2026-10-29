/**
 * System prompt and Chat Completions request assembly for the image-parsing experience.
 *
 * Purpose: the historical "image → Markdown" request adapter. The current OCR Playground uses the algorithm pipeline.
 * Evaluation scenes are not exposed in the UI: exam, table, multi-column, and handwriting constraints live in the same prompt, and the model adapts from the image.
 */

import type { ChatCompletionParams } from '@/api/map/chat';
import type { Attachment } from '../types';
import { attachmentToPart } from './attachments';

/** Short user-side instruction. Some vision models require at least one text part in content and cannot receive only image_url. */
const USER_INSTRUCTION = '请将图像转为 Markdown。';

const SYSTEM_PROMPT = [
  '你是图像转 Markdown 转换器，只输出最终 Markdown，不要前言、解释、道歉或代码围栏包裹全文。',
  '必须保证内容完整、内容正确、排版合理：不漏段、不改写原意、标题/列表/表格/公式层级清晰。',
  '无法辨认的文字用 〔?〕 标记，不要猜测填空。',
  '若含公式：行内用 $...$，独立公式用 $$...$$；不要把公式栅格化成图片，也不要输出 LaTeX 文档头。',
  '若含表格：优先输出 GitHub Flavored Markdown 表格（用 | 分列）；复杂合并单元格按阅读顺序展开，并在表下用一句说明「合并单元格已展开」。',
  '若为论文、双栏或多栏：按人类阅读顺序串联各栏，不要把左右栏混写成一行；用标题层级还原章节。',
  '若为试卷或习题：保留题号与作答结构。',
  '若为屏幕截图或手写笔记：优先保内容完整与用字正确，排版用可读的段落和列表即可。',
].join('\n');

/**
 * Image-parsing system prompt. The product layer keeps a single fixed prompt, so the user does not pick a scene first and then convert.
 */
export function imageParseSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

/** Arguments for assembling an image-parsing completion request */
export interface BuildImageParseRequestArgs {
  model: string;
  attachment: Attachment;
}

/**
 * Assemble one "image → Markdown" completion request: system prompt + short instruction + a single image_url, with no chat history.
 * @param args model and image attachment
 */
export function buildImageParseRequest(args: BuildImageParseRequestArgs): ChatCompletionParams {
  if (args.attachment.kind !== 'image') {
    throw new Error('图像解析仅接受图像附件');
  }
  const url = args.attachment.publicUrl || args.attachment.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('图片尚未完成远端上传，请重新上传');
  }
  return {
    model: args.model,
    stream: true,
    // Image-to-Markdown wants only the body, so reasoning is explicitly turned off to keep it from contaminating the result.
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      { role: 'system', content: imageParseSystemPrompt() },
      {
        role: 'user',
        content: [{ type: 'text', text: USER_INSTRUCTION }, attachmentToPart(args.attachment)],
      },
    ],
  };
}
