import { useState } from 'react';

/**
 * 顶栏与复核列表共用筛选和分页；换结果立即重置，切标签保留当前进度。
 * @param resultKey 当前解析结果标识
 * @returns 筛选、展示条数及对应操作
 */
export function useImageParseReview(resultKey: string) {
  const [state, setState] = useState({ resultKey, all: false, limit: 40 });
  // 与结果身份一起重置，避免新文档短暂使用旧筛选，或返回旧文档时恢复过期分页。
  if (state.resultKey !== resultKey) {
    setState({ resultKey, all: false, limit: 40 });
  }
  return {
    all: state.all,
    limit: state.limit,
    toggleAll: () => setState((current) => ({ ...current, all: !current.all, limit: 40 })),
    loadMore: () => setState((current) => ({ ...current, limit: current.limit + 40 })),
  };
}
