import { useLocation, useNavigate } from 'react-router-dom';
import { experiencePath } from '../utils/experienceRoute';
import { writeCurrentImageParseId } from '../utils/imageParseCurrent';
import type { ImageParseHistoryEntry } from '../utils/imageParseHistoryTypes';

/** The two document entries each save the current pointer; the full-text entry keeps the original storage scope. */
function taskScope(userId: unknown, projectId: unknown, task: 'standard' | 'kie') {
  return JSON.stringify(task === 'kie' ? [userId, projectId, task] : [userId, projectId]);
}

/**
 * Jump history to the matching task entry, passing only the isolation scope, and do not write the file or the body into route state.
 * @param options current identity, the fixed task, and the sidebar's new-item intent
 * @returns the current storage scope, restore intent, and the entry-jump command
 */
export function useImageParseEntryNavigation({
  userId,
  projectId,
  task,
  startFresh,
}: {
  userId?: string | null;
  projectId?: string | null;
  task: 'standard' | 'kie';
  startFresh: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const scope = taskScope(userId, projectId, task);
  const state: unknown = location.state;
  const restoreRequested =
    typeof state === 'object' &&
    state !== null &&
    'restoreImageParseScope' in state &&
    state.restoreImageParseScope === scope;
  return {
    scope,
    startFresh: startFresh && !restoreRequested,
    openEntry(entry: ImageParseHistoryEntry) {
      const target = entry.snapshot.mode === 'kie' ? 'kie' : 'standard';
      const targetScope = taskScope(userId, projectId, target);
      writeCurrentImageParseId(targetScope, entry.snapshot.attachment.id);
      navigate(experiencePath(target === 'kie' ? 'field-extract' : 'image-parse'), {
        state: { restoreImageParseScope: targetScope },
      });
    },
    openDocument() {
      navigate(experiencePath('image-parse'));
    },
  };
}
