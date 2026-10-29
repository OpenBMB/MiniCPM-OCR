import { isImageParsePipelineImageMode } from '@/api/map/imageParseSdk';
import type { useImageParse } from '../hooks/useImageParse';
import { isPdfAttachment } from './documentUpload';

/** Mutually exclusive phase the current task shows the user. */
export type ImageParseTaskPhase =
  | 'empty'
  | 'unsupported'
  | 'setup'
  | 'ready'
  | 'running'
  | 'error'
  | 'result';

/**
 * Derive the operation phase for the task, so document body text is not mistaken for an existing field result.
 * @param parse current recognition state
 * @param setupOpen whether field configuration was opened on purpose
 * @param uploading whether the original is still uploading
 * @returns task, format limits, and start-operation state
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
