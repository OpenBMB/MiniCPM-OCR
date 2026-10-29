/**
 * 算法侧图像解析流水线的前端适配层。
 *
 * 浏览器只调用 MAP L3 的同源接口；流水线地址、无鉴权上游接口与任务归属
 * 均由后端持有。印章/关键信息抽取不沿用 L2 API Key 链路。
 */

import { BizError } from '@map/types';
import type { QueryClient } from '@tanstack/react-query';
import { adaptImageParseV2 } from './imageParseV2';
import { runImageParseJob } from './imageParseJobs';
import { validateImageParseSdkResult, type ImageParseSdkResult } from './imageParseSdk';
import { mapRequest } from './request';
import {
  imageParseKieFieldsError,
  normalizeImageParseKieFields,
} from '@/pages/playground/utils/imageParseKie';

export interface ImageParsePipelineCapabilities {
  enabled: boolean;
  modes: readonly string[];
  seal: boolean;
  kie: boolean;
  upright: boolean;
}

const EMPTY_CAPABILITIES: ImageParsePipelineCapabilities = {
  enabled: false,
  modes: [],
  seal: false,
  kie: false,
  upright: true,
};

function parseCapabilities(value: unknown): ImageParsePipelineCapabilities {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_CAPABILITIES;
  const raw = value as Record<string, unknown>;
  const modes = Array.isArray(raw.modes)
    ? raw.modes.filter((mode): mode is string => typeof mode === 'string')
    : [];
  // 兼容算法文档的 enabled/modes 契约。旧版 MAP 只返回 enabled，
  // 不能仅凭它开放流水线入口；必须看到 modes 声明。
  const enabled =
    raw.pipeline === true ||
    (raw.pipeline === undefined &&
      raw.enabled === true &&
      Array.isArray(raw.modes) &&
      modes.includes('standard'));
  return {
    enabled,
    modes: enabled ? modes : [],
    seal: enabled && raw.seal === true,
    kie: enabled && raw.kie === true,
    upright: !enabled || raw.upright !== false,
  };
}

/**
 * 探测流水线能力。缓存与重试由调用方的 TanStack Query 负责，失败时向上抛出。
 * @param signal 页面或查询生命周期信号
 * @returns 归一化能力；响应结构不合法时安全降级为不可用
 */
export async function loadImageParsePipelineCapabilities(
  signal?: AbortSignal,
): Promise<ImageParsePipelineCapabilities> {
  const raw = await mapRequest<unknown>('/image-parse/capabilities', { signal });
  return parseCapabilities(raw);
}

function pipelineError(error: unknown): unknown {
  if (!(error instanceof BizError)) return error;
  if (/^imageParse[A-Z]/.test(error.message)) return new Error(error.message);
  return new Error('imageParseRequestFailed');
}

export type ImageParsePipelineTask = 'standard' | 'seal' | 'kie';

interface ImageParsePipelineBaseInput {
  mode: ImageParsePipelineTask;
  model: string;
  fields?: readonly string[];
  pageIndex?: number;
  upright?: boolean;
  recognizeSeal?: boolean;
  recognizeChart?: boolean;
  signal: AbortSignal;
  queryClient?: QueryClient;
}

/**
 * 工作台仅传文件服务 fileId，经 MAP 异步任务执行。
 * fileUrl 和 inline image 仅兼容旧调用方，不是工作台回退路径。
 */
export type ImageParsePipelineInput = ImageParsePipelineBaseInput &
  (
    | { fileId: string; fileUrl?: never; image?: never }
    | { fileUrl: string; fileId?: never; image?: never }
    | { image: string; fileId?: never; fileUrl?: never }
  );

/** 单图 fileId 走异步任务；旧 URL/内联调用保留同步契约，均由 L3 校验。 */
export async function parseImagePipeline(
  input: ImageParsePipelineInput,
): Promise<ImageParseSdkResult> {
  const model = input.model.trim();
  if (!model) throw new Error('imageParseNoModel');
  const fileId = input.fileId?.trim() ?? '';
  const fileUrl = input.fileUrl?.trim() ?? '';
  const image = input.image?.trim() ?? '';
  if ([fileId, fileUrl, image].filter(Boolean).length !== 1) {
    throw new Error('imageParseFileReferenceRequired');
  }
  const fields =
    input.mode === 'kie' ? normalizeImageParseKieFields(input.fields ?? []) : undefined;
  if (input.mode === 'kie') {
    const error = imageParseKieFieldsError(fields ?? []);
    if (error) throw new Error(error);
  }
  let raw: unknown;
  try {
    if (fileId) {
      const job = await runImageParseJob({
        task: input.mode,
        model,
        fileId,
        upright: input.upright !== false,
        recognizeSeal: true,
        ...(input.mode === 'standard' ? { recognizeChart: true } : {}),
        signal: input.signal,
        ...(fields ? { fields } : {}),
        ...(input.pageIndex !== undefined ? { pageIndex: input.pageIndex } : {}),
        ...(input.queryClient ? { queryClient: input.queryClient } : {}),
      });
      if (job.pages?.length !== 1) throw new Error('imageParseInvalidResult');
      raw = job.pages[0];
    } else
      raw = await mapRequest<unknown>('/image-parse/pipeline', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: JSON.stringify({
          model,
          task: input.mode,
          ...(fileUrl ? { file_url: fileUrl } : { image }),
          ...(input.mode === 'standard'
            ? {
                page_index: input.pageIndex ?? 0,
                upright: input.upright !== false,
                recognize_seal: true,
                recognize_chart: true,
              }
            : {}),
          ...(fields ? { fields } : {}),
        }),
        signal: input.signal,
      });
  } catch (error) {
    throw pipelineError(error);
  }
  if (!raw || typeof raw !== 'object') throw new Error('imageParseInvalidResult');
  const response = raw as Parameters<typeof adaptImageParseV2>[0];
  if (
    input.mode === 'standard' &&
    response.metadata?.page_index !== undefined &&
    response.metadata.page_index !== (input.pageIndex ?? 0)
  )
    throw new Error('imageParseInvalidResult');
  const result = adaptImageParseV2(response);
  // 算法流水线不提供重算凭据，旧历史来源不能被新响应重新启用。
  delete result.source;
  return validateImageParseSdkResult(result, {
    allowEmptyMarkdown: input.mode === 'seal',
  });
}
