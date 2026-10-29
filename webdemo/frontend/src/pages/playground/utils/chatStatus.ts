/**
 * Playground web-search tool progress copy.
 *
 * Purpose: map tool_status events from the L3 BFF to short user-visible copy.
 */

import type { ToolStatusEvent } from '@/api/map/chat';
import type { SearchProgressStep, Translate } from '../types';

/**
 * Turn a tool_status event into status-bar copy for the UI.
 *
 * When the backend includes a message, pass it through (it is more specific than the frontend enum); otherwise use i18n by tool and status.
 * @param status SSE tool_status event
 * @param t i18n translate function (playground namespace)
 * @returns short user-visible copy; an empty string when none is available
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
 * Map a backend tool status to a frontend process-bar phase.
 *
 * Failure is split: a reader-tool (web_extractor) failure only affects the "read the page" step and must not turn the whole search bar
 * red (search itself already succeeded), or the user would think the entire web search failed.
 * @param status SSE tool_status event
 */
export function toolStatusStep(status: ToolStatusEvent): SearchProgressStep {
  const isReader = status.tool === 'web_extractor' || Boolean(status.urls?.length);
  if (status.status === 'failed') {
    // Page read failed but search succeeded → its own phase, so the main title does not turn red
    return isReader ? 'browse_failed' : 'failed';
  }
  if (isReader) {
    return status.status === 'success' ? 'found' : 'reading';
  }
  if (status.status === 'success') return 'found';
  return 'searching';
}
