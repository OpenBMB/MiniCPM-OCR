/**
 * Playground conversation autosave queue.
 *
 * Purpose: on the first send, create the conversation immediately and save the user message; after the answer ends, save the final snapshot serially.
 * Only one write request is allowed at a time, and new snapshots produced during generation keep only the latest one, so an older request finishing later cannot overwrite newer content.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { MapSaveConversationInput } from '@/api/map';

import type { ChatMessage } from '../types';
import { ConversationAutosaveQueue } from '../utils/conversationAutosaveQueue';
import {
  chatMessagesToSavePayload,
  messagesForAutosave,
  messagesForDraft,
} from '../utils/conversations';
import { deriveTitle } from '../utils/messages';

interface UseConversationAutosaveArgs {
  messages: ChatMessage[];
  model: string;
  ownerId?: string;
  enabled: boolean;
  activeConversationId?: string;
  createConversation: (payload: { title?: string; model?: string }) => Promise<{ id: string }>;
  saveConversation: (vars: { id: string; payload: MapSaveConversationInput }) => Promise<unknown>;
  onConversationCreated: (id: string) => void;
}

interface UseConversationAutosaveReturn {
  /** Mark history messages the server has already persisted, so loading history does not save them again immediately. */
  markPersisted: (messages: ChatMessage[]) => void;
  /** When a new conversation starts, discard the snapshot currently queued, isolating the two conversations. */
  reset: () => void;
}

/**
 * Save the current Playground conversation serially.
 * @param args current messages, model, conversation ID, and the API write function.
 * @returns the history-restore marker and the new-conversation reset function.
 */
export function useConversationAutosave(
  args: UseConversationAutosaveArgs,
): UseConversationAutosaveReturn {
  const {
    messages,
    model,
    ownerId,
    enabled,
    activeConversationId,
    createConversation,
    saveConversation,
    onConversationCreated,
  } = args;
  const previousOwnerRef = useRef(ownerId);
  const [queue] = useState(
    () =>
      new ConversationAutosaveQueue(
        { createConversation, saveConversation, onConversationCreated },
        activeConversationId,
      ),
  );

  // A mutation and a URL callback may change reference after a re-render; the queue always uses the latest implementation.
  useEffect(() => {
    queue.updateHandlers({ createConversation, saveConversation, onConversationCreated });
  }, [createConversation, onConversationCreated, queue, saveConversation]);

  // When the URL or a history selection changes the active conversation, sync it to the queue.
  useLayoutEffect(() => {
    queue.setActiveConversationId(activeConversationId);
  }, [activeConversationId, queue]);

  // An account switch discards the previous account's queue and draft immediately.
  useLayoutEffect(() => {
    if (previousOwnerRef.current === ownerId) return;
    queue.reset(previousOwnerRef.current);
    previousOwnerRef.current = ownerId;
    queue.setActiveConversationId(activeConversationId);
  }, [activeConversationId, ownerId, queue]);

  // After a visible message on the page is committed, refresh the draft immediately, so pagehide reads the last increment of this commit.
  useLayoutEffect(() => {
    if (!enabled) return;
    const draftable = messagesForDraft(messages);
    if (draftable.some((message) => message.role === 'user')) {
      const draftPayload = chatMessagesToSavePayload(
        draftable,
        deriveTitle(draftable),
        model || undefined,
      );
      if (draftPayload.messages.length > 0) {
        queue.updateDraft(
          {
            ownerId,
            signature: JSON.stringify(draftPayload.messages),
            payload: draftPayload,
          },
          draftable.some((message) => message.interrupted),
        );
      }
    }
  }, [enabled, messages, model, ownerId, queue]);

  useEffect(() => {
    if (!enabled) return;
    const persistable = messagesForAutosave(messages);
    if (!persistable.some((message) => message.role === 'user')) return;

    const payload = chatMessagesToSavePayload(
      persistable,
      deriveTitle(persistable),
      model || undefined,
    );
    if (payload.messages.length === 0) return;

    const signature = JSON.stringify(payload.messages);
    queue.enqueue({
      ownerId,
      signature,
      payload,
    });
  }, [enabled, messages, model, ownerId, queue]);

  const markPersisted = useCallback(
    (persistedMessages: ChatMessage[]) => {
      const persistable = messagesForAutosave(persistedMessages);
      const payload = chatMessagesToSavePayload(persistable, deriveTitle(persistable), undefined);
      queue.markPersisted(JSON.stringify(payload.messages), ownerId);
    },
    [ownerId, queue],
  );

  const reset = useCallback(() => {
    queue.reset(ownerId);
  }, [ownerId, queue]);

  useEffect(() => {
    queue.activate();
    const flushDraft = () => queue.flushDraft();
    window.addEventListener('pagehide', flushDraft);
    return () => {
      window.removeEventListener('pagehide', flushDraft);
      queue.dispose();
    };
  }, [queue]);

  return { markPersisted, reset };
}
