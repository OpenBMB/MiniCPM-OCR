import type { ImageParseMode } from '@/api/map/imageParseSdk';
import type { ImageParseSource } from '@/api/map/imageParseSource';
import type { Attachment } from '../types';
import type { ImageParseLayoutBlock } from './imageParseSample';
import type { ImageParseRotationInfo } from './imageParseSample';
import type { PdfPageResult } from './pdfImageParse';

/** A PDF cache stores only page results of finished tasks and the reading position, with no parser or network request. */
export interface PdfImageParseSnapshot {
  page: number;
  pages: number;
  results: Record<number, PdfPageResult>;
}

/** Restorable snapshot of a finished task; the local cache includes a dataUrl, and a new cloud record may save only the stable fileId. */
export interface ImageParseSnapshot {
  attachment: Attachment;
  mode: ImageParseMode;
  /** Key information extraction fields; saved only in kie mode, and used to run recognition again after restore. */
  fields?: readonly string[];
  markdown: string;
  layout: readonly ImageParseLayoutBlock[];
  /** Keep the original recognition range from the server; expiry only limits regeneration and does not affect viewing history. */
  source?: ImageParseSource;
  /** Server rotation-adaptation info; used to restore alignment between the original image and recognition boxes. */
  rotation?: ImageParseRotationInfo;
  /** request_id of this page's recognition; a multi-page example uses it to request a cross-page table merge. */
  requestId?: string;
  pdf?: PdfImageParseSnapshot;
}

/** Full OCR task snapshot, used for cloud restore and compatibility with old browser records. */
export interface ImageParseHistoryEntry {
  id: string;
  createdAt: number;
  snapshot: ImageParseSnapshot;
}

/** The cloud list reads only a summary; the original file and body are fetched on demand when a record is opened. */
export interface ImageParseHistorySummary {
  id: string;
  createdAt: number;
  attachmentId: string;
  name: string;
  /** Recognition mode the record belongs to; the summary is only for display and debugging and does not take part in permission checks. */
  mode?: ImageParseMode;
}

/** User and project must both be present, so an anonymous or cross-project cache is not reused. */
export interface ImageParseHistoryScope {
  userId: string;
  projectId: string;
}

/** Sidebar history entry task; standard is compatible with every non-KIE history mode. */
export type ImageParseHistoryTask = 'standard' | 'kie';

/** Local persistence boundary; failure is absorbed by the calling hook and must not block OCR. */
export interface ImageParseHistoryStorage {
  list: (scope: ImageParseHistoryScope) => Promise<ImageParseHistoryEntry[]>;
  save: (
    scope: ImageParseHistoryScope,
    snapshot: ImageParseSnapshot,
    entryId?: string,
  ) => Promise<ImageParseHistoryEntry>;
  remove: (scope: ImageParseHistoryScope, id: string) => Promise<void>;
}

/** Once identity is ready, read and write cloud personal history. snapshot is a finished, non-demo result. */
export interface UseImageParseHistoryOptions {
  userId?: string | null;
  projectId?: string | null;
  /** Current entry task; standard shows non-KIE history, and kie shows only key information extraction. */
  task?: ImageParseHistoryTask;
  snapshot?: ImageParseSnapshot | null;
}

/** Lightweight list and on-demand restore entry. Any archive failure must not block recognition. */
export interface UseImageParseHistoryResult {
  items: ImageParseHistorySummary[];
  loading: boolean;
  storageError?: string;
  storageNotice?: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMore?: () => void;
  load: (id: string, byAttachment?: boolean) => Promise<ImageParseHistoryEntry | null>;
  save: (snapshot: ImageParseSnapshot) => Promise<boolean>;
  setActiveEntry: (entry: ImageParseHistoryEntry) => void;
  remove: (id: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}
