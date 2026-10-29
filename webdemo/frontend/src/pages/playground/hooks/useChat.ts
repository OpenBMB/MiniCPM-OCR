/**
 * 体验中心核心对话状态机 hook（门面）。
 *
 * 用途：托管消息列表与 send/clear；补全网络委托 useChatCompletion，多版本/反馈委托 useMessageVersions。
 * 对外 API 保持不变：页面层只依赖 useChat(args) 及其返回值。
 */

import { useCallback, useRef, useState } from 'react';
import type { Attachment, ChatMessage, MessageFeedback, PlaygroundParams } from '../types';
import { genId, makeDivider, makeMessage } from '../utils/messages';
import { useChatCompletion } from './useChatCompletion';
import { useMessageVersions } from './useMessageVersions';

/** useChat 入参 */
export interface UseChatArgs {
  /** 当前选中模型 id */
  model: string;
  /** 懒取明文密钥（无密钥时返回空，send 会拒绝） */
  getSecret: () => string | undefined;
  /** 当前自动选定的 API Key ID，联网模式只把该 ID 交给 BFF */
  keyId?: string;
  /** 参数偏好 */
  params: PlaygroundParams;
  /** 可选系统提示 */
  systemPrompt?: string;
  /** 模型目录声明的上下文窗口；0 表示未声明。 */
  contextWindow?: number;
  /** 模型目录声明的最大输出 token。 */
  modelMaxOutputTokens?: number;
  /** 自动裁剪旧消息后的体验提示。 */
  onContextTrim?: (trimmedMessageCount: number) => void;
  /** 当前输入自身超过可用上下文时的体验提示。 */
  onContextLimit?: () => void;
  /** 请求终态后刷新 Playground 免费体验状态。 */
  refreshCredential?: () => void;
}

/** useChat 返回 */
export interface UseChatReturn {
  messages: ChatMessage[];
  loading: boolean;
  /** 发送一条用户消息（可带多模态附件）并发起补全 */
  send: (text: string, attachments?: Attachment[]) => void;
  /** 重新生成某条 assistant 消息（非破坏性）：保留既有版本，追加新版本并切到末位 */
  regenerate: (assistantId: string) => void;
  /** 切换某条 assistant 消息的反馈态（赞/踩互斥，再次点击同项取消）。写入当前版本并镜像顶层 */
  setFeedback: (assistantId: string, kind: MessageFeedback) => void;
  /** 切换某条 assistant 消息的显示版本（‹n/N› 翻页），把该版本字段镜像回顶层 */
  setActiveVersion: (assistantId: string, index: number) => void;
  /** 停止当前生成（AbortController） */
  stop: () => void;
  /** 清空全部消息 */
  clear: () => void;
  /** 清除上下文：插入一条分隔线，其上历史不再作为上下文发送（消息仍保留，非新会话） */
  clearContext: () => void;
  /** 直接替换消息列表（用于切换「最近对话」） */
  setMessages: (list: ChatMessage[]) => void;
}

/**
 * 对话状态机门面。
 * @param args 模型 / 取密钥 / 参数 / 系统提示
 */
export function useChat(args: UseChatArgs): UseChatReturn {
  const {
    model,
    getSecret,
    params,
    systemPrompt,
    contextWindow,
    modelMaxOutputTokens,
    onContextTrim,
    onContextLimit,
    refreshCredential,
  } = args;
  const keyId = args.keyId;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const seqRef = useRef(0);

  const { loading, stop, startCompletion } = useChatCompletion({
    setMessages,
    model,
    getSecret,
    keyId,
    params,
    systemPrompt,
    contextWindow,
    modelMaxOutputTokens,
    onContextTrim,
    onContextLimit,
    refreshCredential,
  });

  const { regenerate, setFeedback, setActiveVersion } = useMessageVersions({
    messages,
    setMessages,
    loading,
    startCompletion,
  });

  const clear = useCallback(() => {
    stop();
    setMessages([]);
  }, [stop]);

  const clearContext = useCallback(() => {
    if (loading) return;
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      if (prev[prev.length - 1]?.divider) return prev;
      return [...prev, makeDivider(genId((seqRef.current += 1)))];
    });
  }, [loading]);

  const send = useCallback(
    (text: string, attachments?: Attachment[]) => {
      const content = text.trim();
      const atts = attachments ?? [];
      if ((!content && atts.length === 0) || loading) return;

      const userId = genId((seqRef.current += 1));
      const assistantId = genId((seqRef.current += 1));

      const userMsg = makeMessage(
        userId,
        'user',
        content,
        atts.length ? { attachments: atts } : {},
      );
      const history = [...messages, userMsg];
      // 开了联网就先把 searching 置起来：从发请求到第一个 tool_status 事件之间有一段空窗，
      // 否则这段时间界面上什么反馈都没有。关闭联网时仍是 false，非联网路径行为不变。
      const placeholder = makeMessage(assistantId, 'assistant', '', {
        streaming: true,
        searching: params.webSearch,
      });
      setMessages([...history, placeholder]);

      startCompletion(history, assistantId);
    },
    [loading, messages, params.webSearch, startCompletion],
  );

  return {
    messages,
    loading,
    send,
    regenerate,
    setFeedback,
    setActiveVersion,
    stop,
    clear,
    clearContext,
    setMessages,
  };
}
