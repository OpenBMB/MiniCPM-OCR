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
 * 维护任务、抽取字段、摆正、印章和图表展示选项。
 * @param options 自动识别标记、取消入口与共享案例状态
 * @returns 当前任务状态与受控切换函数
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
  // 信息抽取必须至少有一个合法字段；无字段时不自动发起必然失败的请求。
  useEffect(() => {
    if (mode === 'kie' && imageParseKieFieldsError(fields)) {
      pendingAutoRef.current = false;
    }
  }, [fields, mode, pendingAutoRef]);
  const selectMode = useCallback(
    (next: ImageParseMode) => {
      if (next === mode || sharedExample) return;
      // 点击当下同步中止，避免切换模式后旧回调在 effect 执行前写入。
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
