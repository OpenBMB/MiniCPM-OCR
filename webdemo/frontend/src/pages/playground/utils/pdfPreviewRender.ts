import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { readPdfPreviewFrame, rememberPdfPreviewFrame } from './pdfPreviewFrameCache';

/** 将 PDF.js 错误映射为稳定文案，不向页面暴露解析器内部堆栈。 */
export function pdfError(error: unknown): string {
  if (error instanceof Error && error.name === 'PasswordException') return 'documentPdfPassword';
  return 'documentPdfFailed';
}

/** PDF 页面基础尺寸；rotation 只保存文件自带方向。 */
export interface PdfPageGeometry {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
}

/** 未叠加用户缩放的页面占位尺寸，实际显示尺寸由 CSS 变量计算。 */
export interface PdfPageView extends Pick<PdfPageGeometry, 'pageNumber' | 'rotation'> {
  baseWidth: number;
  baseHeight: number;
}

/** 大 PDF 页面尺寸后台测量每批数量，避免一次性占用 PDF.js worker 与主线程。 */
const PDF_GEOMETRY_BATCH_SIZE = 8;

interface PdfProgressiveGeometryOptions {
  document: PDFDocumentProxy;
  anchorPage: number;
  onInitial: (geometries: PdfPageGeometry[]) => void;
  onUpdate: (geometries: PdfPageGeometry[]) => void;
  onError?: (error: unknown) => void;
}

/** 读取单页原始几何信息；失败由调用方决定是否保留估算值。 */
async function measurePdfPageGeometry(
  document: PDFDocumentProxy,
  pageNumber: number,
): Promise<PdfPageGeometry> {
  const pdfPage = await document.getPage(pageNumber);
  const view = pdfPage.getViewport({ scale: 1, rotation: 0 });
  return { pageNumber, width: view.width, height: view.height, rotation: pdfPage.rotate };
}

/** 按锚点页向外扩展测量顺序，优先修正用户即将滚到的相邻页。 */
function createPdfGeometryOrder(anchorPage: number, pageCount: number): number[] {
  const order: number[] = [];
  for (let distance = 1; distance < pageCount; distance += 1) {
    const after = anchorPage + distance;
    const before = anchorPage - distance;
    if (after <= pageCount) order.push(after);
    if (before >= 1) order.push(before);
  }
  return order;
}

/** 只在页面几何确实变化时返回新数组，尺寸相同的页面不会触发重渲染。 */
function mergePdfPageGeometries(
  current: PdfPageGeometry[],
  updates: readonly PdfPageGeometry[],
): PdfPageGeometry[] {
  const next = [...current];
  let changed = false;
  updates.forEach((update) => {
    const index = update.pageNumber - 1;
    const existing = next[index];
    if (
      !existing ||
      existing.width !== update.width ||
      existing.height !== update.height ||
      existing.rotation !== update.rotation
    ) {
      next[index] = update;
      changed = true;
    }
  });
  return changed ? next : current;
}

/** 生成可见页几何签名，让离屏页面尺寸修正不触发当前页重绘。 */
export function createVisiblePdfGeometryKey(
  geometryByPage: ReadonlyMap<number, PdfPageGeometry>,
  pageNumbers: readonly number[],
): string {
  return pageNumbers
    .map((pageNumber) => {
      const geometry = geometryByPage.get(pageNumber);
      return geometry
        ? `${pageNumber}:${geometry.width}:${geometry.height}:${geometry.rotation}`
        : `${pageNumber}:missing`;
    })
    .join('|');
}

/**
 * 先用锚点页发布完整 PDF 骨架，再分批修正其余页面几何。
 *
 * 这样历史记录切换时当前页可以立即渲染，大文档不需要等待所有 `getPage`
 * 调用完成后才出现页面结构。
 */
export function measurePdfPageGeometries({
  document,
  anchorPage,
  onInitial,
  onUpdate,
  onError,
}: PdfProgressiveGeometryOptions): { cancel: () => void } {
  let cancelled = false;
  let timer: number | undefined;
  let timerIsIdle = false;
  const yieldToBrowser = () =>
    new Promise<void>((resolve) => {
      if (typeof window.requestIdleCallback === 'function') {
        timerIsIdle = true;
        timer = window.requestIdleCallback(() => resolve(), { timeout: 500 });
        return;
      }
      timer = window.setTimeout(resolve, 0);
    });
  const run = async () => {
    const pageCount = document.numPages;
    const anchor = Math.min(Math.max(1, anchorPage), pageCount);
    const anchorGeometry = await measurePdfPageGeometry(document, anchor);
    if (cancelled) return;
    const initial = Array.from({ length: pageCount }, (_, index) => ({
      ...anchorGeometry,
      pageNumber: index + 1,
    }));
    let geometries = initial;
    onInitial(geometries);
    const order = createPdfGeometryOrder(anchor, pageCount);
    await yieldToBrowser();
    for (let start = 0; start < order.length; start += PDF_GEOMETRY_BATCH_SIZE) {
      if (cancelled) return;
      const batch = order.slice(start, start + PDF_GEOMETRY_BATCH_SIZE);
      const updates = await Promise.all(
        batch.map((pageNumber) => measurePdfPageGeometry(document, pageNumber)),
      );
      if (cancelled) return;
      const next = mergePdfPageGeometries(geometries, updates);
      if (next !== geometries) {
        geometries = next;
        onUpdate(geometries);
      }
      if (start + PDF_GEOMETRY_BATCH_SIZE < order.length) await yieldToBrowser();
    }
  };
  void run().catch((error: unknown) => {
    if (!cancelled) onError?.(error);
  });
  return {
    cancel: () => {
      cancelled = true;
      if (timer === undefined) return;
      if (timerIsIdle) window.cancelIdleCallback(timer);
      else window.clearTimeout(timer);
    },
  };
}

