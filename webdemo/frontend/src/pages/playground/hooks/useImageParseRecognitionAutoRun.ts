import { useEffect, useRef } from 'react';

interface ImageParseRecognitionAutoRunOptions {
  upright: boolean;
  recognizeSeal: boolean;
  /** Whether the current attachment already has a stable result; while it returns to recognizing, the previous round's result mark is still kept. */
  hasResult: boolean;
  /** Reset the previous round's result mark when the attachment identity changes. */
  identity?: string;
  /** Run the current task again with the latest recognition parameters. */
  onReRun: () => void;
}

/**
 * Re-run automatically when rotation adaptation changes; the seal switch only affects display and does not trigger a request.
 * @param options current recognition parameters, result state, attachment identity, and the rerun entry
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
