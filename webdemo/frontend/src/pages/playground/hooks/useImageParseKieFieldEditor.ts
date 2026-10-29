import { useState, type ClipboardEvent } from 'react';

import { imageParseKieFieldsError, splitImageParseKieFields } from '../utils/imageParseKie';

/**
 * Orchestrate single or batch field input, and keep the draft on failure; the primary action includes input that has not been added to the list yet.
 * @param fields fields already configured
 * @param onChange entry that updates the field list
 * @returns the input draft, the immediate error, fields waiting to be submitted, and the add result
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
    // Merge the draft before and after the selection, so pasting a batch of fields does not drop text that was already typed.
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