/** PDF.js 后台绘制完成但尚未提交到 DOM canvas 的一帧。 */
export interface PdfPageFrame {
  buffer: HTMLCanvasElement;
  width: number;
  height: number;
}

/** 单页渲染参数；width 是 PDF 视口的可用内容宽度。 */
export interface PdfPageRenderOptions {
  geometry: PdfPageGeometry;
  availableWidth: number;
  scale: number;
  rotation: number;
  /** 固定案例启用有界像素缓存；显式重试更换版本，普通历史不保留帧。 */
  cacheKey?: string;
}

/**
 * 创建一页 PDF 的后台渲染任务。
 *
 * 任务先在离屏 canvas 完成 PDF.js 绘制，再返回显示尺寸；调用方可把返回帧
 * 原子提交到 DOM canvas，避免缩放或旋转期间出现空白页。
 */
export function createPdfPageRenderTask(
  document: PDFDocumentProxy,
  pageNumber: number,
  options: PdfPageRenderOptions,
  buffer: HTMLCanvasElement,
): { promise: Promise<PdfPageFrame>; cancel: () => void } {
  const { geometry, availableWidth, scale, rotation, cacheKey } = options;
  const key =
    cacheKey === undefined
      ? undefined
      : `${cacheKey}:${pageNumber}:${availableWidth}:${scale}:${rotation}:${window.devicePixelRatio || 1}:${geometry.width}:${geometry.height}:${geometry.rotation}`;
  let task: RenderTask | undefined;
  let cancelled = false;
  const promise = (async (): Promise<PdfPageFrame> => {
    if (key !== undefined) {
      const cached = readPdfPreviewFrame(document, key, buffer);
      if (cached) return cached;
    }
    const pdfPage = await document.getPage(pageNumber);
    if (cancelled) throw new DOMException('Render cancelled', 'AbortError');
    const pageRotation = (geometry.rotation + rotation) % 360;
    const original = pdfPage.getViewport({ scale: 1, rotation: pageRotation });
    const fit = Math.min(Math.max(availableWidth, 0) / original.width, 1.5);
    const view = pdfPage.getViewport({
      scale: Math.max(0.1, fit) * scale,
      rotation: pageRotation,
    });
    const resolution = Math.min(
      window.devicePixelRatio || 1,
      2,
      Math.sqrt(4_000_000 / (view.width * view.height)),
    );
    const pixelView = pdfPage.getViewport({
      scale: view.scale * resolution,
      rotation: pageRotation,
    });
    buffer.width = Math.floor(pixelView.width);
    buffer.height = Math.floor(pixelView.height);
    task = pdfPage.render({ canvas: buffer, viewport: pixelView });
    try {
      await task.promise;
      const frame = { buffer, width: view.width, height: view.height };
      if (!cancelled && key !== undefined) rememberPdfPreviewFrame(document, key, frame);
      return frame;
    } finally {
      pdfPage.cleanup();
    }
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      task?.cancel();
    },
  };
}

/**
 * 从当前页与左右相邻页中找出视口中心最近的页面。
 *
 * 只比较相邻页可以让滚动页码更新保持 O(1)，同时避免页面间隙导致前后页来回震荡。
 */
export function getNearestPdfPage(
  current: number,
  pageCount: number,
  viewportCenter: number,
  pageNodes: ReadonlyMap<number, HTMLElement>,
): number {
  const distanceTo = (pageNumber: number) => {
    const node = pageNodes.get(pageNumber);
    return node
      ? Math.abs(node.offsetTop + node.offsetHeight / 2 - viewportCenter)
      : Number.POSITIVE_INFINITY;
  };
  let nearest = current;
  let distance = distanceTo(current);
  for (const candidate of [current - 1, current + 1]) {
    if (candidate < 1 || candidate > pageCount) continue;
    const candidateDistance = distanceTo(candidate);
    if (candidateDistance < distance) {
      nearest = candidate;
      distance = candidateDistance;
    }
  }
  return nearest;
}
