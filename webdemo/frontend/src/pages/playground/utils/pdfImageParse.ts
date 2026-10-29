/** 原始 PDF 只提交一个 MAP 任务；本地渲染仅用于预览和按需裁图。 */
import type { QueryClient } from '@tanstack/react-query';

import { runImageParseJob, type ImageParseJob } from '@/api/map/imageParseJobs';
import { adaptImageParseV2 } from '@/api/map/imageParseV2';
import {
  validateImageParseSdkResult,
  type ImageParseMode,
  type ImageParseSdkResult,
} from '@/api/map/imageParseSdk';

import type { Attachment } from '../types';
import { ensureImageParseFileReference } from './imageParseFileReference';
import { MAX_PDF_PAGES } from './documentUpload';
import { pdfParseErrorKey } from './pdfImageParseStatus';

export interface PdfPageResult {
  result?: ImageParseSdkResult;
  crops?: readonly string[];
  error?: string;
}

/** PDF 执行上下文；查询复用门户 QueryClient，KIE 字段原样交给任务客户端校验。 */
export interface PdfImageParseJobOptions {
  queryClient?: QueryClient;
  fields?: readonly string[];
}

/**
 * 用原 PDF fileId 创建整份任务，增量结果按零起始 metadata.page_index 归档。
 * @param source 本地 PDF 预览地址，仅在原件缺少 fileId 时用于补传
 * @param mode 识别任务，历史档位映射为 standard；seal 不支持 PDF
 * @param model 当前可用的 OCR 模型
 * @param projectId 原件补传所需项目
 * @param signal 任务生命周期；取消由任务客户端 DELETE
 * @param onOpen 整份文档页数，不用单页重试的任务页数覆盖原件页数
 * @param onPage 一起始页面结果；裁图由既有 hooks 按需生成
 * @param onlyPage 可选的一起始原件重试页
 * @param _getPriorityPage 兼容旧调用签名；页调度由 MAP 持有
 * @param skipPages 本地已完成页，仅跳过展示，不改变后端原件任务
 * @param upright 摆正开关
 * @param _recognizeSeal 兼容旧调用方；后端始终开启印章识别
 * @param attachment 原 PDF 附件，优先复用已上传的 fileId
 * @param options 查询客户端及可选 KIE 字段
 */
export async function parsePdfPages(
  source: string,
  mode: ImageParseMode,
  model: string,
  projectId: string,
  signal: AbortSignal,
  onOpen: (pages: number) => void,
  onPage: (index: number, page: PdfPageResult) => void,
  onlyPage?: number,
  _getPriorityPage?: () => number,
  skipPages?: ReadonlySet<number>,
  upright = true,
  _recognizeSeal = true,
  attachment?: Attachment,
  options?: PdfImageParseJobOptions,
): Promise<void> {
  signal.throwIfAborted();
  if (!model?.trim()) throw new Error('imageParseNoModel');
  if (mode === 'seal') throw new Error('imageParsePipelinePdfUnsupported');
  if (onlyPage !== undefined && (!Number.isSafeInteger(onlyPage) || onlyPage < 1))
    throw new Error('documentPdfFailed');
  const reference = await ensureImageParseFileReference({
    attachment: attachment ?? {
      id: 'pdf-original',
      kind: 'file',
      mime: 'application/pdf',
      name: 'document.pdf',
      size: 0,
      dataUrl: source,
    },
    projectId,
    signal,
  });
  signal.throwIfAborted();
  let total = 0;
  const published = new Set<number>();
  const publish = (job: ImageParseJob) => {
    signal.throwIfAborted();
    if (job.pages_total > MAX_PDF_PAGES) throw new Error('imageParsePdfTooManyPages');
    if (onlyPage === undefined && job.pages_total > 0 && total !== job.pages_total) {
      total = job.pages_total;
      onOpen(total);
    }
    for (const page of job.pages ?? []) {
      const index = page?.metadata?.page_index;
      if (
        index === undefined ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= MAX_PDF_PAGES ||
        (onlyPage !== undefined ? index !== onlyPage - 1 : index >= total)
      )
        throw new Error('imageParseInvalidResult');
      const number = index + 1;
      if (skipPages?.has(number) || published.has(number)) continue;
      signal.throwIfAborted();
      let value: PdfPageResult;
      try {
        const result = adaptImageParseV2(page);
        delete result.source;
        value = { result: validateImageParseSdkResult(result) };
      } catch (failure) {
        value = { error: pdfParseErrorKey(failure) };
      }
      published.add(number);
      onPage(number, value);
    }
  };
  try {
    const job = await runImageParseJob({
      task: mode === 'kie' ? 'kie' : 'standard',
      model,
      fileId: reference.fileId,
      upright,
      recognizeSeal: true,
      signal,
      onProgress: publish,
      ...(onlyPage !== undefined ? { pageIndex: onlyPage - 1 } : {}),
      ...(options?.queryClient ? { queryClient: options.queryClient } : {}),
      ...(mode === 'kie' ? { fields: options?.fields } : {}),
    });
    publish(job);
    if (
      job.status === 'Success' &&
      (onlyPage !== undefined
        ? [onlyPage]
        : Array.from({ length: total }, (_, index) => index + 1)
      ).some(
        (index) => !skipPages?.has(index) && !published.has(index),
      )
    ) {
      throw new Error('imageParseInvalidResult');
    }
  } catch (failure) {
    signal.throwIfAborted();
    const error = pdfParseErrorKey(failure);
    const remaining =
      onlyPage === undefined ? Array.from({ length: total }, (_, index) => index + 1) : [onlyPage];
    for (const index of remaining)
      if (!published.has(index) && !skipPages?.has(index)) onPage(index, { error });
    throw failure;
  }
}
