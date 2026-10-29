import type { Attachment } from '../types';
import type { ImageParseMode } from '@/api/map/imageParseSdk';
import {
  isDocumentImageDataURL,
  isPdfAttachment,
  isPipelineImageMime,
} from './documentUpload';
import { isImageParseSharedExample } from './imageParseExamples';

/** 文档解析权限所需的最小模型上下文，避免 utils 依赖完整 Playground hook。 */
export interface ImageParseEligibilityModel {
  imageParseModel?: { id: string };
}

/** 文档解析的 L2 凭据状态；流水线档位不依赖 API Key，因此由调用方决定是否使用。 */
export interface ImageParseCredentialModel {
  keysLoading: boolean;
  keyId?: string;
  secretReady: boolean;
  trialAvailable: boolean;
  hasKeys: boolean;
}

/**
 * 返回 L2 文档识别所需的凭据阻塞原因。
 * @param model 当前账号的密钥读取与试用状态
 * @returns 稳定的翻译键；凭据已就绪时返回 undefined
 */
export function imageParseCredentialBlocked(
  model: ImageParseCredentialModel,
): string | undefined {
  if (!model.keysLoading && Boolean(model.keyId) && model.secretReady) return undefined;
  if (model.keysLoading) return 'sendKeyLoading';
  if (!model.trialAvailable && !model.hasKeys) return 'sendNoApiKey';
  return 'sendKeyReading';
}

/** 文档解析校验；用户文档需要模型权限，共享案例读取数据库预采集结果。 */
export function imageParseBlockedReason(
  attachment: Attachment | undefined,
  model: ImageParseEligibilityModel | undefined,
  mode: ImageParseMode = 'scored',
): string | undefined {
  if (!attachment) return 'imageParseNeedImage';
  // 查看预采集结果不依赖模型权限；共享案例不允许通过此入口重新识别。
  if (isImageParseSharedExample(attachment.id)) return undefined;
  if (!model?.imageParseModel?.id) return 'imageParseNoModel';
  if (mode === 'seal' && isPdfAttachment(attachment)) {
    return 'imageParsePipelinePdfUnsupported';
  }
  if (isPdfAttachment(attachment)) return undefined;
  if (attachment.kind !== 'image') return 'imageParseNeedImage';
  {
    // 工作台算法档位只提交 OBS 文件引用；旧历史可先补传本地预览，再发起识别。
    if (!attachment.fileId && !isDocumentImageDataURL(attachment.dataUrl)) {
      return 'imageParseFileReferenceRequired';
    }
    if (!isPipelineImageMime(attachment.mime)) return 'imageParsePipelineImageType';
    return undefined;
  }
}
