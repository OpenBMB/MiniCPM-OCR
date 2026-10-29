/**
 * Serial queue for Playground conversation autosave.
 *
 * Purpose: isolate React lifecycle from async write state, so one conversation saves only the latest snapshot serially,
 * and retries with exponential backoff on network failure, so an older write cannot overwrite newer content.
 */

import type { MapSaveConversationInput } from '@/api/map';

import { clearConversationDraft, writeConversationDraft } from './conversationDraft';

const DRAFT_WRITE_INTERVAL_MS = 200;

interface QueueSnapshot {
  generation: number;
  ownerId?: string;
  retryCount: number;
  signature: string;
  payload: MapSaveConversationInput;
}

interface DraftSnapshot extends QueueSnapshot {
  interrupted: boolean;
}

export interface ConversationAutosaveHandlers {
  createConversation: (payload: { title?: string; model?: string }) => Promise<{ id: string }>;
  saveConversation: (vars: { id: string; payload: MapSaveConversationInput }) => Promise<unknown>;
  onConversationCreated: (id: string) => void;
}

export interface ConversationAutosaveInput {
  ownerId?: string;
  signature: string;
  payload: MapSaveConversationInput;
}

/**
 * Serial save queue.
 * The React hook only turns the latest messages into input; this class creates the conversation, writes, retries, and isolates generations.
 */
export class ConversationAutosaveQueue {
  private activeConversationId?: string;
  private generation = 0;
  private savedSignature = '';
  private queued?: QueueSnapshot;
  private latest?: QueueSnapshot;
  private latestDraft?: DraftSnapshot;
  private draining = false;
  private disposed = false;
  private retryTimer?: number;
  private draftTimer?: number;
  private lastDraftWriteAt = 0;

  constructor(
    private handlers: ConversationAutosaveHandlers,
    activeConversationId?: string,
  ) {
    this.activeConversationId = activeConversationId;
  }

  /** Update the latest API callbacks on the React side so the queue does not capture a stale mutation. */
  updateHandlers(handlers: ConversationAutosaveHandlers): void {
    this.handlers = handlers;
  }

  /** Sync the active conversation ID. */
  setActiveConversationId(id?: string): void {
    this.activeConversationId = id;
  }

  /** Enqueue the latest snapshot; identical content is not written again. */
  enqueue(input: ConversationAutosaveInput): void {
    if (input.signature === this.savedSignature) return;
    if (this.latest?.generation === this.generation && this.latest.signature === input.signature) {
      return;
    }
    this.clearRetryTimer();
    const snapshot: QueueSnapshot = {
      ...input,
      generation: this.generation,
      retryCount: 0,
    };
    this.queued = snapshot;
    this.latest = snapshot;
    void this.drain();
  }

  /** Write the latest draft for refresh recovery only; it may contain unfinished streaming content beyond the server snapshot. */
  updateDraft(input: ConversationAutosaveInput, interrupted: boolean): void {
    const snapshot: DraftSnapshot = {
      ...input,
      generation: this.generation,
      retryCount: 0,
      interrupted,
    };
    this.latestDraft = snapshot;
    if (!input.ownerId) return;
    const elapsed = Date.now() - this.lastDraftWriteAt;
    if (elapsed >= DRAFT_WRITE_INTERVAL_MS) {
      this.flushDraft();
      return;
    }
    if (this.draftTimer !== undefined) return;
    this.draftTimer = window.setTimeout(() => {
      this.draftTimer = undefined;
      this.flushDraft();
    }, DRAFT_WRITE_INTERVAL_MS - elapsed);
  }

  /** Synchronously write the last in-memory draft before the page refreshes or hides. */
  flushDraft(): void {
    if (!this.latestDraft?.ownerId) return;
    if (this.draftTimer !== undefined) {
      window.clearTimeout(this.draftTimer);
      this.draftTimer = undefined;
    }
    writeConversationDraft(this.latestDraft.ownerId, {
      conversationId: this.activeConversationId,
      signature: this.latestDraft.signature,
      interrupted: this.latestDraft.interrupted,
      payload: this.latestDraft.payload,
    });
    this.lastDraftWriteAt = Date.now();
  }

