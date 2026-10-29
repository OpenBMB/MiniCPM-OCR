import { isImageParsePipelineImageMode } from '@/api/map/imageParseSdk';
import type { useImageParse } from '../hooks/useImageParse';
import { isPdfAttachment } from './documentUpload';

/** 当前任务对用户呈现的互斥阶段。 */
export type ImageParseTaskPhase =
  | 'empty'
  | 'unsupported'
  | 'setup'
  | 'ready'
  | 'running'
  | 'error'
  | 'result';

/**
 * 派生任务对应的操作阶段，避免文档正文被误判为已有字段结果。
 * @param parse 当前识别状态
 * @param setupOpen 是否主动打开字段配置
 * @param uploading 是否仍在上传原件
 * @returns 任务、格式限制和开始操作状态
 */
export function imageParseTaskView(
  parse: ReturnType<typeof useImageParse>,
  setupOpen: boolean,
  uploading: boolean,
) {
  const isPdf = Boolean(parse.attachment && isPdfAttachment(parse.attachment));
  const pipelineMode = isImageParsePipelineImageMode(parse.mode) &&
    !(parse.mode === 'kie' && isPdf);
  const hasKieResult =
    parse.mode === 'kie' && Boolean(parse.finished || parse.markdown || parse.layout.length);
  const showKieSetup =
    parse.mode === 'kie' &&
    (setupOpen || (!hasKieResult && !parse.loading && !parse.error));
  const awaitingStart = Boolean(
    parse.attachment &&
    !parse.loading &&
    !parse.error &&
    !parse.finished &&
    !parse.markdown &&
    !parse.layout.length &&
    !parse.pdf?.completed,
  );
  let phase: ImageParseTaskPhase = 'result';
  if (!parse.attachment) phase = 'empty';
  else if (pipelineMode && isPdf) phase = 'unsupported';
  else if (parse.loading) phase = 'running';
  else if (showKieSetup) phase = 'setup';
  else if (parse.error) phase = 'error';
  else if (awaitingStart) phase = 'ready';
  return {
    phase,
    pipelineMode,
    documentMode: !pipelineMode,
    hasKieResult,
    isPdf,
    showKieSetup,
    awaitingStart,
    showParseAction: !uploading && (phase === 'running' || phase === 'result'),
  };
}
