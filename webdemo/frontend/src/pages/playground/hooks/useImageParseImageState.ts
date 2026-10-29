import { useCallback, useRef, useState } from 'react';
import {
  IMAGE_PARSE_DEFAULT_MODE,
  isImageParsePipelineImageMode,
  type ImageParseMode,
} from '@/api/map/imageParseSdk';
import type { ImageParseSource } from '@/api/map/imageParseSource';

import type { Attachment } from '../types';
import type { ImageParseLayoutBlock, ImageParseRotationInfo } from '../utils/imageParseSample';
import { isImageParseSharedExample } from '../utils/imageParseExamples';
import { isPdfAttachment } from '../utils/documentUpload';
import { useAttachmentPreview } from './useAttachmentPreview';
import { useImageParseCrops } from './useImageParseCrops';
import { useImageParseTaskState } from './useImageParseTaskState';

/**
 * Maintain the single-image raw result and request identity; when the file is replaced, clear the old state together.
 * @param autoParse whether to stay compatible with automatic recognition after upload
 * @param autoParseOnUpload whether to start full-text recognition automatically only when a new file is ready
 * @returns the original, the result, task options, and the state-write entry
 */
export function useImageParseImageState(
  autoParse: boolean,
  autoParseOnUpload = false,
  initialMode: ImageParseMode = IMAGE_PARSE_DEFAULT_MODE,
) {
  const [attachment, setAttachment] = useState<Attachment>();
  useAttachmentPreview(attachment);
  const [markdown, setMarkdown] = useState('');
  const [source, setSource] = useState<ImageParseSource>();
  const [rotation, setRotation] = useState<ImageParseRotationInfo>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [finished, setFinished] = useState(false);
  const [layout, setLayout] = useState<readonly ImageParseLayoutBlock[]>([]);
  const [resultRevision, setResultRevision] = useState(0);
  const { crops, clearCrops, loadCrops } = useImageParseCrops();
  const sharedExample = Boolean(attachment && isImageParseSharedExample(attachment.id));
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const pendingAuto = useRef(false);
  const cancel = useCallback(() => {
    active.current?.abort();
    active.current = null;
    generation.current += 1;
    pendingAuto.current = false;
  }, []);
  const task = useImageParseTaskState({
    pendingAutoRef: pendingAuto,
    cancel,
    sharedExample,
    initialMode,
  });
  const { mode, setMode, setFields } = task;
  const setImage = useCallback(
    (next?: Attachment) => {
      cancel();
      if (autoParse && next && isPdfAttachment(next) && mode === 'seal')
        setMode(IMAGE_PARSE_DEFAULT_MODE);
      setAttachment(next);
      setMarkdown('');
      setSource(undefined);
      setRotation(undefined);
      setLayout([]);
      clearCrops();
      setError(undefined);
      setLoading(false);
      setFinished(false);
      pendingAuto.current = Boolean(
        autoParse &&
        next &&
        !isImageParseSharedExample(next.id) &&
        !isPdfAttachment(next) &&
        mode !== 'kie',
      );
    },
    [autoParse, cancel, clearCrops, mode, setMode],
  );
  const setAttachmentReference = useCallback(
    (reference: { fileId?: string; publicUrl?: string }) => {
      setAttachment((current) => {
        if (!current) return current;
        const fileId = reference.fileId?.trim() || undefined;
        const publicUrl = reference.publicUrl?.trim() || undefined;
        if (current.fileId === fileId && current.publicUrl === publicUrl) return current;
        return { ...current, fileId, publicUrl };
      });
    },
    [],
  );
  const setDocument = useCallback(
    (next?: Attachment) => {
      setFields([]);
      setImage(next);
      if (
        autoParseOnUpload &&
        next &&
        !isImageParseSharedExample(next.id) &&
        !isImageParsePipelineImageMode(mode)
      )
        pendingAuto.current = true;
    },
    [autoParseOnUpload, mode, setFields, setImage],
  );
  return {
    ...task,
    attachment,
    markdown,
    source,
    rotation,
    error,
    loading,
    finished,
    layout,
    resultRevision,
    setResultRevision,
    setMarkdown,
    setSource,
    setRotation,
    setError,
    setLoading,
    setFinished,
    setLayout,
    crops,
    clearCrops,
    loadCrops,
    sharedExample,
    active,
    generation,
    pendingAuto,
    cancel,
    setImage,
    setDocument,
    setAttachmentReference,
  };
}
