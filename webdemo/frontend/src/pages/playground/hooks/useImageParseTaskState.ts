import { useCallback, useEffect, useState, type MutableRefObject } from 'react';

import {
  IMAGE_PARSE_DEFAULT_MODE,
  isImageParsePipelineMode,
  type ImageParseMode,
} from '@/api/map/imageParseSdk';

import { imageParseKieFieldsError } from '../utils/imageParseKie';

interface ImageParseTaskStateOptions {
  pendingAutoRef: MutableRefObject<boolean>;
  cancel: () => void;
  sharedExample: boolean;
  initialMode?: ImageParseMode;
}

/**
 * Maintain the task, extraction fields, rotation adaptation, and seal and chart display options.
 * @param options the automatic-recognition flag, the cancel entry, and shared-example state
 * @returns the current task state and the controlled switch functions
 */
export function useImageParseTaskState({
  pendingAutoRef,
  cancel,
  sharedExample,
  initialMode = IMAGE_PARSE_DEFAULT_MODE,
}: ImageParseTaskStateOptions) {
  const [mode, setMode] = useState<ImageParseMode>(initialMode);
  const [fields, setFields] = useState<string[]>([]);
  const [upright, setUpright] = useState(true);
  const [recognizeSeal, setRecognizeSeal] = useState(true);
  const [recognizeChart, setRecognizeChart] = useState(true);
  // Key information extraction must have at least one legal field; with no fields, do not automatically start a request that is bound to fail.
  useEffect(() => {
    if (mode === 'kie' && imageParseKieFieldsError(fields)) {
      pendingAutoRef.current = false;
    }
  }, [fields, mode, pendingAutoRef]);
  const selectMode = useCallback(
    (next: ImageParseMode) => {
      if (next === mode || sharedExample) return;
      // Abort synchronously at the moment of the click, so an old callback does not write before the effect runs after the mode switches.
      cancel();
      setMode(next);
    },
    [cancel, mode, sharedExample],
  );
  return {
    mode,
    fields,
    setFields,
    upright,
    setUpright,
    recognizeSeal,
    setRecognizeSeal,
    recognizeChart,
    setRecognizeChart,
    pipelineMode: isImageParsePipelineMode(mode),
    setMode: selectMode,
  };
}
