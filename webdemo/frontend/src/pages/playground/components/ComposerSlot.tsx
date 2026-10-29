/**
 * Language-model input slot: the input plus the key-status row, shared by the welcome state and the conversation state.
 *
 * Purpose: avoid assembling ChatComposer and KeyStatusBar twice at the Playground entry.
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
  /** Whether the current model may show reasoning (when false, hide the reasoning switch) */
  showReasoning: boolean;
  /** Whether the current model may show the web-search entry */
  webSearchAvailable: boolean;
  /** Input modalities the current model allows, from model capabilities.input_* */
  attachmentCapabilities?: Record<string, boolean>;
}

/**
 * Input slot.
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
 * Session status row under the input (the key is taken automatically from the default project; the selector is no longer shown).
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