  /** Mark the signature of messages the server has already persisted, and clear the matching user draft. */
  markPersisted(signature: string, ownerId?: string): void {
    this.savedSignature = signature;
    this.queued = undefined;
    this.latest = undefined;
    this.clearRetryTimer();
    if (ownerId && (!this.latestDraft || this.latestDraft.signature === signature)) {
      clearConversationDraft(ownerId);
      this.latestDraft = undefined;
      this.clearDraftTimer();
    }
  }

  /** Starting a new conversation or switching accounts discards the current generation; a finished old request must not affect the new conversation. */
  reset(ownerId?: string): void {
    this.generation += 1;
    this.activeConversationId = undefined;
    this.savedSignature = '';
    this.queued = undefined;
    this.latest = undefined;
    this.latestDraft = undefined;
    this.clearRetryTimer();
    this.clearDraftTimer();
    if (ownerId) clearConversationDraft(ownerId);
  }

  /** Stop further retries when the component unmounts. */
  dispose(): void {
    this.flushDraft();
    this.disposed = true;
    this.clearRetryTimer();
    this.clearDraftTimer();
  }

  /** React StrictMode simulates unmount and then remounts; re-enable the same queue instance. */
  activate(): void {
    this.disposed = false;
  }

  /** Drain the queue serially; while a write is in flight, keep only the latest new snapshot. */
  private async drain(): Promise<void> {
    if (this.draining || this.disposed) return;
    this.draining = true;
    try {
      while (this.queued && !this.disposed) {
        const snapshot = this.queued;
        this.queued = undefined;
        if (snapshot.generation === this.generation && snapshot.signature === this.savedSignature) {
          continue;
        }

        try {
          const conversationId = await this.resolveConversationId(snapshot);
          await this.handlers.saveConversation({ id: conversationId, payload: snapshot.payload });
          if (snapshot.generation !== this.generation) continue;
          this.savedSignature = snapshot.signature;
          if (this.latestDraft?.signature === snapshot.signature && snapshot.ownerId) {
            clearConversationDraft(snapshot.ownerId);
            this.latestDraft = undefined;
            this.clearDraftTimer();
          }
        } catch {
          if (snapshot.generation !== this.generation || this.queued) continue;
          this.scheduleRetry(snapshot);
          return;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /** Reuse an existing conversation; on the first save, create one and notify React/URL of the ID immediately. */
  private async resolveConversationId(snapshot: QueueSnapshot): Promise<string> {
    if (this.activeConversationId) return this.activeConversationId;
    const conversation = await this.handlers.createConversation({
      title: snapshot.payload.title,
      model: snapshot.payload.model,
    });
    if (snapshot.generation === this.generation && !this.activeConversationId) {
      this.activeConversationId = conversation.id;
      if (this.latestDraft?.generation === snapshot.generation && this.latestDraft.ownerId) {
        writeConversationDraft(this.latestDraft.ownerId, {
          conversationId: conversation.id,
          signature: this.latestDraft.signature,
          interrupted: this.latestDraft.interrupted,
          payload: this.latestDraft.payload,
        });
      }
      this.handlers.onConversationCreated(conversation.id);
    }
    return conversation.id;
  }

  /** After a final snapshot fails, retry automatically at 1s, 2s, 4s, ... up to 30s. */
  private scheduleRetry(snapshot: QueueSnapshot): void {
    if (this.disposed) return;
    this.queued = { ...snapshot, retryCount: snapshot.retryCount + 1 };
    const delay = Math.min(1_000 * 2 ** snapshot.retryCount, 30_000);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined;
      void this.drain();
    }, delay);
  }

  /** Clear a retry timer that has not fired yet. */
  private clearRetryTimer(): void {
    if (this.retryTimer === undefined) return;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  /** Clear a draft coalesced-write timer that has not fired yet. */
  private clearDraftTimer(): void {
    if (this.draftTimer === undefined) return;
    window.clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
  }
}
