import { useImageParseKieTour } from './useImageParseKieTour';
import { useImageParseTour } from './useImageParseTour';

interface UseImageParseExperienceTourOptions {
  task: 'standard' | 'kie';
  userId?: string;
  projectId?: string;
  ready: boolean;
  hasDocument: boolean;
  standardResultReady: boolean;
  hasKieResult: boolean;
  failed: boolean;
}

/**
 * Choose the document-parsing or key information extraction tour from the current recognition task.
 * @param options task type, account state, and the readiness of the two task kinds
 * @returns the replay entry for the current task's guided tour
 */
export function useImageParseExperienceTour({
  task,
  userId,
  projectId,
  ready,
  hasDocument,
  standardResultReady,
  hasKieResult,
  failed,
}: UseImageParseExperienceTourOptions) {
  const standardTour = useImageParseTour({
    userId,
    enabled: task === 'standard' && Boolean(userId && projectId),
    ready,
    hasDocument,
    resultReady: standardResultReady,
    failed,
  });
  const kieTour = useImageParseKieTour({
    userId,
    enabled: task === 'kie' && Boolean(userId && projectId),
    ready,
    hasDocument,
    // Field configuration and result checking are both phases the tour can continue; an error or a run in progress is paused by ready/failed.
    hasResult: hasKieResult,
    resultReady: hasDocument && ready,
    failed,
  });
  return task === 'kie' ? kieTour : standardTour;
}
