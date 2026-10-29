import { useState, type ClipboardEvent } from 'react';

import { imageParseKieFieldsError, splitImageParseKieFields } from '../utils/imageParseKie';

/**
 * 编排单个或批量字段输入，失败保留草稿；主操作包含尚未加入列表的输入。
 * @param fields 已配置的字段
 * @param onChange 字段列表更新入口
 * @returns 输入草稿、即时错误、待提交字段与添加结果
 */
export function useImageParseKieFieldEditor(
  fields: readonly string[],
  onChange: (fields: string[]) => void,
) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();
  const pending = splitImageParseKieFields(draft);
  const submissionFields = [...fields, ...pending];
  const submissionError = imageParseKieFieldsError(submissionFields);

  function updateDraft(value: string) {
    setDraft(value);
    setError(undefined);
  }

  function add(value = draft): boolean {
    const additions = splitImageParseKieFields(value);
    if (!additions.length) return false;
    const candidate = [...fields, ...additions];
    const nextError = imageParseKieFieldsError(candidate);
    if (nextError) {
      setDraft(value);
      setError(nextError);
      return false;
    }
    setDraft('');
    setError(undefined);
    onChange(candidate);
    return true;
  }

  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const text = event.clipboardData.getData('text/plain');
    if (splitImageParseKieFields(text).length < 2) return;
    event.preventDefault();
    const input = event.currentTarget;
    // 合并选区前后的草稿，避免粘贴批量字段时丢掉已经输入的文字。
    const value = draft.slice(0, input.selectionStart) + text + draft.slice(input.selectionEnd);
    add(value);
  }

  return {
    draft,
    error,
    updateDraft,
    add,
    paste,
    clearError: () => setError(undefined),
    submissionFields,
    submissionError,
  };
}
