import { useState } from 'react';

/**
 * 隔离字段配置草稿与已提交字段，同一文件切换任务时保留尚未提交的配置。
 * @param applied 当前结果对应的已提交字段
 * @param documentKey 文件与账号范围标识
 * @returns 配置字段、更新和放弃草稿入口
 */
export function useImageParseFieldDraft(applied: readonly string[], documentKey: string) {
  const [draft, setDraft] = useState<{ key: string; fields: string[] }>();
  return {
    fields: draft?.key === documentKey ? draft.fields : applied,
    setFields: (fields: string[]) => setDraft({ key: documentKey, fields: [...fields] }),
    reset: () => setDraft(undefined),
  };
}
