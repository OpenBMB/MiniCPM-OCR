import { useLocation, useNavigate } from 'react-router-dom';
import { experiencePath } from '../utils/experienceRoute';
import { writeCurrentImageParseId } from '../utils/imageParseCurrent';
import type { ImageParseHistoryEntry } from '../utils/imageParseHistoryTypes';

/** 两个文档入口分别保存当前指针；全文入口沿用原有存储范围。 */
function taskScope(userId: unknown, projectId: unknown, task: 'standard' | 'kie') {
  return JSON.stringify(task === 'kie' ? [userId, projectId, task] : [userId, projectId]);
}

/**
 * 将历史跳转到对应任务入口，只传隔离范围，不把文件或正文写入路由状态。
 * @param options 当前身份、固定任务及侧栏新建意图
 * @returns 当前存储范围、恢复意图与入口跳转命令
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
