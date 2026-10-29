/**
 * Playground 当前会话的同标签页临时草稿。
 *
 * 用途：在服务端自动保存尚未完成时为刷新提供兜底。仅保存对话保存请求体，
 * 不包含 API Key、Authorization 或附件 Base64；关闭标签页后由 sessionStorage 自动清理。
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

/** 读取仍在有效期内的当前会话草稿；损坏或过期数据会被清理。 */
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

/** 覆盖保存最新待持久化快照；浏览器容量不足时静默降级为仅服务端自动保存。 */
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
    // sessionStorage 是刷新兜底，不得因容量或隐私模式限制阻断正常对话。
  }
}

/** 清理当前标签页的会话草稿。 */
export function clearConversationDraft(
  ownerId: string,
  storage: Storage = window.sessionStorage,
): void {
  removeDraft(draftKey(ownerId), storage);
}

/** 安全删除草稿；部分隐私模式下 Storage 的读取和删除都可能抛错。 */
function removeDraft(key: string, storage: Storage): void {
  try {
    storage.removeItem(key);
  } catch {
    // 清理失败不影响服务端已完成的持久化结果。
  }
}

/** 按用户隔离同标签页草稿，避免同一浏览器切换账号时恢复前一账号内容。 */
function draftKey(ownerId: string): string {
  return `${DRAFT_KEY_PREFIX}:${ownerId}`;
}

/** 校验草稿请求体的最小结构，避免损坏的 sessionStorage 数据进入消息恢复流程。 */
function isSavePayload(value: unknown): value is MapSaveConversationInput {
  if (!isRecord(value) || !Array.isArray(value.messages)) return false;
  if (value.title !== undefined && typeof value.title !== 'string') return false;
  if (value.model !== undefined && typeof value.model !== 'string') return false;
  return value.messages.every(isSaveMessage);
}

/** 校验单条保存消息及恢复流程会遍历的数组字段。 */
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

/** 草稿附件只允许远端元数据，明确拒绝本地 dataUrl/Base64。 */
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

/** 判断值是否为对象数组；具体可选字段继续由消息转换函数防御性读取。 */
function isObjectArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isRecord);
}

/** unknown 对象收窄。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
