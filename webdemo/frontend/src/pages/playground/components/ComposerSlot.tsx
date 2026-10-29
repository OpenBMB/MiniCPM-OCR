/**
 * 语言模型输入槽：欢迎态与对话态共用的输入框 + 密钥状态行。
 *
 * 用途：避免 Playground 入口重复装配 ChatComposer 与 KeyStatusBar。
 */

import { ChatComposer } from './ChatComposer';
import { KeyStatusBar } from './KeyStatusBar';
import type { useChat } from '../hooks/useChat';
import type { usePlaygroundModel } from '../hooks/usePlaygroundModel';
import type { usePlaygroundParams } from '../hooks/usePlaygroundParams';

interface ComposerSlotProps {
  input: string;
  setInput: (v: string) => void;
  params: ReturnType<typeof usePlaygroundParams>['params'];
  setThinkingDepth: ReturnType<typeof usePlaygroundParams>['setThinkingDepth'];
  setWebSearch: ReturnType<typeof usePlaygroundParams>['setWebSearch'];
  chat: ReturnType<typeof useChat>;
  canSend: boolean;
  disabledReason?: string;
  /** 当前模型是否允许展示思考（false 时隐藏思考开关） */
  showReasoning: boolean;
  /** 当前模型是否允许展示联网搜索入口 */
  webSearchAvailable: boolean;
  /** 当前模型允许的输入模态，来自模型 capabilities.input_* */
  attachmentCapabilities?: Record<string, boolean>;
}

/**
 * 输入框槽位。
 */
export function ComposerSlot({
  input,
  setInput,
  params,
  setThinkingDepth,
  setWebSearch,
  chat,
  canSend,
  disabledReason,
  showReasoning,
  webSearchAvailable,
  attachmentCapabilities,
}: ComposerSlotProps) {
  return (
    <ChatComposer
      value={input}
      onValueChange={setInput}
      thinkingDepth={params.thinkingDepth}
      onThinkingDepthChange={setThinkingDepth}
      showReasoning={showReasoning}
      webSearchAvailable={webSearchAvailable}
      attachmentCapabilities={attachmentCapabilities}
      webSearch={params.webSearch}
      onWebSearchChange={setWebSearch}
      loading={chat.loading}
      disabled={!canSend}
      disabledReason={disabledReason}
      onSend={chat.send}
      onStop={chat.stop}
    />
  );
}

/**
 * 输入框下方的会话状态行（密钥自动取默认项目，不再展示选择器）。
 */
export function KeyHint({ model }: { model: ReturnType<typeof usePlaygroundModel> }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1">
      <KeyStatusBar
        loading={model.keysLoading}
        hasKeys={model.hasKeys}
        secretLoading={model.secretLoading}
        secretError={model.secretError}
        trialRemaining={model.trialRemaining.language}
        trialError={model.trialError}
      />
    </div>
  );
}
