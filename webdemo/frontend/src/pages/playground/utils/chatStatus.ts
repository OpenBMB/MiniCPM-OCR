/**
 * Playground 联网工具进度文案。
 *
 * 用途：把 L3 BFF 下发的 tool_status 事件映射为用户可见的短文案。
 */

import type { ToolStatusEvent } from '@/api/map/chat';
import type { SearchProgressStep, Translate } from '../types';

/**
 * 将 tool_status 事件转为 UI 状态条文案。
 *
 * 后端自带 message 时原样透传（它比前端枚举更具体）；否则按工具与状态走 i18n。
 * @param status SSE tool_status 事件
 * @param t i18n 翻译函数（playground 命名空间）
 * @returns 用户可见的短文案；无可用文案时返回空串
 */
export function toolStatusText(status: ToolStatusEvent, t: Translate): string {
  if (status.message) return status.message;
  if (status.tool === 'web_search') {
    if (status.status === 'running') return t('toolStatusSearching');
    if (status.status === 'success') {
      return status.result_count
        ? t('toolStatusSearchDoneCount', { count: status.result_count })
        : t('toolStatusSearchDone');
    }
  }
  if (status.tool === 'web_extractor') {
    if (status.status === 'running') return t('toolStatusReading');
    if (status.status === 'success') {
      return status.result_count
        ? t('toolStatusReadDoneCount', { count: status.result_count })
        : t('toolStatusReadDone');
    }
  }
  if (status.status === 'failed') return t('toolStatusFailed');
  return '';
}

/**
 * 将后端工具状态映射为前端过程条阶段。
 *
 * 失败状态细分：reader 工具（web_extractor）失败只影响"读取网页"步骤，不应让整个搜索条
 * 标红（搜索本身已成功），否则用户会误以为"整个联网都失败"。
 * @param status SSE tool_status 事件
 */
export function toolStatusStep(status: ToolStatusEvent): SearchProgressStep {
  const isReader = status.tool === 'web_extractor' || Boolean(status.urls?.length);
  if (status.status === 'failed') {
    // 读网页失败但搜索成功 → 单独阶段，不让主标题变红
    return isReader ? 'browse_failed' : 'failed';
  }
  if (isReader) {
    return status.status === 'success' ? 'found' : 'reading';
  }
  if (status.status === 'success') return 'found';
  return 'searching';
}
