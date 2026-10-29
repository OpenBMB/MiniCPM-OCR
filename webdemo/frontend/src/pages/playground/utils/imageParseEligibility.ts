import type { Attachment } from '../types';
import type { ImageParseMode } from '@/api/map/imageParseSdk';
import {
  isDocumentImageDataURL,
  isPdfAttachment,
  isPipelineImageMime,
} from './documentUpload';
import { isImageParseSharedExample } from './imageParseExamples';

/** Minimum model context required for document-parsing permission, so utils do not depend on the full Playground hook. */
export interface ImageParseEligibilityModel {
  imageParseModel?: { id: string };
}

/** L2 credential state for document parsing; pipeline tiers do not depend on an API Key, so the caller decides whether to use it. */
export interface ImageParseCredentialModel {
  keysLoading: boolean;
  keyId?: string;
  secretReady: boolean;
  trialAvailable: boolean;
  hasKeys: boolean;
}

/**
 * Return the credential block reason for L2 document recognition.
 * @param model secret-read and trial state of the current account
 * @returns a stable translation key; undefined when credentials are ready
 */
export function imageParseCredentialBlocked(
  model: ImageParseCredentialModel,
): string | undefined {
  if (!model.keysLoading && Boolean(model.keyId) && model.secretReady) return undefined;
  if (model.keysLoading) return 'sendKeyLoading';
  if (!model.trialAvailable && !model.hasKeys) return 'sendNoApiKey';
  return 'sendKeyReading';
}

/** Document-parsing check; a user document needs model permission, and a shared example reads precollected results from the database. */
export function imageParseBlockedReason(
  attachment: Attachment | undefined,
  model: ImageParseEligibilityModel | undefined,
  mode: ImageParseMode = 'scored',
): string | undefined {
  if (!attachment) return 'imageParseNeedImage';
  // Viewing precollected results does not depend on model permission; a shared example cannot be recognized again through this entry.
  if (isImageParseSharedExample(attachment.id)) return undefined;
  if (!model?.imageParseModel?.id) return 'imageParseNoModel';
  if (mode === 'seal' && isPdfAttachment(attachment)) {
    return 'imageParsePipelinePdfUnsupported';
  }
  if (isPdfAttachment(attachment)) return undefined;
  if (attachment.kind !== 'image') return 'imageParseNeedImage';
  {
    // The workspace algorithm tier submits only an OBS file reference; old history may re-upload the local preview first, then start recognition.
    if (!attachment.fileId && !isDocumentImageDataURL(attachment.dataUrl)) {
      return 'imageParseFileReferenceRequired';
    }
    if (!isPipelineImageMime(attachment.mime)) return 'imageParsePipelineImageType';
    return undefined;
  }
}
