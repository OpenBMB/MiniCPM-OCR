import { useEffect, useRef } from 'react';

interface ImageParseRecognitionAutoRunOptions {
  upright: boolean;
  recognizeSeal: boolean;
  /** 当前附件是否已有稳定结果；回到识别中时仍保留上一轮的结果标记。 */
  hasResult: boolean;
  /** 附件身份变化时重置上一轮结果标记。 */
  identity?: string;
  /** 使用最新识别参数重新执行当前任务。 */
  onReRun: () => void;
}

/**
 * 摆正变化时自动重跑；印章开关只影响展示，不触发请求。
 * @param options 当前识别参数、结果状态、附件身份和重跑入口
 */
export function useImageParseRecognitionAutoRun({
  upright,
  recognizeSeal: _recognizeSeal,
  hasResult,
  identity,
  onReRun,
}: ImageParseRecognitionAutoRunOptions) {
  const previousOptions = useRef({ upright });
  const previousIdentity = useRef(identity);
  const hadResult = useRef(hasResult);
  const rerun = useRef(onReRun);

  useEffect(() => {
    rerun.current = onReRun;
  }, [onReRun]);

  useEffect(() => {
    if (identity !== previousIdentity.current) {
      previousIdentity.current = identity;
      hadResult.current = hasResult;
    } else if (hasResult) {
      hadResult.current = true;
    }
  }, [hasResult, identity]);

  useEffect(() => {
    const options = previousOptions.current;
    previousOptions.current = { upright };
    const changed = options.upright !== upright;
    if (!changed || !hadResult.current) return;
    rerun.current();
  }, [upright]);
}
