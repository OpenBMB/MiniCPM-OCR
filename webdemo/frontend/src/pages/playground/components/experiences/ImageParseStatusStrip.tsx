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
 * 工作台顶部的上传状态条；识别错误由结果区域承接。
 * @param props 模型凭据、解析状态、上传生命周期与流水线档位
 * @returns 与当前状态匹配的状态条组合
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
