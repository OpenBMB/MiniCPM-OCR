import type { useDocumentUpload } from '../../hooks/useDocumentUpload';
import type { useImageParse } from '../../hooks/useImageParse';
import type { usePlaygroundModel } from '../../hooks/usePlaygroundModel';
import { DocumentUploadStatus } from './DocumentUploadStatus';

interface ImageParseStatusStripProps {
  model: ReturnType<typeof usePlaygroundModel>;
  parse: ReturnType<typeof useImageParse>;
  upload: ReturnType<typeof useDocumentUpload>;
  pipelineMode: boolean;
  showUploadStatus: boolean;
}

/**
 * Upload status bar at the top of the workspace; recognition errors are carried by the result area.
 * @param props Model credentials, parse state, upload lifecycle, and pipeline tier
 * @returns The status-bar combination that matches the current state
 */
export function ImageParseStatusStrip({
  parse,
  upload,
  showUploadStatus,
}: ImageParseStatusStripProps) {
  return (
    <>
      {parse.attachment && upload.error ? <DocumentUploadStatus upload={upload} inline /> : null}
      {showUploadStatus ? <DocumentUploadStatus upload={upload} /> : null}
    </>
  );
}
