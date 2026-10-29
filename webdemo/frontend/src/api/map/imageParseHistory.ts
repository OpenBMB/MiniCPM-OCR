import { getTokenSubject, mapRequest } from './request';
import { linkPlaygroundFile } from './fileUploads';
import type { ImageParseMode } from './imageParseSdk';
import type {
  ImageParseHistoryEntry,
  ImageParseHistoryTask,
  ImageParseHistoryScope,
  ImageParseHistorySummary,
  ImageParseSnapshot,
} from '@/pages/playground/utils/imageParseHistoryTypes';
import { sanitizeImageParseSnapshot } from '@/pages/playground/utils/imageParseHistorySnapshot';

/** Per-save history size limit; fileId records no longer include the original base64. */
export const IMAGE_PARSE_HISTORY_MAX_BODY_BYTES = 128 * 1024 * 1024;

/** Lightweight paged history for a logged-in user. */
export interface ImageParseHistoryPage {
  list: ImageParseHistorySummary[];
  hasMore: boolean;
  migrationPending?: boolean;
}

export type { ImageParseHistoryTask };

function assertScope(scope: ImageParseHistoryScope) {
  if (!scope.userId || !scope.projectId || getTokenSubject() !== scope.userId)
    throw new Error('imageParseHistoryScopeRequired');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSummary(value: unknown): value is ImageParseHistorySummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.attachmentId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    (value.mode === undefined || isImageParseMode(value.mode))
  );
}

function isImageParseMode(value: unknown): value is ImageParseMode {
  return (
    value === 'standard' ||
    value === 'scored' ||
    value === 'high-precision' ||
    value === 'standard-pipeline' ||
    value === 'seal' ||
    value === 'kie'
  );
}

/** Validate the cloud page response so bad gateway data cannot enter a component and break the history list. */
function parseImageParseHistoryPage(value: unknown): ImageParseHistoryPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.list) ||
    !value.list.every(isSummary) ||
    typeof value.hasMore !== 'boolean'
  )
    throw new Error('imageParseHistoryInvalid');
  return {
    list: value.list,
    hasMore: value.hasMore,
    ...(typeof value.migrationPending === 'boolean'
      ? { migrationPending: value.migrationPending }
      : {}),
  };
}

function historyPath(
  scope: ImageParseHistoryScope,
  id?: string,
  offset?: number,
  task?: ImageParseHistoryTask,
) {
  const query = new URLSearchParams({ project_id: scope.projectId });
  if (task) query.set('task', task);
  if (offset !== undefined) query.set('offset', String(offset));
  return `/image-parse/history${id ? `/${encodeURIComponent(id)}` : ''}?${query}`;
}

/** The user ID is only for client-side isolation; the server decides real ownership from the login session and does not accept an owner parameter. */
export function listImageParseHistory(
  scope: ImageParseHistoryScope,
  offset = 0,
  signal?: AbortSignal,
  task?: ImageParseHistoryTask,
): Promise<ImageParseHistoryPage> {
  assertScope(scope);
  return mapRequest(historyPath(scope, undefined, offset, task), { signal }).then(
    parseImageParseHistoryPage,
  );
}

function isSignedFileURL(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:' || new URL(value).protocol === 'http:';
  } catch {
    return false;
  }
}

/** When opening fileId history, re-authenticate and sign the link. Original-file download is handled by preview and does not block the saved result. */
async function hydrateImageParseSnapshot(
  snapshot: ImageParseSnapshot,
  signal?: AbortSignal,
): Promise<ImageParseSnapshot> {
  try {
    const fileId = snapshot.attachment.fileId;
    if (!fileId) throw new Error('imageParseHistoryInvalid');
    const url = await linkPlaygroundFile(fileId, signal);
    if (!isSignedFileURL(url)) throw new Error('imageParseHistoryInvalid');
    return { ...snapshot, attachment: { ...snapshot.attachment, dataUrl: url } };
  } catch {
    throw new Error('imageParseHistoryInvalid');
  }
}

/** Fetch the current user's record and re-validate the full snapshot; do not trust attachment extension fields returned over the network. */
export async function getImageParseHistory(
  scope: ImageParseHistoryScope,
  id: string,
  signal?: AbortSignal,
  byAttachment = false,
  task?: ImageParseHistoryTask,
): Promise<ImageParseHistoryEntry> {
  assertScope(scope);
  if (byAttachment) {
    const query = new URLSearchParams({ project_id: scope.projectId });
    if (task) query.set('task', task);
    query.set('attachment_id', id);
    const page = parseImageParseHistoryPage(
      await mapRequest(`/image-parse/history?${query}`, { signal }),
    );
    const summary = page.list.find((item) => item.attachmentId === id);
    if (!summary) throw new Error('imageParseHistoryInvalid');
    return getImageParseHistory(scope, summary.id, signal);
  }
  const entry = await mapRequest<ImageParseHistoryEntry>(historyPath(scope, id), { signal });
  const snapshot = sanitizeImageParseSnapshot(entry.snapshot, { storage: 'cloud' });
  if (entry.id !== id || !Number.isFinite(entry.createdAt) || !snapshot)
    throw new Error('imageParseHistoryInvalid');
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    snapshot: snapshot.attachment.fileId
      ? await hydrateImageParseSnapshot(snapshot, signal)
      : snapshot,
  };
}

/** Idempotently save a finished result; restored records use PUT, and old-cache migration only inserts and does not overwrite the cloud version. */
export function saveImageParseHistory(
  scope: ImageParseHistoryScope,
  value: ImageParseSnapshot,
  id?: string,
  importOnly = false,
): Promise<ImageParseHistorySummary> {
  assertScope(scope);
  const snapshot = sanitizeImageParseSnapshot(value, { storage: 'cloud' });
  if (!snapshot) throw new Error('imageParseHistoryInvalid');
  if (snapshot.pdf) {
    snapshot.pdf.results = Object.fromEntries(
      Object.entries(snapshot.pdf.results).map(([page, result]) => [
        page,
        { result: result.result, error: result.error },
      ]),
    );
  }
  const body = JSON.stringify({ snapshot, ...(importOnly ? { importOnly } : {}) });
  if (new Blob([body]).size > IMAGE_PARSE_HISTORY_MAX_BODY_BYTES)
    throw new Error('imageParseHistoryTooLarge');
  return mapRequest(historyPath(scope, id), { method: id ? 'PUT' : 'POST', body });
}

/** Delete applies only to the currently logged-in user's records; public examples do not call this API. */
export async function deleteImageParseHistory(
  scope: ImageParseHistoryScope,
  id: string,
): Promise<void> {
  assertScope(scope);
  await mapRequest(historyPath(scope, id), { method: 'DELETE' });
}
