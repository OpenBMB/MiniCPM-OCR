/**
 * Same-tab temporary draft of the current Playground conversation.
 *
 * Purpose: a refresh fallback while server autosave has not finished. Only the conversation save request body is stored,
 * with no API Key, Authorization, or attachment Base64; sessionStorage clears it when the tab closes.
 */

import type { MapSaveConversationInput } from '@/api/map';

const LEGACY_DRAFT_KEY = 'map-playground-conversation-draft-v1';
const DRAFT_KEY_PREFIX = 'map-playground-conversation-draft-v2';
const DRAFT_VERSION = 1;
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MESSAGE_ROLES = new Set(['system', 'user', 'assistant']);
const ATTACHMENT_KINDS = new Set(['image', 'video', 'audio', 'file']);

export interface ConversationDraft {
  version: number;
  updatedAt: number;
  conversationId?: string;
  signature: string;
  interrupted?: boolean;
  payload: MapSaveConversationInput;
}

/** Read the current conversation draft if it is still within its lifetime; corrupt or expired data is cleared. */
export function readConversationDraft(
  ownerId: string,
  storage: Storage = window.sessionStorage,
): ConversationDraft | undefined {
  const key = draftKey(ownerId);
  try {
    storage.removeItem(LEGACY_DRAFT_KEY);
    const raw = storage.getItem(key);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.version !== DRAFT_VERSION ||
      typeof value.updatedAt !== 'number' ||
      !Number.isFinite(value.updatedAt) ||
      Date.now() - value.updatedAt > DRAFT_MAX_AGE_MS ||
      (value.conversationId !== undefined && typeof value.conversationId !== 'string') ||
      typeof value.signature !== 'string' ||
      (value.interrupted !== undefined && typeof value.interrupted !== 'boolean') ||
      !isSavePayload(value.payload)
    ) {
      removeDraft(key, storage);
      return undefined;
    }
    return {
      version: DRAFT_VERSION,
      updatedAt: value.updatedAt,
      ...(typeof value.conversationId === 'string' ? { conversationId: value.conversationId } : {}),
      signature: value.signature,
      ...(value.interrupted === true ? { interrupted: true } : {}),
      payload: value.payload,
    };
  } catch {
    removeDraft(key, storage);
    return undefined;
  }
}

/** Overwrite with the latest snapshot waiting to be persisted; if the browser is out of space, silently fall back to server autosave only. */
export function writeConversationDraft(
  ownerId: string,
  draft: Omit<ConversationDraft, 'version' | 'updatedAt'>,
  storage: Storage = window.sessionStorage,
): void {
  try {
    storage.setItem(
      draftKey(ownerId),
      JSON.stringify({
        ...draft,
        version: DRAFT_VERSION,
        updatedAt: Date.now(),
      } satisfies ConversationDraft),
    );
  } catch {
    // sessionStorage is a refresh fallback and must not block a normal conversation because of quota or private-mode limits.
  }
}

/** Clear the conversation draft for the current tab. */
export function clearConversationDraft(
  ownerId: string,
  storage: Storage = window.sessionStorage,
): void {
  removeDraft(draftKey(ownerId), storage);
}

/** Delete the draft safely; in some private modes both reading and deleting Storage can throw. */
function removeDraft(key: string, storage: Storage): void {
  try {
    storage.removeItem(key);
  } catch {
    // A failed clear does not affect a persist that the server has already finished.
  }
}

/** Isolate same-tab drafts by user, so switching accounts in the same browser does not restore the previous account. */
function draftKey(ownerId: string): string {
  return `${DRAFT_KEY_PREFIX}:${ownerId}`;
}

/** Check the minimum shape of a draft request body, so corrupt sessionStorage data does not enter message restore. */
function isSavePayload(value: unknown): value is MapSaveConversationInput {
  if (!isRecord(value) || !Array.isArray(value.messages)) return false;
  if (value.title !== undefined && typeof value.title !== 'string') return false;
  if (value.model !== undefined && typeof value.model !== 'string') return false;
  return value.messages.every(isSaveMessage);
}

/** Check one saved message and the array fields the restore flow walks. */
function isSaveMessage(value: unknown): boolean {
  if (!isRecord(value) || !MESSAGE_ROLES.has(String(value.role))) return false;
  if (typeof value.content !== 'string') return false;
  if (value.alt_versions !== undefined && !isObjectArray(value.alt_versions)) return false;
  if (value.citations !== undefined && !isObjectArray(value.citations)) return false;
  if (value.attachments !== undefined) {
    if (!Array.isArray(value.attachments)) return false;
    if (!value.attachments.every(isAttachment)) return false;
  }
  return true;
}

/** A draft attachment may contain only remote metadata; a local dataUrl/Base64 is explicitly rejected. */
function isAttachment(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    ATTACHMENT_KINDS.has(String(value.kind)) &&
    typeof value.name === 'string' &&
    typeof value.mime === 'string' &&
    typeof value.size === 'number' &&
    value.dataUrl === undefined
  );
}

/** Whether the value is an array of objects; optional fields continue to be read defensively by the message conversion functions. */
function isObjectArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isRecord);
}

/** Narrow an unknown object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
