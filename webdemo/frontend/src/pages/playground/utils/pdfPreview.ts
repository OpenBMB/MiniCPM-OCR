/** PDF.js 读取本地文件：原文预览与逐页转图共用加载配置。 */
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { trimEmptyPdfRevision } from './pdfPreviewSource';
import { isImageParseSharedPdfUrl } from './imageParseExamples';
import { clearPdfPreviewFrames } from './pdfPreviewFrameCache';

// 已发布的 worker 曾以 octet-stream 缓存一年；改用新 URL 避免继续命中旧响应头。
GlobalWorkerOptions.workerSrc = `${workerUrl}${workerUrl.includes('?') ? '&' : '?'}mime=js`;

/** 历史切换常用的 PDF 文档短缓存时长与容量，避免频繁重复解析同一原件。 */
const PDF_PREVIEW_CACHE_TTL_MS = 30_000;
const PDF_PREVIEW_CACHE_MAX = 2;
const SHARED_PDF_CACHE_TTL_MS = 300_000;
const SHARED_PDF_CACHE_MAX = 4;

interface PdfPreviewCacheEntry {
  task: PDFDocumentLoadingTask;
  refs: number;
  releaseTimer?: number;
}

const pdfPreviewCache = new Map<string, PdfPreviewCacheEntry>();

/** 真正销毁底层 PDF.js 任务；吞掉重复销毁等非关键清理错误。 */
function destroyPdfPreviewEntry(source: string, entry: PdfPreviewCacheEntry) {
  if (entry.releaseTimer !== undefined) window.clearTimeout(entry.releaseTimer);
  entry.releaseTimer = undefined;
  if (pdfPreviewCache.get(source) === entry) pdfPreviewCache.delete(source);
  void entry.task.promise.then(clearPdfPreviewFrames).catch(() => undefined);
  void entry.task.destroy().catch(() => undefined);
}

/** 释放一个引用；最后一个引用离开后再延迟销毁，给历史切换留出复用窗口。 */
function releasePdfPreviewEntry(source: string, entry: PdfPreviewCacheEntry) {
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0 || entry.releaseTimer !== undefined) return;
  entry.releaseTimer = window.setTimeout(
    () => {
      entry.releaseTimer = undefined;
      if (entry.refs === 0) destroyPdfPreviewEntry(source, entry);
    },
    isImageParseSharedPdfUrl(source) ? SHARED_PDF_CACHE_TTL_MS : PDF_PREVIEW_CACHE_TTL_MS,
  );
}

/** 容量满时优先淘汰没有引用的文档，避免常驻过多大 PDF。 */
function evictIdlePdfPreviewEntry(shared: boolean) {
  for (const [source, entry] of pdfPreviewCache) {
    if (entry.refs === 0 && isImageParseSharedPdfUrl(source) === shared) {
      destroyPdfPreviewEntry(source, entry);
      return;
    }
  }
}

/** 读取或创建 PDF.js 任务；失败任务不留在缓存中。 */
function acquirePdfPreviewTask(source: string) {
  const cached = pdfPreviewCache.get(source);
  if (cached) {
    if (cached.releaseTimer !== undefined) {
      window.clearTimeout(cached.releaseTimer);
      cached.releaseTimer = undefined;
    }
    cached.refs += 1;
    pdfPreviewCache.delete(source);
    pdfPreviewCache.set(source, cached);
    return cached;
  }

  const shared = isImageParseSharedPdfUrl(source);
  const count = [...pdfPreviewCache.keys()].filter(
    (key) => isImageParseSharedPdfUrl(key) === shared,
  ).length;
  if (count >= (shared ? SHARED_PDF_CACHE_MAX : PDF_PREVIEW_CACHE_MAX))
    evictIdlePdfPreviewEntry(shared);
  const data = source.startsWith('data:')
    ? trimEmptyPdfRevision(
        Uint8Array.from(atob(source.slice(source.indexOf(',') + 1)), (char) => char.charCodeAt(0)),
      )
    : undefined;
  const task = getDocument({
    ...(data ? { data } : { url: source }),
    cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
    wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
    isEvalSupported: false,
  });
  const entry: PdfPreviewCacheEntry = { task, refs: 1 };
  pdfPreviewCache.set(source, entry);
  // 解析失败时不能让后续历史切换继续拿到同一个失败 Promise。
  void task.promise.catch(() => {
    if (pdfPreviewCache.get(source) === entry) pdfPreviewCache.delete(source);
    if (entry.refs === 0) destroyPdfPreviewEntry(source, entry);
  });
  return entry;
}

/**
 * 创建可销毁的 PDF 读取任务，附属资源固定为同源静态文件。
 *
 * 同一地址在短时间内复用底层文档，用于加速左侧历史记录来回切换；调用方的
 * destroy 只释放引用，最后一个引用释放后延迟清理 PDF.js 资源。
 */
export function loadPdfPreview(source: string) {
  const entry = acquirePdfPreviewTask(source);
  let released = false;
  return {
    promise: entry.task.promise,
    destroy: () => {
      if (released) return Promise.resolve();
      released = true;
      releasePdfPreviewEntry(source, entry);
      return Promise.resolve();
    },
  };
}
