/**
 * 图像解析体验的系统提示词与 Chat Completions 请求装配。
 *
 * 用途：历史兼容的「图像 → Markdown」请求适配。当前 OCR Playground 走算法流水线。
 * 不在界面暴露评估场景：试卷/表格/多栏/手写的约束写进同一份提示词，由模型按画面自行适配。
 */

import type { ChatCompletionParams } from '@/api/map/chat';
import type { Attachment } from '../types';
import { attachmentToPart } from './attachments';

/** 用户侧短指令。部分视觉模型要求 content 里至少有一段 text，不能只发 image_url。 */
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
 * 图像解析系统提示词。产品层固定一份，避免用户先选场景再转换。
 */
export function imageParseSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

/** 组装图像解析补全请求的入参 */
export interface BuildImageParseRequestArgs {
  model: string;
  attachment: Attachment;
}

/**
 * 组装一次「图像 → Markdown」补全请求：系统提示 + 短指令 + 单张 image_url，不含聊天历史。
 * @param args 模型与图像附件
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
    // 图像转 Markdown 只要正文，显式关掉思考，避免 reasoning 污染结果。
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
