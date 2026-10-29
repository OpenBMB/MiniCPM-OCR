import type { ImageParseMode } from '@/api/map/imageParseSdk';
import type { ImageParseSource } from '@/api/map/imageParseSource';
import type { Attachment } from '../types';
import type { ImageParseLayoutBlock } from './imageParseSample';
import type { ImageParseRotationInfo } from './imageParseSample';
import type { PdfPageResult } from './pdfImageParse';

/** PDF 缓存只保存已结束任务的页结果及阅读位置，不包含解析器或网络请求。 */
export interface PdfImageParseSnapshot {
  page: number;
  pages: number;
  results: Record<number, PdfPageResult>;
}

/** 完成任务的可恢复快照；本地缓存含 dataUrl，云端新记录可只保存稳定 fileId。 */
export interface ImageParseSnapshot {
  attachment: Attachment;
  mode: ImageParseMode;
  /** 关键信息抽取字段；仅 kie 模式保存，恢复后用于重新识别。 */
  fields?: readonly string[];
  markdown: string;
  layout: readonly ImageParseLayoutBlock[];
  /** 保留服务端原始识别范围；有效期只限制重生成，不影响历史查看。 */
  source?: ImageParseSource;
  /** 服务端旋转摆正信息；用于恢复原图与识别框的对齐。 */
  rotation?: ImageParseRotationInfo;
  /** 本页识别的 request_id；多页示例据此请求跨页表格合并。 */
  requestId?: string;
  pdf?: PdfImageParseSnapshot;
}

/** OCR 完整任务快照，用于云端恢复和兼容旧浏览器记录。 */
export interface ImageParseHistoryEntry {
  id: string;
  createdAt: number;
  snapshot: ImageParseSnapshot;
}

/** 云端列表只读取摘要，原始文件和正文在打开记录时按需获取。 */
export interface ImageParseHistorySummary {
  id: string;
  createdAt: number;
  attachmentId: string;
  name: string;
  /** 记录所属识别模式；摘要仅用于展示与调试，不参与权限判断。 */
  mode?: ImageParseMode;
}

/** 用户与项目必须同时存在，避免匿名或跨项目缓存复用。 */
export interface ImageParseHistoryScope {
  userId: string;
  projectId: string;
}

/** 侧栏历史入口任务；standard 兼容全部非 KIE 历史模式。 */
export type ImageParseHistoryTask = 'standard' | 'kie';

/** 本地持久化边界；失败由调用 hook 消化，不能阻断 OCR。 */
export interface ImageParseHistoryStorage {
  list: (scope: ImageParseHistoryScope) => Promise<ImageParseHistoryEntry[]>;
  save: (
    scope: ImageParseHistoryScope,
    snapshot: ImageParseSnapshot,
    entryId?: string,
  ) => Promise<ImageParseHistoryEntry>;
  remove: (scope: ImageParseHistoryScope, id: string) => Promise<void>;
}

/** 身份就绪后读写云端个人历史，snapshot 为已完成且非演示的结果。 */
export interface UseImageParseHistoryOptions {
  userId?: string | null;
  projectId?: string | null;
  /** 当前入口任务；standard 显示非 KIE 历史，kie 只显示关键信息抽取。 */
  task?: ImageParseHistoryTask;
  snapshot?: ImageParseSnapshot | null;
}

/** 轻量列表与按需恢复入口，任何存档失败都不阻断识别。 */
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
