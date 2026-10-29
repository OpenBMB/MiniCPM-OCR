/**
 * Playground 会话自动保存串行队列。
 *
 * 用途：隔离 React 生命周期与异步写入状态，保证同一会话只串行保存最新快照，
 * 并在网络失败时指数退避重试，避免旧写入覆盖新内容。
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
 * 串行保存队列。
 * React hook 只负责把最新消息转换成 input，本类负责创建会话、写入、重试与代际隔离。
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

  /** 更新 React 侧最新 API 回调，避免队列捕获过期 mutation。 */
  updateHandlers(handlers: ConversationAutosaveHandlers): void {
    this.handlers = handlers;
  }

  /** 同步当前活动会话 ID。 */
  setActiveConversationId(id?: string): void {
    this.activeConversationId = id;
  }

  /** 入列最新快照；相同内容不重复写入。 */
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

  /** 写入仅供刷新恢复的最新草稿；允许比服务端快照多出尚未完成的流式内容。 */
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

  /** 页面刷新/隐藏前同步写入内存中的最后一份草稿。 */
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

  /** 标记服务端已经持久化的消息签名，并清理对应用户草稿。 */
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

  /** 开始新会话或切换账号时废弃当前代际，旧请求完成后不能影响新会话。 */
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

  /** 组件卸载时停止后续重试。 */
  dispose(): void {
    this.flushDraft();
    this.disposed = true;
    this.clearRetryTimer();
    this.clearDraftTimer();
  }

  /** React StrictMode 会先模拟卸载再重新挂载；重新启用同一队列实例。 */
  activate(): void {
    this.disposed = false;
  }

  /** 串行排空队列；写入期间的新快照只保留最新一份。 */
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

  /** 已有会话直接复用；首次保存则创建并立即把 ID 通知 React/URL。 */
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

  /** 最终快照失败后按 1s、2s、4s... 最长 30s 自动重试。 */
  private scheduleRetry(snapshot: QueueSnapshot): void {
    if (this.disposed) return;
    this.queued = { ...snapshot, retryCount: snapshot.retryCount + 1 };
    const delay = Math.min(1_000 * 2 ** snapshot.retryCount, 30_000);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined;
      void this.drain();
    }, delay);
  }

  /** 清理尚未触发的重试定时器。 */
  private clearRetryTimer(): void {
    if (this.retryTimer === undefined) return;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  /** 清理尚未触发的草稿合并写定时器。 */
  private clearDraftTimer(): void {
    if (this.draftTimer === undefined) return;
    window.clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
  }
}
